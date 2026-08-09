import { defineTool } from "@airmcp-dev/core";
import { pool } from "../lib/db.js";
import { embed, vectorLiteral } from "../lib/ollama.js";

export const vectorSearchTool = defineTool("vector_search", {
  description:
    "비정형 문서(장애보고서, 기술문서, 회의록, 제안서)를 의미 기반으로 검색한다. " +
    "장애 원인, 설치/운영 방법, 회의 내용, 제안 내용처럼 서술형 정보를 찾을 때 사용한다.",
  params: {
    query: "string",
    limit: "number?",
  },
  annotations: { readOnlyHint: true },
  handler: async (params) => {
    const { query, limit } = params as { query: string; limit?: number };
    const vec = vectorLiteral(await embed(query));
    const topK = limit ?? 5;
    const { rows } = await pool.query(
      `SELECT doc_id, chunk_index, content, metadata,
              1 - (embedding <=> $1::vector) AS similarity
       FROM document_chunks
       ORDER BY embedding <=> $1::vector
       LIMIT $2`,
      [vec, topK],
    );
    return {
      query,
      results: rows.map((r) => ({
        docId: r.doc_id,
        title: r.metadata?.title,
        type: r.metadata?.type,
        similarity: Number(r.similarity.toFixed(3)),
        content: r.content,
      })),
    };
  },
});
