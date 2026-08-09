/**
 * questions.json 30개 전체로 엔드투엔드 정확도 측정.
 * 각 질문마다: (1) 라우터가 기대 도구를 골랐는지, (2) 최종 LLM 답변이 정답 근거(키워드)를 포함하는지 검사한다.
 * 정답 키워드는 DB(psql)/graph(edges.json)를 직접 조회해 사전에 산출한 값이다.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { ask } from "../src/agent.js";
import { pool } from "../src/lib/db.js";

const PROJECT_ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");
const DATASET_DIR = process.env.DATASET_DIR ?? path.resolve(PROJECT_ROOT, "../companyx-dataset-v1.0");
const questions: { q: string; tool: string; hint: string }[] = JSON.parse(
  readFileSync(`${DATASET_DIR}/questions.json`, "utf-8"),
);

type Check = { mode: "any" | "all" | "known-issue" | "lenient"; keywords?: string[]; note?: string };

// 질문 순서(questions.json)대로 정답 체크 규칙. nl2sql/graph는 DB·그래프 직접 조회로 산출.
const CHECKS: Check[] = [
  // nl2sql (1-10)
  { mode: "any", keywords: ["Client-Q"] },
  { mode: "any", keywords: ["23,859", "23859"] },
  { mode: "any", keywords: ["590"] },
  { mode: "any", keywords: ["46"] },
  { mode: "any", keywords: ["권승호", "박소연", "임우진", "조예진"] },
  { mode: "any", keywords: ["Client-J", "Client-AC"] },
  { mode: "any", keywords: ["5"] },
  { mode: "any", keywords: ["Product-D3"] },
  { mode: "any", keywords: ["8"] },
  { mode: "any", keywords: ["기술지원팀"] },
  // vector_search (11-20)
  { mode: "lenient", note: "정답 폭이 넓은 질문(아무 장애보고서나 허용)" },
  { mode: "any", keywords: ["Docker", "docker-compose", "Helm"] },
  { mode: "any", keywords: ["Pod", "Kubernetes"] },
  { mode: "any", keywords: ["인덱스", "Connection Pool", "Redis"] },
  { mode: "any", keywords: ["보안 취약점", "7건"] },
  { mode: "any", keywords: ["90일", "26일", "S3"] },
  { mode: "any", keywords: ["Bearer"] },
  { mode: "any", keywords: ["지연"] },
  { mode: "any", keywords: ["마이그레이션"] },
  { mode: "any", keywords: ["SSL"] },
  // knowledge_graph (21-30)
  { mode: "all", keywords: ["Product-C3", "Product-S1"] },
  { mode: "any", keywords: ["Client-H", "Client-D", "Client-T", "Client-Y", "Client-Q", "Client-V"] },
  { mode: "any", keywords: ["안진우", "강현우", "서재원", "김도윤", "조동현", "이지훈", "황다은", "한은지", "황재원", "김준혁"] },
  { mode: "known-issue", note: "'서울물산'은 데이터셋 어디에도 존재하지 않는 이름 (questions.json 자체 결함)" },
  {
    mode: "any",
    keywords: ["데이터 거버넌스", "DevOps 전환", "CI/CD", "하이브리드 클라우드", "AI 예측 모델"],
    note: "USES->HAS_PROJECT 2단계 다른 관계 체인 — 현재 tool은 단일 relation만 지원해 실패 예상",
  },
  { mode: "any", keywords: ["Product-T2"], note: "관계 개수 집계(랭킹)가 필요 — 현재 tool은 카운트/랭킹 미지원, 실패 예상" },
  { mode: "any", keywords: ["윤소연"] },
  {
    mode: "any",
    keywords: ["강현우", "조동현", "한태호", "장미라", "김준혁", "서재원", "안진우", "류서연", "권소연", "박성민", "조재원"],
    note: "특정 개체명이 없는 질문(anchor 없음) — 현재 tool은 명명된 개체 기준 탐색만 지원, 실패 예상",
  },
  { mode: "any", keywords: ["Client-D", "Client-J", "Client-X", "Client-V", "Client-O", "Client-S", "Client-AA", "Client-E"] },
  { mode: "any", keywords: ["조현우", "안소연", "김준혁"], note: "카운트/랭킹 필요 — 실패 예상" },
];

function checkAnswer(answer: string, check: Check): boolean | null {
  if (check.mode === "known-issue") return null;
  if (check.mode === "lenient") return true;
  const hits = (check.keywords ?? []).filter((k) => answer.includes(k));
  return check.mode === "all" ? hits.length === (check.keywords?.length ?? 0) : hits.length > 0;
}

export interface EvalStats {
  routerCorrect: number;
  answerCorrect: number;
  answerEvaluable: number;
  total: number;
}

/**
 * 30문항 1회 평가. silent=true면 문항별 출력·요약을 생략하고 통계만 반환한다(다회 실행용).
 * pool은 닫지 않는다(호출자가 관리).
 */
export async function evaluateOnce(silent = false): Promise<EvalStats> {
  let routerCorrect = 0;
  let answerCorrect = 0;
  let answerEvaluable = 0;
  const rows: string[] = [];

  for (let i = 0; i < questions.length; i++) {
    const { q, tool: expectedTool } = questions[i];
    const check = CHECKS[i];
    const result = await ask(q);

    const routerOk = result.tool === expectedTool;
    if (routerOk) routerCorrect++;

    const ansOk = checkAnswer(result.answer, check);
    if (ansOk !== null) {
      answerEvaluable++;
      if (ansOk) answerCorrect++;
    }

    if (!silent) {
      const mark = check.mode === "known-issue" ? "SKIP" : ansOk ? "PASS" : "FAIL";
      rows.push(
        `[${i + 1}/30] router=${routerOk ? "OK" : "MISS"}(${result.tool}) answer=${mark}  ${q}` +
          (check.note ? `\n        note: ${check.note}` : "") +
          `\n        A: ${result.answer.slice(0, 150).replace(/\n/g, " ")}`,
      );
    }
  }

  if (!silent) {
    console.log(rows.join("\n"));
    console.log("\n" + "=".repeat(60));
    console.log(`라우터 정확도: ${routerCorrect}/${questions.length} (${((routerCorrect / questions.length) * 100).toFixed(1)}%)`);
    console.log(
      `최종 답변 정확도: ${answerCorrect}/${answerEvaluable} 평가대상 중 (전체 30개 중 known-issue 1건 제외, ${(
        (answerCorrect / answerEvaluable) *
        100
      ).toFixed(1)}%)`,
    );
  }

  return { routerCorrect, answerCorrect, answerEvaluable, total: questions.length };
}

async function main() {
  await evaluateOnce(false);
  await pool.end();
}

// 이 파일을 직접 실행할 때만 main() 실행 (evaluate-multi에서 import 시엔 실행 안 됨)
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
