import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { classify } from "../src/router.js";

const PROJECT_ROOT = path.resolve(fileURLToPath(import.meta.url), "../..");
const DATASET_DIR = process.env.DATASET_DIR ?? path.resolve(PROJECT_ROOT, "../companyx-dataset-v1.0");
const questions: { q: string; tool: string; hint: string }[] = JSON.parse(
  readFileSync(`${DATASET_DIR}/questions.json`, "utf-8"),
);

let correct = 0;
const mistakes: string[] = [];

for (const { q, tool: expected } of questions) {
  const result = classify(q);
  const ok = result.tool === expected;
  if (ok) correct++;
  else mistakes.push(`  "${q}"\n    expected=${expected} got=${result.tool} scores=${JSON.stringify(result.scores)}`);
  console.log(`${ok ? "OK  " : "MISS"} [${expected} -> ${result.tool}] ${q}`);
}

console.log(`\n정확도: ${correct}/${questions.length} (${((correct / questions.length) * 100).toFixed(1)}%)`);
if (mistakes.length) {
  console.log("\n--- 오분류 상세 ---");
  console.log(mistakes.join("\n"));
}
