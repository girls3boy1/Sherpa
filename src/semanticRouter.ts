/**
 * 시맨틱 라우터 — 키워드 라우터(router.ts)의 패러프레이즈 취약점을 보완한다.
 *
 * 원리: questions.json의 30개 라벨 질문을 bge-m3로 임베딩해 "앵커"로 두고,
 * 사용자 질문을 임베딩해 가장 가까운 앵커 k개의 라벨을 유사도 가중 다수결로 뽑는다.
 * "사용하는"이든 "쓰는"이든 의미가 가까우면 같은 앵커에 붙으므로 표현 차이에 강하다.
 *
 * routeHybrid(): 키워드 강신호는 그대로 채택(기존 강점 유지), 애매할 때만 시맨틱으로 판정.
 * Ollama 임베딩이 실패하면 키워드 결과로 안전하게 폴백한다.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { embed } from "./lib/ollama.js";
import { classify, type ToolName } from "./router.js";

const PROJECT_ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");
const DATASET_DIR = process.env.DATASET_DIR ?? path.resolve(PROJECT_ROOT, "../companyx-dataset-v1.0");

export interface Anchor {
  q: string;
  tool: ToolName;
  vec: number[];
}

let ANCHORS: Anchor[] | null = null;

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-8);
}

/** questions.json 30개(또는 exclude 제외분)를 임베딩해 앵커 배열로 반환. */
export async function embedAllAnchors(exclude?: string): Promise<Anchor[]> {
  const raw = JSON.parse(readFileSync(`${DATASET_DIR}/questions.json`, "utf-8")) as {
    q: string;
    tool: ToolName;
  }[];
  const items = exclude ? raw.filter((r) => r.q !== exclude) : raw;
  return Promise.all(items.map(async (it) => ({ q: it.q, tool: it.tool, vec: await embed(it.q) })));
}

async function anchors(): Promise<Anchor[]> {
  if (!ANCHORS) ANCHORS = await embedAllAnchors();
  return ANCHORS;
}

export interface SemResult {
  tool: ToolName;
  confidence: number; // 최근접 앵커 유사도
  margin: number; // 1등 라벨 표 - 2등 라벨 표 (정규화)
  votes: Record<ToolName, number>;
}

/** 시맨틱 kNN 분류. anchorSet을 주면 그것으로(LOOCV 평가용), 아니면 전체 30개로. */
export async function classifySemantic(
  question: string,
  k = 5,
  anchorSet?: Anchor[],
): Promise<SemResult> {
  const A = anchorSet ?? (await anchors());
  const qv = await embed(question);
  const near = A.map((a) => ({ tool: a.tool, sim: cosine(qv, a.vec) }))
    .sort((x, y) => y.sim - x.sim)
    .slice(0, k);

  const votes: Record<ToolName, number> = {
    nl2sql: 0, 
    vector_search: 0, 
    knowledge_graph: 0,
    commit_history: 0, 
  };
  
  for (const n of near) votes[n.tool] += n.sim;

  const ranked = (Object.entries(votes) as [ToolName, number][]).sort((a, b) => b[1] - a[1]);
  const total = ranked.reduce((s, [, v]) => s + v, 0) || 1;
  return {
    tool: ranked[0][0],
    confidence: near[0]?.sim ?? 0,
    margin: (ranked[0][1] - ranked[1][1]) / total,
    votes,
  };
}

export interface HybridResult {
  tool: ToolName;
  via: "keyword" | "semantic" | "keyword-fallback";
  scores: Record<ToolName, number>;
}

/** 하이브리드 라우팅: 키워드 강신호 우선 → 애매하면 시맨틱 → 실패 시 키워드 폴백. */
export async function routeHybrid(
  question: string,
  opts: { semConfidence?: number; semMargin?: number } = {},
): Promise<HybridResult> {
  const semConfidence = opts.semConfidence ?? 0.55;
  const semMargin = opts.semMargin ?? 0.08;

  const kw = classify(question);
  const vals = Object.values(kw.scores);
  const kwBest = Math.max(...vals);
  const topCount = vals.filter((v) => v === kwBest).length;

  // 1) 키워드가 '단독' 신호를 주면 그대로 채택 (동점·무신호가 아닐 때).
  //    키워드 사전이 이 도메인에 잘 맞으므로, 신호가 있으면 시맨틱보다 신뢰한다.
  if (kwBest > 0 && topCount === 1) {
    return { tool: kw.tool, via: "keyword", scores: kw.scores };
  }

  // 2) 키워드가 침묵(0)하거나 동점일 때만 시맨틱으로 판정 (임베딩 실패 시 폴백)
  try {
    const sem = await classifySemantic(question);
    if (sem.confidence >= semConfidence && sem.margin >= semMargin) {
      return { tool: sem.tool, via: "semantic", scores: kw.scores };
    }
  } catch {
    /* Ollama 미가동 등 → 키워드 결과로 폴백 */
  }

  // 3) 둘 다 확신 없음 → 키워드 기본값
  return { tool: kw.tool, via: "keyword-fallback", scores: kw.scores };
}
