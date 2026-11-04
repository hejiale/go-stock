import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { buildAgent } from "../agent/build";
import { config } from "../config";

/**
 * 最小 SSE 服务。
 *
 * POST /chat
 *   body: { message: string, threadId: string, userId?: string }
 *   resp: text/event-stream
 *     event: messages  → 模型 token 流
 *     event: updates   → 节点/工具进度
 *     event: done      → 结构化结果
 *     event: error     → 错误
 */
const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    return json(res, 200, { ok: true });
  }

  if (req.method === "OPTIONS") {
    res.writeHead(204, corsHeaders());
    return res.end();
  }

  if (req.method !== "POST" || req.url !== "/chat") {
    return json(res, 404, { error: "not found" });
  }

  let body: { message?: string; threadId?: string; userId?: string };
  try {
    body = JSON.parse(await readBody(req));
  } catch {
    return json(res, 400, { error: "invalid json" });
  }

  const message = (body.message ?? "").trim();
  const threadId = body.threadId ?? `thread-${Date.now()}`;
  const userId = body.userId ?? "demo";

  if (!message) return json(res, 400, { error: "message is required" });

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    ...corsHeaders(),
  });

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const agent = await buildAgent(userId, message);
    const stream = await agent.stream(
      { messages: [{ role: "user", content: message }] },
      {
        configurable: { thread_id: threadId },
        streamMode: ["messages", "updates"],
      } as any
    );

    for await (const [mode, chunk] of stream as AsyncIterable<[string, any]>) {
      if (mode === "messages") {
        // chunk = [message, metadata]
        const msg = chunk?.[0];
        if (msg?.content) send("messages", { role: msg.role, content: msg.content });
      } else {
        send("updates", chunk);
      }
    }

    send("done", { threadId });
  } catch (err) {
    send("error", { message: (err as Error).message });
  } finally {
    res.end();
  }
});

server.listen(config.server.port, () => {
  console.log(`power-price-agent SSE listening on http://localhost:${config.server.port}`);
  console.log(`  POST /chat  { "message": "...", "threadId": "demo-1" }`);
});

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

function json(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json", ...corsHeaders() });
  res.end(JSON.stringify(data));
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c));
  return Buffer.concat(chunks).toString("utf8");
}