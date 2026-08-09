import { defineTool } from "@airmcp-dev/core";
import { generate } from "../lib/ollama.js";
import {
  findNode,
  nodes,
  traverseChain,
  aggregateRelation,
  filterTraverse,
  findTypePath,
  RELATIONS,
  type Relation,
  type Step,
  type GraphNode,
} from "../lib/graph.js";

/** 질문이 어떤 노드 타입의 답을 원하는지 추정(2홉 경로 자동구성용). */
function targetType(q: string): string | undefined {
  if (/프로젝트/.test(q)) return "project";
  if (/팀장|부서장|직원|담당자|엔지니어|이끄는|누구/.test(q)) return "employee";
  if (/고객사|고객/.test(q)) return "client";
  if (/제품|솔루션/.test(q)) return "product";
  if (/부서|소속/.test(q)) return "department";
  return undefined;
}

const SCHEMA = `
노드 유형: client, product, employee, project, department
관계와 방향 (direction은 anchor 기준. anchor가 화살표 시작(source)이면 out, 끝(target)이면 in):
- employee -[BELONGS_TO]-> department  (직원 소속 부서)
- department -[HEAD_IS]-> employee      (부서장)
- client -[USES]-> product              (고객이 사용하는 제품)
- employee -[MANAGES_ACCOUNT]-> client  (담당 고객 관리)
- client -[HAS_PROJECT]-> project        (고객의 프로젝트)
- employee -[LEADS]-> project            (프로젝트 담당자)
- client -[REPORTED_ISSUE]-> product     (기술 지원 이슈 제기)
project 노드 속성: status(planning|in_progress|on_hold|completed), budget
`.trim();

const PROMPT_GUIDE = `사용자 질문을 분석해 그래프 질의를 JSON으로만 출력하세요. 설명 금지.

mode는 다음 중 하나:
1) "traverse" — 특정 개체(anchor)에서 관계를 1~2단계 따라간다. 서로 다른 관계를 이어도 된다.
   형식: {"mode":"traverse","anchor":"질문 속 개체 이름 원문 그대로","steps":[{"relation":"USES","direction":"out"}]}
2) "aggregate" — "가장 많은/최다"처럼 관계 개수를 세어 순위를 매긴다(개체 지정 없음).
   형식: {"mode":"aggregate","relation":"REPORTED_ISSUE","groupBy":"target"}
   (groupBy는 세려는 대상이 화살표 끝이면 target, 시작이면 source)
3) "filter_traverse" — 개체 이름이 없고 "상태가 ~인 것들"처럼 조건으로 시작 집합을 정한 뒤 관계를 따라간다.
   형식: {"mode":"filter_traverse","nodeFilter":{"type":"project","property":"status","value":"in_progress"},"step":{"relation":"LEADS","direction":"in"}}

규칙:
- anchor는 질문 원문의 단어를 그대로 복사. 번역하거나 다른 표기로 바꾸지 말 것.
- 예: "Client-A 사용 제품?" → {"mode":"traverse","anchor":"Client-A","steps":[{"relation":"USES","direction":"out"}]}
- 예: "Product-D1 사용 고객사의 프로젝트?" → {"mode":"traverse","anchor":"Product-D1","steps":[{"relation":"USES","direction":"in"},{"relation":"HAS_PROJECT","direction":"out"}]}
- 예: "이슈 가장 많은 제품?" → {"mode":"aggregate","relation":"REPORTED_ISSUE","groupBy":"target"}
- 예: "가장 많은 고객 담당 직원?" → {"mode":"aggregate","relation":"MANAGES_ACCOUNT","groupBy":"source"}
- 예: "진행 중 프로젝트 이끄는 직원?" → {"mode":"filter_traverse","nodeFilter":{"type":"project","property":"status","value":"in_progress"},"step":{"relation":"LEADS","direction":"in"}}`;

interface Spec {
  mode?: string;
  anchor?: string;
  steps?: Step[];
  relation?: string;
  groupBy?: "source" | "target";
  nodeFilter?: { type?: string; property?: string; value?: string };
  step?: Step;
}

function safeParse(raw: string): Spec {
  const m = raw.match(/\{[\s\S]*\}/);
  try {
    return m ? (JSON.parse(m[0]) as Spec) : {};
  } catch {
    return {};
  }
}

const AGG_CUES = ["가장 많은", "가장 많이", "최다", "제일 많은"];

function isRelation(v: unknown): v is Relation {
  return typeof v === "string" && (RELATIONS as readonly string[]).includes(v);
}

function nodeOut(n: GraphNode) {
  return { id: n.id, type: n.type, name: n.name, properties: n.properties };
}

export const knowledgeGraphTool = defineTool("knowledge_graph", {
  description:
    "고객/제품/직원/프로젝트/부서 간의 관계를 탐색한다. 담당자·소속·사용 제품 같은 단순 연결뿐 아니라, " +
    "여러 관계를 잇는 2단계 질의(예: 특정 제품 사용 고객사의 프로젝트), 관계 개수 집계·랭킹(예: 이슈 최다 제품), " +
    "개체명 없는 조건 질의(예: 진행 중 프로젝트를 이끄는 직원)도 처리한다.",
  params: {
    question: "string",
  },
  annotations: { readOnlyHint: true },
  handler: async (params) => {
    const { question } = params as { question: string };
    const raw = await generate(
      `다음은 지식 그래프 스키마입니다.\n\n${SCHEMA}\n\n${PROMPT_GUIDE}\n\n질문: ${question}`,
      { format: "json" },
    );
    const spec = safeParse(raw);

    // 결정적 보정: 집계 신호가 뚜렷한데 LLM이 relation을 제대로 줬으면 aggregate로 강제
    let mode = spec.mode;
    if (AGG_CUES.some((c) => question.includes(c)) && isRelation(spec.relation)) {
      mode = "aggregate";
    }

    // ── aggregate: 관계 개수 집계·랭킹 ─────────────────────────
    if (mode === "aggregate" && isRelation(spec.relation)) {
      const groupBy = spec.groupBy === "source" ? "source" : "target";
      const ranked = aggregateRelation(spec.relation, groupBy, 5);
      return {
        question,
        interpreted: { mode: "aggregate", relation: spec.relation, groupBy },
        results: ranked.map((r) => ({ ...nodeOut(r.node), count: r.count })),
      };
    }

    // ── filter_traverse: 앵커리스(조건 시작) ───────────────────
    if (mode === "filter_traverse" && spec.nodeFilter && spec.step) {
      // 방향은 코드가 확정(LLM 추측 무시)
      const fstep: Step = { relation: spec.step.relation, direction: "auto" };
      const { hops, terminals } = filterTraverse(spec.nodeFilter, fstep);
      return {
        question,
        interpreted: { mode: "filter_traverse", nodeFilter: spec.nodeFilter, step: fstep },
        count: terminals.length,
        results: terminals.map(nodeOut),
        relations: hops.map((h) => ({ relation: h.relation, from: h.from.name, to: h.to.name })),
      };
    }

    // ── traverse: 단일/다단계 체인 (기본) ─────────────────────
    const anchorNode = findNode(spec.anchor ?? "") ?? nodes.find((n) => question.includes(n.name));
    if (!anchorNode) {
      return {
        question,
        interpreted: spec,
        error: `anchor 노드를 찾지 못했습니다 (mode=${mode ?? "unknown"}, anchor='${spec.anchor ?? ""}').`,
      };
    }
    // relation은 LLM을 신뢰하되 방향은 코드가 확정("auto")한다.
    const steps: Step[] =
      Array.isArray(spec.steps) && spec.steps.length > 0
        ? spec.steps.slice(0, 3).map((s) => ({ relation: s.relation, direction: "auto" as const }))
        : [{ relation: isRelation(spec.relation) ? spec.relation : "any", direction: "auto" as const }];

    let { hops, terminals } = traverseChain(anchorNode.id, steps);
    let usedSteps = steps;

    // 결정적 2홉 폴백: 결과가 비었거나(단일홉 실패) 원하는 타입이 안 나오면,
    // 관계 스키마로 앵커타입→목표타입 경로를 자동 구성해 재시도 (LLM 체인 스펙 불신)
    const tt = targetType(question);
    const needPath = terminals.length === 0 || (!!tt && !terminals.some((n) => n.type === tt));
    if (tt && tt !== anchorNode.type && needPath) {
      const path = findTypePath(anchorNode.type, tt);
      if (path) {
        const r = traverseChain(anchorNode.id, path);
        if (r.terminals.length > 0) {
          hops = r.hops;
          terminals = r.terminals;
          usedSteps = path;
        }
      }
    }

    return {
      question,
      interpreted: { mode: "traverse", anchor: anchorNode.name, steps: usedSteps },
      anchor: nodeOut(anchorNode),
      count: terminals.length,
      results: terminals.map(nodeOut),
      relations: hops.map((h) => ({ relation: h.relation, from: h.from.name, to: h.to.name })),
    };
  },
});
