import json
import os
import urllib.request
from pathlib import Path

import psycopg

DSN = os.environ.get("DATABASE_DSN", "host=/tmp dbname=companyx")
OLLAMA_URL = "http://localhost:11434/api/embeddings"


def embed(text: str) -> list[float]:
    payload = json.dumps({"model": "bge-m3", "prompt": text}).encode()
    req = urllib.request.Request(OLLAMA_URL, data=payload, headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as resp:
        return json.loads(resp.read())["embedding"]


def vector_literal(vec: list[float]) -> str:
    return "[" + ",".join(f"{v:.8f}" for v in vec) + "]"


PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATASET_DIR = os.environ.get("DATASET_DIR", str(PROJECT_ROOT.parent / "companyx-dataset-v1.0"))
all_q = json.load(open(f"{DATASET_DIR}/questions.json"))
queries = [q["q"] for q in all_q if q["tool"] == "vector_search"]

with psycopg.connect(DSN) as conn:
    with conn.cursor() as cur:
        for q in queries:
            vec = vector_literal(embed(q))
            cur.execute(
                """
                SELECT doc_id, metadata->>'title' AS title,
                       1 - (embedding <=> %s::vector) AS similarity
                FROM document_chunks
                ORDER BY embedding <=> %s::vector
                LIMIT 3
                """,
                (vec, vec),
            )
            print(f"\nQ: {q}")
            for doc_id, title, sim in cur.fetchall():
                print(f"  [{sim:.3f}] {doc_id} - {title}")
