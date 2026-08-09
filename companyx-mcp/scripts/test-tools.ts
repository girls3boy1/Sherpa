import { server } from "../src/index.js";
import { pool } from "../src/lib/db.js";

async function main() {
  console.log("=== vector_search ===");
  const vs = await server.callTool("vector_search", {
    query: "백업 정책은 어떻게 되어 있어?",
    limit: 3,
  });
  console.log(JSON.stringify(vs, null, 2));

  console.log("\n=== nl2sql ===");
  const sql = await server.callTool("nl2sql", {
    question: "서울 지역 매출 상위 5개 고객사를 알려줘",
  });
  console.log(JSON.stringify(sql, null, 2));

  console.log("\n=== knowledge_graph ===");
  const kg = await server.callTool("knowledge_graph", {
    question: "Client-A가 사용 중인 제품은?",
  });
  console.log(JSON.stringify(kg, null, 2));

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
