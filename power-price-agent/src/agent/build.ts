import {
  createAgent,
  summarizationMiddleware,
  humanInTheLoopMiddleware,
} from "langchain";
import { createDeepAgent, FilesystemBackend } from "deepagents";
import { buildTools } from "../tools";
import { ForecastReport } from "./schema";
import { buildBridgeSystemPrompt, buildSystemPrompt } from "./prompt";
import { createCheckpointer } from "../db/checkpoint";
import { config } from "../config";

/**
 * 普通 Agent：单循环 ReAct，适合单次预估、规则问答。
 * 输出结构化 ForecastReport。
 */
export async function buildAgent(userId: string, question: string) {
  const tools = await buildTools();

  return createAgent({
    model: config.model,
    tools: tools as any,
    systemPrompt: buildSystemPrompt(userId, question),
    responseFormat: ForecastReport,
    middleware: [
      summarizationMiddleware({
        model: config.summaryModel,
        trigger: { tokens: 60_000 },
      }),
    ],
    checkpointer: createCheckpointer(),
  });
}

/**
 * 聊天版 Agent：不强制结构化输出，用于 OpenAI 兼容桥（go-stock 等）。
 * 返回自然语言，便于直接作为 assistant content 流式输出。
 */
export async function buildChatAgent(
  userId: string,
  question: string,
  externalSystemPrompt?: string
) {
  const tools = await buildTools();

  return createAgent({
    model: config.model,
    tools: tools as any,
    systemPrompt: buildBridgeSystemPrompt(userId, question, externalSystemPrompt),
    middleware: [
      summarizationMiddleware({
        model: config.summaryModel,
        trigger: { tokens: 60_000 },
      }),
    ],
    checkpointer: createCheckpointer(),
  });
}

/**
 * Deep Agent：规划 + 文件系统 + 子 Agent + 技能。
 * 适合多步研究、长报告、跨数据源核对。
 *
 * 技能目录：./skills/<skill-name>/SKILL.md
 */
export async function buildDeepAgent(userId: string, question: string) {
  const tools = await buildTools();

  return createDeepAgent({
    model: config.model,
    tools: tools as any,
    systemPrompt: buildSystemPrompt(userId, question),
    skills: ["./skills"],
    backend: new FilesystemBackend({ rootDir: process.cwd() }),
    responseFormat: ForecastReport,
    middleware: [humanInTheLoopMiddleware({ interruptOn: {} })],
    checkpointer: createCheckpointer(),
  } as any);
}