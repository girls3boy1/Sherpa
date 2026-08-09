/**
 * 의존성 없는 초경량 .env 로더.
 * 프로젝트 루트(companyx-mcp)의 .env를 읽어 process.env에 주입한다.
 * - 이미 설정된 환경변수는 덮어쓰지 않는다(터미널 export가 우선).
 * - .env가 없으면 조용히 아무것도 하지 않는다.
 * db.ts / ollama.ts / graph.ts가 이 파일을 가장 먼저 import 하므로,
 * 그 모듈들이 process.env를 읽기 전에 .env가 로드된다.
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(fileURLToPath(import.meta.url), "../../..");
const ENV_PATH = process.env.ENV_FILE ?? path.join(ROOT, ".env");

if (existsSync(ENV_PATH)) {
  const text = readFileSync(ENV_PATH, "utf-8");
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key && !(key in process.env)) {
      process.env[key] = val;
    }
  }
}
