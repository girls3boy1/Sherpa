import { server } from "../src/index.js";
import { pool } from "../src/lib/db.js";

const qs = ["클라우드사업부 소속 직원들은 누구야?", "경영지원팀 팀장은 누구야?"];

async function main() {
  for (const q of qs) {
    const r = await server.callTool("knowledge_graph", { question: q });
    console.log("\nQ:", q);
    console.log(r);
  }
  await pool.end();
}

main();
