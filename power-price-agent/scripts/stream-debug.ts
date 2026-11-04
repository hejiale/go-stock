/** 调试 LangChain 流式输出的真实结构（复刻 openai.ts 的解析）。 */
import { writeFileSync } from "node:fs";
import { buildChatAgent } from "../src/agent/build";

async function main() {
  const q = process.argv.slice(2).join(" ") || "DE-LU 2026-11-05 电价简要预测，60字以内";
  const agent = await buildChatAgent("stream-debug", q);
  const out: string[] = [];

  const stream = await agent.stream(
    { messages: [{ role: "user", content: q }] },
    { configurable: { thread_id: `dbg-${Date.now()}` }, streamMode: ["messages"] } as any
  );

  let i = 0;
  let sent = 0;
  for await (const item of stream as AsyncIterable<any>) {
    const isPair = Array.isArray(item) && typeof item[0] === "string";
    const payload = isPair ? item[1] : item;
    const msg = Array.isArray(payload) ? payload[0] : payload;
    const content = msg?.content;
    const text =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content.map((c: any) => (c?.type === "text" ? c.text ?? "" : "")).join("")
          : "";
    if (text) sent++;

    if (i < 5) {
      out.push(
        `#${i} pair=${isPair} itemLen=${Array.isArray(item) ? item.length : "-"} ` +
          `payloadType=${payload?.constructor?.name ?? typeof payload} ` +
          `msgType=${msg?.constructor?.name ?? typeof msg} ` +
          `getType=${typeof msg?._getType === "function" ? msg._getType() : "-"} ` +
          `content=${JSON.stringify(content)?.slice(0, 160)}`
      );
    }
    if (text) out.push(`TEXT#${sent} ${JSON.stringify(text)}`);
    if (++i >= 300) break;
  }

  out.push(`TOTAL items=${i} textChunks=${sent}`);
  writeFileSync("C:/Users/hejia/AppData/Local/Temp/opencode/stream-debug.txt", out.join("\n"), "utf8");
  console.log("items", i, "textChunks", sent);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});