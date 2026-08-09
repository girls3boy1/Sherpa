/**
 * Ollama 로컬 LLM 래퍼.
 * - embed():   bge-m3 임베딩(1024차원, 다국어). document_chunks.embedding 컬럼과 차원이 일치해야 한다.
 * - generate(): qwen2.5:7b 텍스트 생성. 구조화 출력(SQL/그래프 질의 해석)을 위해 기본 temperature=0(결정적).
 * - vectorLiteral(): number[] → pgvector 리터럴 문자열("[0.1,0.2,...]").
 * 모델/호스트는 환경변수로 재정의 가능(OLLAMA_HOST, EMBED_MODEL, LLM_MODEL).
 */

const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const EMBED_MODEL = process.env.EMBED_MODEL ?? "bge-m3";
const LLM_MODEL = process.env.LLM_MODEL ?? "gemma4:e2b";

export async function embed(text: string): Promise<number[]> {
  const res = await fetch(`${OLLAMA_HOST}/api/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!res.ok) {
    throw new Error(`Ollama embeddings 실패 (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { embedding?: number[] };
  if (!data.embedding) throw new Error("Ollama embeddings 응답에 embedding이 없습니다.");
  return data.embedding;
}

export interface GenerateOptions {
  /** "json"이면 Ollama가 유효한 JSON만 반환하도록 강제한다. */
  format?: "json";
  /** 기본 0(결정적). 자연어 답변에서 다양성이 필요하면 상향. */
  temperature?: number;
}

export async function generate(prompt: string, opts: GenerateOptions = {}): Promise<string> {
  const body: Record<string, unknown> = {
    model: LLM_MODEL,
    prompt,
    stream: false,
    options: { temperature: opts.temperature ?? 0 },
  };
  if (opts.format) body.format = opts.format;

  const res = await fetch(`${OLLAMA_HOST}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Ollama generate 실패 (${res.status}): ${await res.text()}`);
  }
  const data = (await res.json()) as { response?: string };
  return data.response ?? "";
}

/** pgvector 파라미터 바인딩용 리터럴. 예: [0.12,0.34,...] */
export function vectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}
