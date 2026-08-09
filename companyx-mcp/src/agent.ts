import { server } from "./index.js";
import { classify, toToolParams, type ToolName } from "./router.js";
import { generate } from "./lib/ollama.js";

export interface AskResult {
  question: string;
  tool: ToolName;
  routerScores: Record<ToolName, number>;
  toolResult: string;
  answer: string;
}

/**
 * 전체 흐름: 사용자 질문 -> 라우터 -> MCP 도구 -> PostgreSQL -> LLM 답변 생성
 */
export async function ask(question: string): Promise<AskResult> {
  const routed = classify(question);
  const params = toToolParams(routed.tool, question);

  let toolResult: string;
  try {
    const raw = await server.callTool(routed.tool, params);
    toolResult = typeof raw === "string" ? raw : JSON.stringify(raw);
  } catch (err) {
    toolResult = JSON.stringify({ error: err instanceof Error ? err.message : String(err) });
  }

  const prompt = `당신은 Company-X의 사내 데이터 어시스턴트입니다.
아래 [검색 결과]만 근거로 사용자 질문에 한국어로 간결하게 답변하세요.
[검색 결과]의 rows/results 배열에 값이 하나라도 있으면 그 값을 반드시 그대로 인용해 답변할 것 — "확인할 수 없다"거나 "데이터가 없다"고 답하지 말 것.
결과 배열이 완전히 비어 있을 때만 "결과가 없습니다"라고 답하세요. 배열에 없는 내용을 추측해서 지어내지는 마세요.

[질문]
${question}

[사용한 도구]
${routed.tool}

[검색 결과]
${toolResult}

[답변]`;

  const answer = (await generate(prompt)).trim();

  return { question, tool: routed.tool, routerScores: routed.scores, toolResult, answer };
}
