// 会话持久化（短期记忆）。
//
// 演示用 MemorySaver（进程内）。生产建议：
//   npm i @langchain/langgraph-checkpoint-sqlite
//   import { SqliteSaver } from "@langchain/langgraph-checkpoint-sqlite";
//   const checkpointer = SqliteSaver.fromConnString("data/agent.db");
//
// 或使用 Postgres / Redis，配合 thread_id 做会话隔离。

import { MemorySaver } from "@langchain/langgraph";

let singleton: MemorySaver | null = null;

export function createCheckpointer(): MemorySaver {
  if (!singleton) singleton = new MemorySaver();
  return singleton;
}