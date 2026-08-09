import { server } from "../src/index.js";
import { pool } from "../src/lib/db.js";

const qs = [
  "보안 솔루션 카테고리 제품들의 월 평균 매출은?",
  "기술지원팀 직원 목록과 연봉을 알려줘",
  "가장 많은 프로젝트를 진행 중인 고객사는?",
  "Critical 우선순위 티켓 중 아직 해결되지 않은 건은?",
  "평균 연봉이 가장 높은 부서는 어디야?",
];

async function main() {
  for (const q of qs) {
    try {
      const r = await server.callTool("nl2sql", { question: q });
      const parsed = JSON.parse(r as string);
      console.log("\nQ:", q);
      console.log("SQL:", parsed.sql);
      console.log("rowCount:", parsed.rowCount, "rows:", JSON.stringify(parsed.rows).slice(0, 300));
    } catch (e) {
      console.log("\nQ:", q, "ERROR:", (e as Error).message);
    }
  }
  await pool.end();
}

main();
