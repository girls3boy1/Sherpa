import { server } from "../src/index.js";
import { pool } from "../src/lib/db.js";

const cases: { q: string; tool: "nl2sql" | "vector_search"; params: Record<string, unknown> }[] = [
  { q: "서울 지역 매출 상위 5개 고객사를 알려줘", tool: "nl2sql", params: { question: "서울 지역 매출 상위 5개 고객사를 알려줘" } },
  { q: "2025년 3분기 총 매출액은 얼마야?", tool: "nl2sql", params: { question: "2025년 3분기 총 매출액은 얼마야?" } },
  { q: "보안 솔루션 카테고리 제품들의 월 평균 매출은?", tool: "nl2sql", params: { question: "보안 솔루션 카테고리 제품들의 월 평균 매출은?" } },
  { q: "Critical 우선순위 티켓 중 아직 해결되지 않은 건은?", tool: "nl2sql", params: { question: "Critical 우선순위 티켓 중 아직 해결되지 않은 건은?" } },
  { q: "클라우드 마이그레이션 제안서 내용 보여줘", tool: "vector_search", params: { query: "클라우드 마이그레이션 제안서 내용 보여줘", limit: 5 } },
];

async function main() {
  for (const c of cases) {
    const r = await server.callTool(c.tool, c.params);
    console.log(`\n=== ${c.q} ===`);
    console.log(typeof r === "string" ? r.slice(0, 500) : r);
  }
  await pool.end();
}

main();
