import { server } from "../src/index.js";
import { pool } from "../src/lib/db.js";

async function main() {
  const r1 = await server.callTool("nl2sql", { question: "서울 지역 매출 상위 5개 고객사를 알려줘" });
  console.log("Q1:", r1);
  const r7 = await server.callTool("nl2sql", { question: "Critical 우선순위 티켓 중 아직 해결되지 않은 건은?" });
  console.log("Q7:", r7);
  await pool.end();
}

main();
