import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { buildChatAgent } from "../agent/build";
import { config } from "../config";

/**
 * OpenAI 兼容桥。
 *
 * 目的：让 go-stock（以及任何 OpenAI 兼容客户端）把“模型”指向本服务，
 * 从而在不改 Go 代码的前提下，用新 Agent 接管 AI 对话。
 *
 *   POST /v1/chat/completions   （支持 stream=true/false）
 *   GET  /v1/models
 *   GET  /health
 *
 * 说明：
 * - 只监听 127.0.0.1，默认无鉴权；需要时设 BRIDGE_TOKEN 并加 Authorization 校验。
 * - 调用方传来的 system 内容会作为低优先级上下文附加，不会覆盖本服务的铁律。
 */

const BRIDGE_TOKEN = (process.env.BRIDGE_TOKEN ?? "").trim();
const started = Math.floor(Date.now() / 1000);

const server = createServer(async (req, res) => {
  if (req.method === "OPTIONS") {
    res.writeHead(204, cors());
    return res.end();
  }

  if (req.method === "GET" && (req.url === "/health" || req.url === "/")) {
    return json(res, 200, { ok: true, service: "power-price-agent", provider: "openai-compatible" });
  }

  if (req.method === "GET" && req.url === "/v1/models") {
    return json(res, 200, {
      object: "list",
      data: [{ id: "power-price-agent", object: "model", created: started, owned_by: "local" }],
    });
  }

  if (req.method !== "POST" || !req.url?.startsWith("/v1/chat/completions")) {
    return json(res, 404, { error: { message: "not found", type: "invalid_request_error" } });
  }

  if (BRIDGE_TOKEN) {
    const auth = req.headers.authorization ?? "";
    if (auth !== `Bearer ${BRIDGE_TOKEN}`) {
      return json(res, 401, { error: { message: "unauthorized", type: "authentication_error" } });
    }
  }

  let body: any;
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: { message: "invalid json", type: "invalid_request_error" } });
  }

  const messages: Array<{ role: string; content: any }> = Array.isArray(body.messages)
    ? body.messages
    : [];
  const systemPrompt = messages
    .filter((m) => m.role === "system")
    .map((m) => contentToText(m.content))
    .join("\n\n");
  const userQuestion = [...messages].reverse().find((m) => m.role === "user");
  const question = contentToText(userQuestion?.content).trim();

  if (!question) {
    return json(res, 400, { error: { message: "no user message", type: "invalid_request_error" } });
  }

  const sessionId =
    String(req.headers["x-session-id"] ?? body.user ?? "go-stock") || "go-stock";
  const modelName = body.model ?? "power-price-agent";
  const stream = Boolean(body.stream);

  const id = `chatcmpl-${Date.now().toString(36)}`;

  try {
    const agent = await buildChatAgent(sessionId, question, systemPrompt);

    if (!stream) {
      const result: any = await agent.invoke(
        { messages: [{ role: "user", content: question }] },
        { configurable: { thread_id: sessionId } }
      );
      const text = extractText(result);
      return json(res, 200, {
        id,
        object: "chat.completion",
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [
          { index: 0, message: { role: "assistant", content: text }, finish_reason: "stop" },
        ],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      });
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      ...cors(),
    });

    const send = (payload: unknown) => {
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const streamIter = await agent.stream(
      { messages: [{ role: "user", content: question }] },
      {
        configurable: { thread_id: sessionId },
        streamMode: ["messages"],
      } as any
    );

    for await (const chunk of streamIter as AsyncIterable<any>) {
      const msg = unwrapMessage(chunk);
      // 只转发模型输出；工具结果（ToolMessage）不能混进助手回复
      if (!msg || (typeof msg._getType === "function" && msg._getType() !== "ai")) continue;

      const text = contentToText(msg.content);
      if (!text) continue;
      send({
        id,
        object: "chat.completion.chunk",
        created: Math.floor(Date.now() / 1000),
        model: modelName,
        choices: [{ index: 0, delta: { content: text }, finish_reason: null }],
      });
    }

    send({
      id,
      object: "chat.completion.chunk",
      created: Math.floor(Date.now() / 1000),
      model: modelName,
      choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
    });
    res.write("data: [DONE]\n\n");
  } catch (err) {
    const message = (err as Error).message;
    if (res.headersSent) {
      res.write(`data: ${JSON.stringify({ error: { message } })}\n\n`);
      res.write("data: [DONE]\n\n");
    } else {
      json(res, 500, { error: { message, type: "server_error" } });
    }
  } finally {
    res.end();
  }
});

server.listen(config.bridge.port, "127.0.0.1", () => {
  console.log(`OpenAI-compatible bridge: http://127.0.0.1:${config.bridge.port}/v1`);
  console.log(`  model: power-price-agent`);
  console.log(`  POST /v1/chat/completions`);
});

/**
 * LangGraph 的流式条目形状不稳定：
 *   - [AIMessageChunk, metadata]
 *   - ["messages", [AIMessageChunk, metadata]]
 *   - 直接是消息对象
 * 这里统一剥到最后的消息对象。
 */
function unwrapMessage(item: any): any {
  if (!Array.isArray(item)) return item;
  if (typeof item[0] === "string") return unwrapMessage(item[1]);
  if (item[0] && typeof item[0] === "object") return item[0];
  return item[0];
}

function contentToText(content: any): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => {
        if (typeof c === "string") return c;
        if (c?.type === "text") return c.text ?? "";
        return "";
      })
      .join("");
  }
  return "";
}

function extractText(result: any): string {
  const last = result?.messages?.at?.(-1);
  const text = contentToText(last?.content);
  if (text) return text;
  if (result?.structuredResponse) return JSON.stringify(result.structuredResponse, null, 2);
  return "";
}

function cors() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-session-id",
  };
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", ...cors() });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8");
}