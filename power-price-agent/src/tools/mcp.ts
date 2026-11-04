// MCP 接入示例。
//
// 适合把「公司内部数据平台 / 调度系统 / 交易台账 / 飞书通知」包装成 MCP 服务器。
// 依赖：@langchain/mcp-adapters v2（旧的 MultiServerMCPClient 已废弃）。
//
// 注意：
// - 只加载启用且连通的服务器；不要把所有服务器工具都塞给模型。
// - 适配器在每次工具调用时会建立会话，长连接/复用请参考官方文档。

import { MCPAdapter } from "@langchain/mcp-adapters";
import { config } from "../config";

let cache: any[] | null = null;

export async function loadMcpTools(): Promise<any[]> {
  if (!config.mcp.energyUrl) return [];
  if (cache) return cache;

  const adapter = new MCPAdapter({
    servers: {
      energy: {
        url: config.mcp.energyUrl,
        headers: config.mcp.token
          ? { Authorization: `Bearer ${config.mcp.token}` }
          : {},
      },
    },
  });

  try {
    cache = await adapter.listTools();
    return cache;
  } catch (err) {
    // MCP 不可用不应该阻断主流程
    console.warn("[mcp] 加载工具失败，跳过:", (err as Error).message);
    return [];
  }
}