import { defineServer, retryPlugin, timeoutPlugin } from "@airmcp-dev/core";
import { vectorSearchTool } from "./tools/vectorSearch.js";
import { nl2sqlTool } from "./tools/nl2sql.js";
import { knowledgeGraphTool } from "./tools/knowledgeGraph.js";
import { commitHistoryTool } from "./tools/commitHistory.js";

export const server = defineServer({
  name: "companyx-mcp",
  version: "0.1.0",
  description: "Company-X 지능형 데이터 플랫폼 — 벡터 검색 / NL2SQL / 지식 그래프 / 커밋 이력 MCP 서버",
  transport: { type: "stdio" },
  use: [timeoutPlugin(30_000), retryPlugin({ maxRetries: 2 })],
  tools: [vectorSearchTool, nl2sqlTool, knowledgeGraphTool, commitHistoryTool],
});

if (import.meta.url === `file://${process.argv[1]}`) {
  server.start();
}
