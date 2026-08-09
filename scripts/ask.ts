import { ask } from "../src/agent.js";
import { pool } from "../src/lib/db.js";

const DEMO_QUESTIONS = [
  "서울 지역 매출 상위 5개 고객사를 알려줘",
  "백업 정책은 어떻게 되어 있어?",
  "Client-A가 사용 중인 제품은?",
];

async function main() {
  const questions = process.argv.length > 2 ? [process.argv.slice(2).join(" ")] : DEMO_QUESTIONS;

  for (const q of questions) {
    const result = await ask(q);
    console.log("\n" + "=".repeat(60));
    console.log(`Q: ${result.question}`);
    console.log(`도구: ${result.tool}  (scores: ${JSON.stringify(result.routerScores)})`);
    console.log(`A: ${result.answer}`);
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
