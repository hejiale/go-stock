/**
 * 命令行 demo。
 *
 *   npm run dev                         # 交互式
 *   npm run dev -- "预估明天山东电价"     # 单次提问
 *   npm run dev -- --deep "出一份复盘"    # 用 Deep Agent
 */
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { buildAgent, buildDeepAgent } from "./agent/build";
import { addCase } from "./memory/recall";

async function ask(question: string, deep: boolean, threadId: string) {
  const agent = deep
    ? await buildDeepAgent("demo", question)
    : await buildAgent("demo", question);

  const started = Date.now();
  const result: any = await agent.invoke(
    { messages: [{ role: "user", content: question }] },
    { configurable: { thread_id: threadId } }
  );

  const elapsed = Date.now() - started;
  const report = result?.structuredResponse;

  console.log("\n========== 回答 ==========");
  if (report) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    const last = result?.messages?.at?.(-1);
    console.log(last?.content ?? "(空)");
  }
  console.log(`\n耗时 ${elapsed} ms`);

  // 沉淀长期记忆（真实项目里应在“对账之后”写入，并带上真实 MAE）
  addCase({
    id: `case-${Date.now()}`,
    question,
    answer: report?.reasoning ?? String(result?.messages?.at?.(-1)?.content ?? ""),
    market: report?.market ?? "unknown",
    date: new Date().toISOString().slice(0, 10),
  });

  return report;
}

async function main() {
  const args = process.argv.slice(2);
  const deep = args.includes("--deep");
  const inline = args.filter((a) => a !== "--deep").join(" ").trim();
  const threadId = `cli-${new Date().toISOString().slice(0, 10)}`;

  if (inline) {
    await ask(inline, deep, threadId);
    return;
  }

  const rl = createInterface({ input: stdin, output: stdout });
  console.log("电价预估 Agent（输入 exit 退出）");
  for (;;) {
    const q = (await rl.question("\n你> ")).trim();
    if (!q || q === "exit" || q === "quit") break;
    try {
      await ask(q, deep, threadId);
    } catch (err) {
      console.error("❌", (err as Error).message);
    }
  }
  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});