# Company-X MCP — 지능형 데이터 플랫폼 클러스터

> "사람이 말로 질문하면, AI가 스스로 DB를 뒤져서 정답을 찾아주는 시스템"

[2026 오픈소스 개발자대회 지정과제](https://liwonace.co.kr/blog/9) 구현체입니다.
PostgreSQL + pgvector 위에 **벡터 검색 / NL2SQL / 지식 그래프**라는 세 가지 검색 방식을 **MCP(Model Context Protocol)** 로 통합하고, 규칙 기반 라우터와 로컬 LLM 에이전트로 엮은 사내 데이터 어시스턴트입니다. 모든 컴포넌트가 로컬에서 동작하며 외부 API(OpenAI, Claude 등)는 사용하지 않습니다.

## 목차

- [과제 개요](#과제-개요)
- [아키텍처](#아키텍처)
- [프로젝트 구조](#프로젝트-구조)
- [사전 준비물](#사전-준비물)
- [실행 방법](#실행-방법-단계별)
- [검증 결과](#검증-결과)
- [설계 노트 및 트러블슈팅](#설계-노트-및-트러블슈팅)
- [알려진 한계](#알려진-한계)

---

## 과제 개요

리원에이스가 주최한 "2026 오픈소스 개발자대회"의 지정과제로, 가상의 IT 솔루션 기업 **Company-X**(직원 45명, 고객사 30개)의 운영 데이터를 대상으로 다음 4개 컴포넌트를 구현하는 것이 목표입니다.

| 컴포넌트 | 설명 |
|---|---|
| **벡터 데이터베이스** | PostgreSQL + pgvector로 문서를 벡터 변환·저장하고 유사도 기반 의미 검색 수행 |
| **MCP 서버 (도구 3종)** | 벡터 검색 / NL2SQL / 지식 그래프 — 3개의 MCP 도구 |
| **도구 자동 선택** | 규칙 기반 라우터가 질문 유형을 분석해 적합한 MCP 도구를 자동 매칭 |
| **AI 에이전트 연동** | 로컬 LLM(Ollama)이 MCP로 도구를 호출하고 최종 답변 생성 |

**왜 MCP인가**: 기존 RAG 파이프라인(청킹→임베딩→인덱싱→검색→리랭킹)은 튜닝 파라미터가 많고 장애 지점이 분산돼 운영 복잡도가 높다는 문제의식에서, 도구 호출을 MCP로 표준화해 복잡도를 낮추는 것이 과제의 핵심입니다.

**데이터셋** (`companyx-dataset-v1.0`, 과제 측 제공):

| 데이터 | 형식 | 규모 | 대응 도구 |
|---|---|---|---|
| 테이블 데이터 | SQL (DDL+INSERT) | 8개 테이블, 818행 | NL2SQL |
| 문서 데이터 | Markdown | 40건 (장애보고·기술문서·회의록·제안서) | 벡터 검색 |
| 관계 데이터 | JSON (노드+엣지) | 133노드, 354관계 | 지식 그래프 |
| 예시 질문 | JSON | 30개 (도구별 10개, 정답 도구 라벨 포함) | 라우터/전체 검증용 |

이 저장소는 데이터셋 자체가 아니라 **그 데이터셋 위에서 동작하는 4개 컴포넌트 구현체**입니다. `companyx-mcp/`가 이 저장소이고, 데이터셋은 상위 디렉터리의 `companyx-dataset-v1.0/`에 별도로 존재해야 합니다(다운로드 방법은 [사전 준비물](#사전-준비물) 참고).

## 아키텍처

```
사용자 질문 → AI 에이전트 → 라우터 → MCP 서버(3도구) → PostgreSQL/그래프 → 최종 답변
```

- **라우터** (`src/router.ts`): 가중치 키워드 매칭으로 질문을 3개 도구 중 하나로 분류
- **MCP 서버** (`src/index.ts` + `src/tools/*`): [air](https://airmcp.dev)(`@airmcp-dev/core`) 프레임워크로 구현한 MCP 서버. 도구 3개 등록
  - `vector_search`: 질문을 bge-m3로 임베딩 → pgvector 코사인 유사도 검색
  - `nl2sql`: qwen2.5:7b가 스키마를 보고 SQL 생성 → `SELECT`/`WITH`만 허용 + 금지 키워드 검사 → `READ ONLY` 트랜잭션으로 실행
  - `knowledge_graph`: qwen2.5:7b가 질문을 `{anchor, relation, direction, hops}`로 구조화 → 인메모리 그래프(노드 133/엣지 354) 순회
- **에이전트** (`src/agent.ts`): 라우터 결과로 도구 호출 → 도구 결과(JSON)를 근거로 qwen2.5:7b가 최종 자연어 답변 생성

## 프로젝트 구조

```
companyx-mcp/
├── package.json / tsconfig.json
├── src/
│   ├── index.ts              # defineServer — MCP 서버 진입점 (stdio transport)
│   ├── router.ts              # 규칙 기반 라우터 (가중치 키워드 매칭)
│   ├── agent.ts                # 질문 → 라우터 → 도구 → LLM 답변, 전체 파이프라인
│   ├── lib/
│   │   ├── db.ts               # PostgreSQL 커넥션 풀 (pg)
│   │   ├── ollama.ts           # embed()/generate() — bge-m3, qwen2.5:7b 래퍼
│   │   └── graph.ts            # 그래프 로드(nodes/edges.json) + traverse()
│   └── tools/
│       ├── vectorSearch.ts     # MCP 도구: 벡터 검색
│       ├── nl2sql.ts           # MCP 도구: NL2SQL (SELECT 전용 가드 포함)
│       └── knowledgeGraph.ts   # MCP 도구: 지식 그래프 탐색
└── scripts/
    ├── ingest_documents.py     # 문서 40건 청킹 + 임베딩 → document_chunks 적재 (Python)
    ├── test_vector_search.py   # 벡터 검색 단독 검증 (Python)
    ├── test-tools.ts           # 3개 MCP 도구 개별 호출 검증
    ├── test-router.ts          # 라우터 정확도 검증 (questions.json 30개)
    ├── ask.ts                  # 전체 파이프라인 CLI 데모
    ├── evaluate.ts             # questions.json 30개 전체 엔드투엔드 정확도 측정
    └── debug-*.ts               # 개발 중 사용한 개별 이슈 디버깅 스크립트
```

## 사전 준비물

| 항목 | 버전/비고 |
|---|---|
| Node.js | 22+ (개발은 26에서 진행) |
| Python | 3.10+ (문서 임베딩 적재 스크립트용) |
| PostgreSQL | 15+, `pgvector` 확장 필요 |
| Ollama | 로컬 LLM 실행 — 외부 API 미사용 |
| 데이터셋 | `companyx-dataset-v1.0/` (과제 제공, [블로그](https://liwonace.co.kr/blog/9) 참고) |

Ollama 모델 2종이 필요합니다:

```bash
ollama pull bge-m3          # 임베딩 (1024차원, 다국어) — nomic-embed-text는 한국어 변별력이 약해 교체함
ollama pull qwen2.5:7b      # LLM — NL2SQL/그래프 질의 해석/최종 답변 생성
```

## 실행 방법 (단계별)

### 1. 데이터셋 배치

이 저장소(`companyx-mcp/`)와 같은 부모 디렉터리에 데이터셋을 둡니다.

```
ADA/OSS/
├── companyx-mcp/            ← 이 저장소
└── companyx-dataset-v1.0/   ← 과제 데이터셋 (별도 다운로드)
```

경로가 다르면 `DATASET_DIR` 환경변수로 지정할 수 있습니다.

### 2. PostgreSQL + pgvector 준비

```bash
# 이미 실행 중인 PostgreSQL 15+가 있다면 이 단계는 건너뛰고 DB만 생성
createdb companyx
psql -d companyx -f ../companyx-dataset-v1.0/sql/01-schema.sql   # DDL + pgvector 확장
psql -d companyx -f ../companyx-dataset-v1.0/sql/02-data.sql     # 정형 데이터 818행 적재
```

> macOS(Homebrew)에서 로컬 소켓으로 붙이는 경우 `-h /tmp` 를 붙이세요 (`psql -h /tmp -d companyx ...`). `src/lib/db.ts`의 기본 접속 설정도 `host: "/tmp"` 입니다 — 다른 환경이면 이 파일을 맞게 수정하세요.

### 3. Ollama 기동 + 모델 준비

```bash
ollama serve &            # 이미 떠 있다면 생략
ollama pull bge-m3
ollama pull qwen2.5:7b
```

### 4. Node.js 의존성 설치

```bash
npm install
```

### 5. 문서 임베딩 적재 (Python)

```bash
python3 -m venv .venv
./.venv/bin/pip install "psycopg[binary]"
./.venv/bin/python scripts/ingest_documents.py
```

문서 40건을 H2/H3 헤더 기준으로 청킹(총 200개 청크)하고 bge-m3로 임베딩해 `document_chunks` 테이블에 적재합니다. `document_chunks.embedding` 컬럼이 이미 `vector(768)`(nomic 기준)로 만들어져 있다면 먼저 아래로 1024차원으로 바꿔야 합니다.

```sql
TRUNCATE document_chunks;
ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(1024);
```

### 6. 개별 도구 동작 확인

```bash
npm run test:tools      # vector_search / nl2sql / knowledge_graph 각각 직접 호출
```

### 7. 라우터 정확도 확인

```bash
npm run test:router     # questions.json 30개 기준 라우터 분류 정확도
```

### 8. 전체 파이프라인 데모

```bash
npm run ask                                    # 내장된 3개 데모 질문 실행
npm run ask -- "백업 정책은 어떻게 되어 있어?"    # 질문 직접 지정
```

### 9. 전체 엔드투엔드 정확도 측정

```bash
npm run evaluate       # questions.json 30개 전체: 라우터 정확도 + 최종 답변 정확도
```

### 10. MCP 서버 단독 기동 (stdio)

실제 MCP 클라이언트(Claude Desktop 등)에 붙이려면:

```bash
npm run dev             # tsx src/index.ts — stdio transport로 대기
```

클라이언트 설정 예시(`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "companyx": {
      "command": "npx",
      "args": ["tsx", "/absolute/path/to/companyx-mcp/src/index.ts"]
    }
  }
}
```

## 검증 결과

### 라우터 (규칙 기반)

`questions.json` 30개 기준 **30/30 (100%)**. 단, 이는 예시 질문의 정확한 표현에 맞춰 키워드를 설계한 결과이며, 같은 의미라도 다른 단어를 쓰면(`사용하는`→`쓰는`, `이끄는`→`맡고 있는`) 매칭에 실패해 기본값(`vector_search`)으로 빠지는 것을 별도 테스트로 확인했습니다. 순수 키워드 기반 라우터의 구조적 한계입니다.

### 벡터 검색 (bge-m3)

처음에는 `nomic-embed-text`(768차원)를 썼으나 한국어 도메인 텍스트에서 변별력이 약해(예: "백업 정책" 질의에서 정답 청크가 200개 중 97위) `bge-m3`(1024차원, 다국어)로 교체했습니다. 교체 후 `questions.json`의 벡터 검색 질문 10개 중 9개가 top-3 이내 정답, 1개(Kubernetes 장애)는 top-4 — 근소한 차이로 실용적 수준입니다.

### 엔드투엔드 (라우터 + 도구 + LLM 최종 답변)

`scripts/evaluate.ts`로 DB/그래프에서 직접 뽑은 정답 키워드와 최종 LLM 답변을 대조했습니다. 여러 차례 원인 진단 → 수정 → 재검증을 반복해 **58.6% → 69.0% → 75.9%**까지 끌어올렸습니다 (라우터는 전 구간 100%). 과제 블로그가 자체 언급한 기본 정확도(64%)와 비슷하거나 더 나은 수준입니다.

## 설계 노트 및 트러블슈팅

개발 중 겪은 문제와 원인, 조치를 기록합니다. 향후 유지보수 시 같은 문제를 반복하지 않기 위한 기록입니다.

- **Homebrew PostgreSQL 17 설치가 깨져 있었음**: `pgvector`를 설치하면서 `share/postgresql@17`, `lib/postgresql@17` 디렉터리에 pgvector 자신의 파일만 채워지고 PostgreSQL 본체 파일(`postgres.bki`, `timezone/`, `plpgsql` 등)은 없는 상태였습니다. `initdb`가 계속 실패해 Cellar의 원본 파일을 심볼릭 링크로 보강해서 해결했습니다. `brew services`도 현재 Homebrew 버전 버그로 동작하지 않아 `pg_ctl`로 직접 기동했습니다.
- **임베딩 모델 선택**: 과제 문서는 `nomic-embed-text`를 예시로 들지만, 실측 결과 한국어 검색 정확도가 낮아 `bge-m3`로 교체(임베딩 컬럼도 768→1024차원 변경). `nomic`은 `search_query:`/`search_document:` 프리픽스를 붙여도 개선 폭이 작았습니다.
- **문서 청킹 단위**: 처음엔 H2(`##`) 헤더만 경계로 나눴는데, 기술문서류는 H3(`###`)가 실제 내용 단위라 청크가 문서 전체(1개)로 뭉쳐서 "백업 정책" 같은 세부 질의가 200개 중 97위로 밀렸습니다. H2/H3 모두 경계로 잡고 H3는 부모 H2를 breadcrumb으로 붙이도록 수정해 해결했습니다.
- **`air` 프레임워크 검증**: 블로그의 예시 코드(`defineTool`, `use: [...]`)를 그대로 믿지 않고 `npm pack @airmcp-dev/core`로 실제 패키지를 받아 타입 정의(`dist/*.d.ts`)를 확인한 뒤 구현했습니다. 실재하는 정식 패키지(Apache-2.0, GitHub `airmcp-dev/air`)였습니다.
- **NL2SQL의 값(enum) 환각**: LLM이 실제 DB에 저장된 값을 모르고 그럴듯한 값을 추측해 빈 결과를 냈습니다(`category='보안 솔루션'`(실제는 `security`), `region='seoul'`(실제는 `'서울'`), `status='진행 중'`(실제는 `in_progress`) 등). 스키마 프롬프트에 컬럼별 실제 enum 값과 포맷(`quarter`는 `'YYYY-Qn'`)을 명시하고, 외래키는 참조 테이블을 조인해 이름으로 반환하도록 지침을 추가해 상당 부분 해결했습니다.
- **지식 그래프 anchor 오역**: qwen2.5:7b가 JSON 모드에서 종종 질문 속 한국어 개체명("클라우드사업부")을 중국어로 바꿔버려 노드를 못 찾는 문제가 있었습니다. "번역하지 말고 원문 그대로 복사하라"는 지침을 추가하고, 그래도 실패하면 질문 원문에 실제 노드 이름이 포함돼 있는지 직접 대조하는 폴백을 코드에 추가했습니다.
- **관계 방향 혼동**: `HEAD_IS`(department→employee)와 `BELONGS_TO`(employee→department)처럼 방향이 반대인 관계에서 LLM이 anchor 기준 방향(`out`/`in`)을 헷갈렸습니다. 관계 정의 옆에 방향 판단 예시를 붙여 해결했습니다.
- **LLM 비결정성**: 같은 질문도 실행마다 SQL/JSON 결과가 달라지는 경우가 있어 구조화된 출력(SQL 생성, 그래프 질의 해석)에는 `temperature=0`을 기본값으로 설정했습니다.
- **최종 답변의 불충실성(unfaithfulness)**: 도구가 유효한 데이터를 반환했는데도 최종 답변 LLM이 "확인할 수 없습니다"라고 답하는 경우가 있었습니다. 최종 답변 프롬프트에 "결과 배열에 값이 있으면 반드시 인용하라"는 지침을 추가해 완화했습니다.
- **데이터셋 자체의 결함 발견**: `questions.json`의 "서울물산 담당 엔지니어는 누구야?" 질문에 나오는 "서울물산"이라는 이름이 데이터셋 어디에도 존재하지 않습니다(고객사명은 전부 `Client-A`~`Client-AZ` 형식). 과제 데이터셋의 결함으로 판단해 평가 스크립트에서 별도 표기(`known-issue`)로 제외했습니다.

## 알려진 한계

- **라우터 일반화**: 규칙(키워드) 기반이라 학습된 표현과 다른 문구는 기본값(`vector_search`)으로 빠질 수 있습니다.
- **지식 그래프 도구가 지원하지 않는 질의 유형**:
  - 집계/랭킹 (예: "기술 지원 이슈가 가장 많은 제품은?") — 현재는 단순 순회만 지원, 카운트 후 정렬 로직 없음
  - 서로 다른 관계를 잇는 2-hop 체인 (예: "Product-D1 사용 고객사의 프로젝트는?" — `USES` 다음 `HAS_PROJECT`) — 현재 `traverse()`는 하나의 relation만 다단계에 적용
  - 특정 개체명이 없는 질의 (예: "진행 중인 프로젝트를 이끄는 직원 목록") — anchor를 노드 이름 매칭으로 찾는 구조라 앵커가 없는 질문은 처리 불가
- **NL2SQL 안전장치는 프로토타입 수준**: `SELECT`/`WITH` 시작 + 금지 키워드 정규식 검사 + `READ ONLY` 트랜잭션으로 막고 있지만, 프로덕션이라면 별도의 read-only DB 롤을 사용하는 것이 더 안전합니다.
- **평가 스크립트의 정답 판정은 키워드 포함 여부의 근사치**입니다. 숫자 반올림 차이(`589.97` vs `590`) 등으로 실제로는 맞는 답이 FAIL로 잡히는 경우가 있어, `evaluate.ts`의 통과율은 하한선에 가깝습니다.
