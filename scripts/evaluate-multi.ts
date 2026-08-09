/**
 * evaluate를 N회 반복 실행해 라우터/답변 정확도의 평균·최저·최고를 출력한다.
 * LLM 비결정성으로 회차마다 점수가 흔들리므로, 단일 실행 대신 이걸로 안정 수치를 확보한다.
 *
 * 실행:
 *   npm run evaluate:multi            # 기본 3회
 *   npm run evaluate:multi -- 5       # 5회
 *   RUNS=5 npm run evaluate:multi     # 환경변수로 지정
 *
 * 모델은 프로세스 시작 시점의 LLM_MODEL로 고정된다(ollama.ts가 로드 시 읽음).
 * gemma vs qwen 비교는 각각 따로 실행:
 *   LLM_MODEL=gemma4:e2b npm run evaluate:multi
 *   LLM_MODEL=qwen2.5:7b npm run evaluate:multi
 */
import { evaluateOnce } from "./evaluate.js";
import { pool } from "../src/lib/db.js";

const RUNS = Number(process.env.RUNS ?? process.argv[2] ?? 3);
const MODEL = process.env.LLM_MODEL ?? "gemma4:e2b";

function stat(arr: number[]): { avg: number; min: number; max: number } {
  const avg = arr.reduce((a, b) => a + b, 0) / arr.length;
  return { avg, min: Math.min(...arr), max: Math.max(...arr) };
}

async function main() {
  console.log(`모델 = ${MODEL} · ${RUNS}회 반복 측정\n`);
  const routerPcts: number[] = [];
  const answerPcts: number[] = [];

  for (let i = 0; i < RUNS; i++) {
    const r = await evaluateOnce(true); // silent
    const rp = (r.routerCorrect / r.total) * 100;
    const ap = (r.answerCorrect / r.answerEvaluable) * 100;
    routerPcts.push(rp);
    answerPcts.push(ap);
    console.log(
      `Run ${i + 1}/${RUNS}:  라우터 ${r.routerCorrect}/${r.total} (${rp.toFixed(1)}%)  ·  ` +
        `답변 ${r.answerCorrect}/${r.answerEvaluable} (${ap.toFixed(1)}%)`,
    );
  }

  const rt = stat(routerPcts);
  const an = stat(answerPcts);
  console.log("\n" + "=".repeat(60));
  console.log(`[${MODEL}] ${RUNS}회 종합`);
  console.log(`라우터 정확도   평균 ${rt.avg.toFixed(1)}%   (최저 ${rt.min.toFixed(1)}% · 최고 ${rt.max.toFixed(1)}%)`);
  console.log(`답변 정확도     평균 ${an.avg.toFixed(1)}%   (최저 ${an.min.toFixed(1)}% · 최고 ${an.max.toFixed(1)}%)`);

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
