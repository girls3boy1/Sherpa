/**
 * 인메모리 지식 그래프.
 * 데이터셋(companyx-dataset-v1.0)의 graph/nodes.json, graph/edges.json을 로드하고
 * anchor 노드에서 관계/방향을 따라 순회하는 traverse()를 제공한다.
 *
 * 데이터셋 위치: 기본은 프로젝트 상위의 ../companyx-dataset-v1.0.
 * 다른 경로면 DATASET_DIR 환경변수로 지정한다.
 */
import "./loadEnv.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const PROJECT_ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const DATASET_DIR = process.env.DATASET_DIR ?? path.resolve(PROJECT_ROOT, "../companyx-dataset-v1.0");

export const RELATIONS = [
  "BELONGS_TO",
  "HEAD_IS",
  "USES",
  "MANAGES_ACCOUNT",
  "HAS_PROJECT",
  "LEADS",
  "REPORTED_ISSUE",
] as const;
export type Relation = (typeof RELATIONS)[number];

export interface GraphNode {
  id: string;
  type: string;
  name: string;
  properties?: Record<string, unknown>;
}

export interface GraphEdge {
  source: string;
  target: string;
  relation: Relation;
}

export const nodes: GraphNode[] = JSON.parse(
  readFileSync(`${DATASET_DIR}/graph/nodes.json`, "utf-8"),
);
export const edges: GraphEdge[] = JSON.parse(
  readFileSync(`${DATASET_DIR}/graph/edges.json`, "utf-8"),
);

const byId = new Map<string, GraphNode>(nodes.map((n) => [n.id, n]));

export function getNode(id: string): GraphNode | undefined {
  return byId.get(id);
}

/**
 * 이름 또는 id로 노드를 찾는다.
 * 1) id 정확 일치 → 2) name 정확 일치 → 3) 부분 포함(양방향).
 */
export function findNode(key: string): GraphNode | undefined {
  if (!key) return undefined;
  if (byId.has(key)) return byId.get(key);
  const exact = nodes.find((n) => n.name === key);
  if (exact) return exact;
  return nodes.find((n) => key.includes(n.name) || n.name.includes(key));
}

export interface Hop {
  relation: Relation;
  from: GraphNode;
  to: GraphNode;
}

export interface TraverseSpec {
  relation: Relation | "any";
  direction: "out" | "in" | "any";
  hops: 1 | 2;
}

/** anchor 한 노드에서 한 단계(엣지 하나) 이동. direction은 anchor 기준. */
function step(anchorId: string, relation: Relation | "any", direction: "out" | "in" | "any"): Hop[] {
  const result: Hop[] = [];
  for (const e of edges) {
    if (relation !== "any" && e.relation !== relation) continue;
    const from = byId.get(e.source);
    const to = byId.get(e.target);
    if (!from || !to) continue;
    const isOut = e.source === anchorId;
    const isIn = e.target === anchorId;
    if ((direction === "out" || direction === "any") && isOut) result.push({ relation: e.relation, from, to });
    if ((direction === "in" || direction === "any") && isIn) result.push({ relation: e.relation, from, to });
  }
  return result;
}

/**
 * anchor에서 관계/방향을 따라 순회한다(원본 동작: 단일 relation을 다단계 적용).
 * hops=2면 1단계 이웃에서 같은 relation/direction으로 한 번 더 확장한다.
 * (서로 다른 관계를 잇는 크로스릴레이션 체인은 traverseChain을 사용 — B 단계에서 추가)
 */
export function traverse(anchorId: string, spec: TraverseSpec): Hop[] {
  const first = step(anchorId, spec.relation, spec.direction);
  if (spec.hops === 1) return first;

  const seen = new Set<string>();
  const second: Hop[] = [];
  for (const h of first) {
    const neighbor = h.from.id === anchorId ? h.to : h.from;
    for (const h2 of step(neighbor.id, spec.relation, spec.direction)) {
      const key = `${h2.from.id}|${h2.relation}|${h2.to.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      second.push(h2);
    }
  }
  return [...first, ...second];
}

// ────────────────────────────────────────────────────────────────
// B단계 확장: 원본 traverse(단일 relation 순회)로 표현 불가능했던 질의 지원
//   1) traverseChain  : 서로 다른 관계를 잇는 다단계 체인 (예: USES→HAS_PROJECT)
//   2) aggregateRelation : 관계 개수 집계·랭킹 (예: 이슈 최다 제품)
//   3) filterTraverse : anchor(개체명) 없이 타입/속성 필터로 시작하는 순회
// ────────────────────────────────────────────────────────────────

export interface Step {
  relation: Relation | "any";
  /** "auto"이면 앵커 노드 타입 + 관계 스키마로 방향을 코드가 확정한다(LLM 방향 추측 무시). */
  direction: "out" | "in" | "any" | "auto";
}

/** 관계별 고정 방향(source 타입 → target 타입). 방향 추론의 근거. */
export const RELATION_SCHEMA: Record<Relation, { from: string; to: string }> = {
  BELONGS_TO: { from: "employee", to: "department" },
  HEAD_IS: { from: "department", to: "employee" },
  USES: { from: "client", to: "product" },
  MANAGES_ACCOUNT: { from: "employee", to: "client" },
  HAS_PROJECT: { from: "client", to: "project" },
  LEADS: { from: "employee", to: "project" },
  REPORTED_ISSUE: { from: "client", to: "product" },
};

/**
 * 앵커 노드 타입과 관계로 순회 방향을 확정한다.
 * 앵커가 관계의 source 타입이면 out, target 타입이면 in.
 * (LLM이 자주 틀리는 direction을 코드로 대체하기 위한 함수)
 */
export function inferDirection(anchorType: string, relation: Relation | "any"): "out" | "in" | "any" {
  if (relation === "any") return "any";
  const s = RELATION_SCHEMA[relation];
  if (!s) return "any";
  if (anchorType === s.from) return "out";
  if (anchorType === s.to) return "in";
  return "any";
}

/** step 호출 직전에 "auto" 방향을 실제 방향으로 해석한다. */
function resolveDir(
  nodeType: string,
  relation: Relation | "any",
  direction: Step["direction"],
): "out" | "in" | "any" {
  return direction === "auto" ? inferDirection(nodeType, relation) : direction;
}

/**
 * 타입 그래프에서 fromType → toType 최단 관계 경로(최대 maxHops홉)를 BFS로 찾는다.
 * 관계 스키마(RELATION_SCHEMA)만으로 방향까지 포함한 Step[]을 구성하므로,
 * LLM이 2홉 체인 스펙을 못 뱉어도 코드가 경로를 확정할 수 있다.
 * 예: findTypePath("product","project") → [{USES,in},{HAS_PROJECT,out}]
 * (RELATIONS 순서상 USES가 REPORTED_ISSUE보다 먼저라 '사용' 경로가 우선된다.)
 */
export function findTypePath(fromType: string, toType: string, maxHops = 2): Step[] | null {
  if (!fromType || !toType || fromType === toType) return null;
  const queue: { type: string; path: Step[] }[] = [{ type: fromType, path: [] }];
  const visited = new Set<string>([fromType]);
  while (queue.length) {
    const cur = queue.shift()!;
    if (cur.path.length >= maxHops) continue;
    for (const rel of RELATIONS) {
      const s = RELATION_SCHEMA[rel];
      const moves: { nb: string; dir: "out" | "in" }[] = [];
      if (cur.type === s.from) moves.push({ nb: s.to, dir: "out" });
      if (cur.type === s.to) moves.push({ nb: s.from, dir: "in" });
      for (const m of moves) {
        const path = [...cur.path, { relation: rel, direction: m.dir } as Step];
        if (m.nb === toType) return path;
        if (!visited.has(m.nb)) {
          visited.add(m.nb);
          queue.push({ type: m.nb, path });
        }
      }
    }
  }
  return null;
}

export interface ChainResult {
  hops: Hop[];
  terminals: GraphNode[];
}

/**
 * anchor에서 시작해 steps를 순서대로 적용하는 다단계 체인 순회.
 * 각 단계의 relation이 서로 달라도 된다(크로스릴레이션).
 * terminals는 마지막 단계에서 도달한 노드 집합(중복 제거).
 */
export function traverseChain(anchorId: string, steps: Step[]): ChainResult {
  let frontier: string[] = [anchorId];
  const hops: Hop[] = [];
  const seenHop = new Set<string>();
  let terminalMap = new Map<string, GraphNode>();

  for (const s of steps) {
    const next = new Map<string, GraphNode>();
    for (const id of frontier) {
      const dir = resolveDir(byId.get(id)?.type ?? "", s.relation, s.direction);
      for (const h of step(id, s.relation, dir)) {
        const neighbor = h.from.id === id ? h.to : h.from;
        next.set(neighbor.id, neighbor);
        const key = `${h.from.id}|${h.relation}|${h.to.id}`;
        if (!seenHop.has(key)) {
          seenHop.add(key);
          hops.push(h);
        }
      }
    }
    frontier = [...next.keys()];
    terminalMap = next;
  }
  return { hops, terminals: [...terminalMap.values()] };
}

export interface AggRow {
  node: GraphNode;
  count: number;
}

/**
 * 특정 관계의 엣지를 한쪽 끝(source|target) 노드 기준으로 집계해 내림차순 랭킹.
 * 예) 이슈 최다 제품 = aggregateRelation("REPORTED_ISSUE", "target")
 *     담당 고객 최다 직원 = aggregateRelation("MANAGES_ACCOUNT", "source")
 */
export function aggregateRelation(
  relation: Relation,
  groupBy: "source" | "target",
  topN = 5,
): AggRow[] {
  const counts = new Map<string, number>();
  for (const e of edges) {
    if (e.relation !== relation) continue;
    const key = groupBy === "source" ? e.source : e.target;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([id, count]) => ({ node: byId.get(id) as GraphNode, count }))
    .filter((r) => r.node)
    .sort((a, b) => b.count - a.count)
    .slice(0, topN);
}

export interface NodeFilter {
  type?: string;
  property?: string;
  value?: string;
}

/** 타입/속성으로 노드를 필터링한다. property 지정 시 properties[property] === value 인 노드만. */
export function filterNodes(f: NodeFilter): GraphNode[] {
  return nodes.filter((n) => {
    if (f.type && n.type !== f.type) return false;
    if (f.property !== undefined) {
      if (String(n.properties?.[f.property] ?? "") !== String(f.value ?? "")) return false;
    }
    return true;
  });
}

/**
 * anchor(개체명)가 없는 질의용: 필터로 시작 노드 집합을 정하고 한 단계 순회한다.
 * 예) 진행 중 프로젝트를 이끄는 직원 =
 *     filterTraverse({type:"project", property:"status", value:"in_progress"}, {relation:"LEADS", direction:"in"})
 */
export function filterTraverse(f: NodeFilter, s: Step): ChainResult {
  const start = filterNodes(f);
  const hops: Hop[] = [];
  const terminalMap = new Map<string, GraphNode>();
  for (const n of start) {
    const dir = resolveDir(n.type, s.relation, s.direction);
    for (const h of step(n.id, s.relation, dir)) {
      const neighbor = h.from.id === n.id ? h.to : h.from;
      terminalMap.set(neighbor.id, neighbor);
      hops.push(h);
    }
  }
  return { hops, terminals: [...terminalMap.values()] };
}
