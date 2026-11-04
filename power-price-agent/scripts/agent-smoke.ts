/**
 * Agent 冒烟测试：验证 LLM 能创建、能返回内容。
 *
 *   npm run agent:smoke
 *   npm run agent:smoke -- "明天 DE-LU 电价大概什么走势？"
 *
 * 需要 .env 里配置 OPENAI_API_KEY。
 */
import { buildChatAgent } from "../src/agent/build";

async function main() {
  const question = process.argv.slice(2).join(" ").trim() || "用一句话说明你能做什么。";
  console.log(`问题: ${question}\n`);

  const agent = await buildChatAgent("agent-smoke", question);
  const result: any = await agent.invoke(
    { messages: [{ role: "user", content: question }] },
    { configurable: { thread_id: `smoke-${Date.now()}` } }
  );

  const last = result?.messages?.at?.(-1);
  const content = last?.content;
  const text =
    typeof content === "string"
      ? content
      : Array.isArray(content)
        ? content.map((c: any) => (typeof c === "string" ? c : c?.text ?? "")).join("")
        : JSON.stringify(content);
  console.log("回答:\n" + (text ?? "(空)"));
}

main().catch((err) => {
  console.error("❌", err);
  process.exit(1);
});