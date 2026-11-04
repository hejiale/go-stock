import { priceHistoryTool } from "./market";
import { weatherTool } from "./weather";
import { loadForecastTool } from "./load";
import { priceModelTool } from "./model";
import { marketRulesTool } from "./rag";
import { loadMcpTools } from "./mcp";

/** 内置工具（不依赖外部服务）。 */
export const builtinTools = [
  priceHistoryTool,
  weatherTool,
  loadForecastTool,
  priceModelTool,
  marketRulesTool,
];

/** 全部工具 = 内置 + MCP（MCP 未配置时自动为空）。 */
export async function buildTools() {
  const mcpTools = await loadMcpTools();
  return [...builtinTools, ...mcpTools];
}