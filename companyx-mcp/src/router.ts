export type ToolName = "vector_search" | "nl2sql" | "knowledge_graph";

interface Signal {
  phrase: string;
  weight: number;
}

/**
 * 카테고리별 시그널 사전.
 * - nl2sql: 집계/통계/정형 테이블 어휘 (매출, 계약, 연봉 등)
 * - vector_search: 절차/서술형 어휘 (방법, 가이드, 사례, 원인 등 — 문서 내용 검색)
 * - knowledge_graph: 개체 간 관계 어휘 (담당, 소속, 사용 중인 등 — 그래프 엣지에 대응)
 * weight가 클수록 해당 카테고리에 더 특이적인(다른 카테고리와 안 겹치는) 표현.
 */
const SIGNALS: Record<ToolName, Signal[]> = {
  nl2sql: [
    { phrase: "총 매출", weight: 2 },
    { phrase: "매출", weight: 1 },
    { phrase: "합계", weight: 1 },
    { phrase: "평균", weight: 1 },
    { phrase: "연봉", weight: 1 },
    { phrase: "금액", weight: 1 },
    { phrase: "상위", weight: 1 },
    { phrase: "순위", weight: 1 },
    { phrase: "몇 개", weight: 1 },
    { phrase: "몇개", weight: 1 },
    { phrase: "몇 건", weight: 1 },
    { phrase: "얼마", weight: 1 },
    { phrase: "계약 수", weight: 2 },
    { phrase: "활성 상태", weight: 1 },
    { phrase: "등록된", weight: 1 },
    { phrase: "우선순위", weight: 1 },
    { phrase: "티켓", weight: 1 },
    { phrase: "분기", weight: 1 },
    { phrase: "큰 순서", weight: 2 },
    { phrase: "카테고리", weight: 1 },
    { phrase: "가장 많은", weight: 1 },
    { phrase: "가장 높은", weight: 1 },
    { phrase: "가장 낮은", weight: 1 },
  ],
  vector_search: [
    { phrase: "방법", weight: 2 },
    { phrase: "가이드", weight: 2 },
    { phrase: "궁금해", weight: 2 },
    { phrase: "사례", weight: 2 },
    { phrase: "원인", weight: 2 },
    { phrase: "정책", weight: 2 },
    { phrase: "대응", weight: 1 },
    { phrase: "튜닝", weight: 2 },
    { phrase: "매뉴얼", weight: 2 },
    { phrase: "레퍼런스", weight: 2 },
    { phrase: "인증 방식", weight: 2 },
    { phrase: "인증서", weight: 2 },
    { phrase: "제안서", weight: 2 },
    { phrase: "마이그레이션", weight: 1 },
    { phrase: "회의", weight: 1 },
    { phrase: "미팅", weight: 1 },
    { phrase: "일정 지연", weight: 2 },
    { phrase: "취약점", weight: 2 },
    { phrase: "설치", weight: 2 },
    { phrase: "관련 내용", weight: 2 },
    { phrase: "내용이 있어", weight: 2 },
    { phrase: "장애", weight: 1 },
  ],
  knowledge_graph: [
    { phrase: "담당하는", weight: 3 },
    { phrase: "담당자", weight: 3 },
    { phrase: "담당 엔지니어", weight: 3 },
    { phrase: "소속", weight: 3 },
    { phrase: "사용 중인", weight: 3 },
    { phrase: "사용하는", weight: 3 },
    { phrase: "이끄는", weight: 3 },
    { phrase: "팀장", weight: 3 },
    { phrase: "부서장", weight: 3 },
    { phrase: "누구야", weight: 2 },
    { phrase: "관련된 프로젝트", weight: 3 },
    { phrase: "이슈가 가장 많은", weight: 3 },
    { phrase: "이슈 현황", weight: 3 },
    { phrase: "고객 이슈", weight: 2 },
  ],
};

export interface RouteResult {
  tool: ToolName;
  scores: Record<ToolName, number>;
  matched: Record<ToolName, string[]>;
}

const DEFAULT_TOOL: ToolName = "vector_search";

export function classify(question: string): RouteResult {
  const scores: Record<ToolName, number> = { nl2sql: 0, vector_search: 0, knowledge_graph: 0 };
  const matched: Record<ToolName, string[]> = { nl2sql: [], vector_search: [], knowledge_graph: [] };

  for (const [tool, signals] of Object.entries(SIGNALS) as [ToolName, Signal[]][]) {
    for (const { phrase, weight } of signals) {
      if (question.includes(phrase)) {
        scores[tool] += weight;
        matched[tool].push(phrase);
      }
    }
  }

  const best = (Object.entries(scores) as [ToolName, number][]).reduce((a, b) => (b[1] > a[1] ? b : a));
  const tool = best[1] > 0 ? best[0] : DEFAULT_TOOL;

  return { tool, scores, matched };
}

/** 라우터가 고른 도구 이름에 맞춰 각 도구의 파라미터 이름으로 매핑한다. */
export function toToolParams(tool: ToolName, question: string): Record<string, unknown> {
  if (tool === "vector_search") return { query: question };
  return { question };
}
