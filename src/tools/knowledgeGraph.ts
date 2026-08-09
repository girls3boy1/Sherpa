import { defineTool } from "@airmcp-dev/core";
import { generate } from "../lib/ollama.js";
import { findNode, nodes, traverse, RELATIONS } from "../lib/graph.js";

const SCHEMA = `
노드 유형: client, product, employee, project, department
관계 유형과 방향 (direction은 anchor 기준. anchor가 화살표 시작(source)이면 out, 화살표 끝(target)이면 in):
- employee -[BELONGS_TO]-> department (직원 소속 부서). 예: "OO팀 소속 직원은?" → anchor=department, direction=in
- department -[HEAD_IS]-> employee (부서장). 예: "OO팀 팀장은?" → anchor=department, direction=out
- client -[USES]-> product (고객이 사용하는 제품)
- employee -[MANAGES_ACCOUNT]-> client (담당 고객 관리)
- client -[HAS_PROJECT]-> project (고객의 프로젝트)
- employee -[LEADS]-> project (프로젝트 담당자)
- client -[REPORTED_ISSUE]-> product (기술 지원 이슈 제기)
`.trim();

interface QuerySpec {
  anchor: string;
  relation: (typeof RELATIONS)[number] | "any";
  direction: "out" | "in" | "any";
  hops: 1 | 2;
}

function parseSpec(raw: string): QuerySpec {
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
  return {
    anchor: String(parsed.anchor ?? "").trim(),
    relation: RELATIONS.includes(parsed.relation) ? parsed.relation : "any",
    direction: ["out", "in", "any"].includes(parsed.direction) ? parsed.direction : "any",
    hops: parsed.hops === 2 ? 2 : 1,
  };
}

export const knowledgeGraphTool = defineTool("knowledge_graph", {
  description:
    "고객/제품/직원/프로젝트/부서 간의 관계를 탐색한다 (누가 무엇을 담당하는지, 어떤 고객이 어떤 제품을 쓰는지 등). " +
    "'A와 B의 관계', '담당자', '사용 중인 제품'처럼 개체 간 연결을 묻는 질문에 사용한다.",
  params: {
    question: "string",
  },
  annotations: { readOnlyHint: true },
  handler: async (params) => {
    const { question } = params as { question: string };
    const prompt = `다음은 지식 그래프 스키마입니다.

${SCHEMA}

사용자 질문을 분석해서 그래프 탐색에 필요한 정보를 JSON으로만 답하세요. 다른 설명은 넣지 마세요.
형식: {"anchor": "질문에 언급된 개체 이름(예: Client-A, Product-C1, 김민수)", "relation": "관계 유형 또는 any", "direction": "out 또는 in 또는 any", "hops": 1 또는 2}
anchor는 질문 원문에 등장한 단어를 그대로 복사할 것 — 번역하거나 다른 언어/표기로 바꾸지 말 것.

질문: ${question}`;

    const raw = await generate(prompt, { format: "json" });
    const spec = parseSpec(raw);

    // LLM이 anchor를 다른 표기로 바꿔 찾지 못하면, 질문 원문에 등장한 노드 이름으로 재시도한다.
    const anchorNode = findNode(spec.anchor) ?? nodes.find((n) => question.includes(n.name));
    if (!anchorNode) {
      return { question, interpreted: spec, error: `'${spec.anchor}'에 해당하는 노드를 찾지 못했습니다.` };
    }

    const hops = traverse(anchorNode.id, {
      relation: spec.relation,
      direction: spec.direction,
      hops: spec.hops,
    });

    return {
      question,
      interpreted: spec,
      anchor: anchorNode,
      results: hops.map((h) => ({
        relation: h.relation,
        from: { id: h.from.id, type: h.from.type, name: h.from.name },
        to: { id: h.to.id, type: h.to.type, name: h.to.name, properties: h.to.properties },
      })),
    };
  },
});
