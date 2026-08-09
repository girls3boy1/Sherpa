/**
 * 라우터 정확도 LOOCV(leave-one-out) 평가.
 *
 * 시맨틱 라우터는 questions.json 30개를 앵커로 쓰므로, 같은 30개로 채점하면
 * 자기 자신이 앵커라 100%가 나오는 데이터 누수가 생긴다. 이를 막기 위해 각 질문을
 * 채점할 때 그 질문만 앵커에서 제외한 나머지 29개로 분류한다.
 *
 * 키워드 단독 vs 하이브리드 정확도를 나란히 출력한다.
 * 사전 준비: Ollama(bge-m3) 가동, DATASET_DIR(기본 ../companyx-dataset-v1.0).
 *   실행:  npx tsx scripts/evaluate-router.ts
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { classify, type ToolName } from "../src/router.js";
import { classifySemantic, embedAllAnchors, type Anchor } from "../src/semanticRouter.js";

const PROJECT_ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");
const DATASET_DIR = process.env.DATASET_DIR ?? path.resolve(PROJECT_ROOT, "../companyx-dataset-v1.0");
const questions: { q: string; tool: ToolName }[] = JSON.parse(
  readFileSync(`${DATASET_DIR}/questions.json`, "utf-8"),
);

// 하이브리드 판정 (routeHybrid와 동일 로직이되, 앵커셋을 주입해 LOOCV로 평가)
async function hybrid(question: string, anchorSet: Anchor[]): Promise<ToolName> {
  const kw = classify(question);
  const vals = Object.values(kw.scores);
  const kwBest = Math.max(...vals);
  const topCount = vals.filter((v) => v === kwBest).length;
  if (kwBest > 0 && topCount === 1) return kw.tool; // 키워드 단독 신호 우선
  const sem = await classifySemantic(question, 5, anchorSet);
  if (sem.confidence >= 0.55 && sem.margin >= 0.08) return sem.tool;
  return kw.tool;
}

async function main() {
  console.log("앵커 임베딩 중(30개)...");
  const all = await embedAllAnchors();

  let kwCorrect = 0;
  let hyCorrect = 0;
  const rows: string[] = [];

  for (const item of all) {
    const others = all.filter((a) => a.q !== item.q); // LOOCV: 자기 자신 제외
    const kwTool = classify(item.q).tool;
    const hyTool = await hybrid(item.q, others);

    const kwOk = kwTool === item.tool;
    const hyOk = hyTool === item.tool;
    if (kwOk) kwCorrect++;
    if (hyOk) hyCorrect++;

    const flag = kwOk === hyOk ? " " : hyOk ? "↑" : "↓";
    rows.push(
      `${flag} 기대=${item.tool.padEnd(15)} 키워드=${kwOk ? "O" : "X"}(${kwTool}) 하이브리드=${hyOk ? "O" : "X"}(${hyTool})  ${item.q}`,
    );
  }

  console.log(rows.join("\n"));
  console.log("\n" + "=".repeat(60));
  const n = all.length;
  console.log(`키워드 단독 (LOOCV): ${kwCorrect}/${n} (${((kwCorrect / n) * 100).toFixed(1)}%)`);
  console.log(`하이브리드 (LOOCV): ${hyCorrect}/${n} (${((hyCorrect / n) * 100).toFixed(1)}%)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
