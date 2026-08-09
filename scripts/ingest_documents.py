"""
DOC-001~040.md를 섹션(H2/H3 헤더) 단위로 청킹하고 bge-m3로 임베딩하여
document_chunks 테이블에 적재한다.
"""
import json
import os
import re
import urllib.request
from pathlib import Path

import psycopg

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATASET_DIR = Path(os.environ.get("DATASET_DIR", PROJECT_ROOT.parent / "companyx-dataset-v1.0"))
DOCUMENTS_DIR = DATASET_DIR / "documents"
OLLAMA_URL = "http://localhost:11434/api/embeddings"
EMBED_MODEL = "bge-m3"
DSN = os.environ.get("DATABASE_DSN", "host=/tmp dbname=companyx")

HEADING_RE = re.compile(r"^(#{2,3}) (.+)$", re.MULTILINE)


def chunk_document(text: str) -> list[str]:
    """H2/H3 헤더를 경계로 분할. H3는 부모 H2를 breadcrumb으로 붙여 문맥을 보존한다."""
    lines = text.strip().splitlines()
    title = lines[0].lstrip("# ").strip() if lines and lines[0].startswith("#") else ""

    matches = list(HEADING_RE.finditer(text))
    if not matches:
        return [text.strip()]

    chunks = []
    current_h2 = ""
    for i, m in enumerate(matches):
        level = len(m.group(1))
        heading_text = m.group(2).strip()
        start = m.start()
        end = matches[i + 1].start() if i + 1 < len(matches) else len(text)
        body_lines = text[start:end].strip().splitlines()
        content = "\n".join(body_lines[1:]).strip()

        if level == 2:
            current_h2 = heading_text
            breadcrumb = heading_text
        else:
            breadcrumb = f"{current_h2} - {heading_text}" if current_h2 else heading_text

        if not content:
            continue
        chunk = f"# {title}\n\n## {breadcrumb}\n\n{content}" if title else f"## {breadcrumb}\n\n{content}"
        chunks.append(chunk)
    return chunks


def embed(text: str) -> list[float]:
    payload = json.dumps({"model": EMBED_MODEL, "prompt": text}).encode()
    req = urllib.request.Request(OLLAMA_URL, data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["embedding"]


def vector_literal(vec: list[float]) -> str:
    return "[" + ",".join(f"{v:.8f}" for v in vec) + "]"


def main() -> None:
    index = json.loads((DOCUMENTS_DIR / "index.json").read_text())
    meta_by_id = {d["id"]: d for d in index}

    with psycopg.connect(DSN) as conn:
        with conn.cursor() as cur:
            cur.execute("TRUNCATE document_chunks RESTART IDENTITY;")

            total_chunks = 0
            for doc in index:
                doc_id = doc["id"]
                path = DOCUMENTS_DIR / doc["filename"]
                text = path.read_text(encoding="utf-8")
                chunks = chunk_document(text)

                for idx, chunk in enumerate(chunks):
                    vec = embed(chunk)
                    metadata = {"type": doc["type"], "title": doc["title"]}
                    cur.execute(
                        """
                        INSERT INTO document_chunks (doc_id, chunk_index, content, embedding, metadata)
                        VALUES (%s, %s, %s, %s::vector, %s::jsonb)
                        """,
                        (doc_id, idx, chunk, vector_literal(vec), json.dumps(metadata, ensure_ascii=False)),
                    )
                    total_chunks += 1

                print(f"{doc_id}: {len(chunks)} chunks")

        conn.commit()
        print(f"\n총 {len(index)}개 문서 -> {total_chunks}개 청크 적재 완료")


if __name__ == "__main__":
    main()
