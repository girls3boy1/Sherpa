# Company-X MCP — 지능형 데이터 플랫폼 클러스터

> "사람이 말로 질문하면, AI가 스스로 DB를 뒤져서 정답을 찾아주는 시스템"

[2026 오픈소스 개발자대회 지정과제](https://liwonace.co.kr/blog/9) 구현체입니다.
PostgreSQL + pgvector 위에 **벡터 검색 / NL2SQL / 지식 그래프**를 **MCP(Model Context Protocol)** 로 통합하고,
키워드+시맨틱 하이브리드 라우터와 로컬 LLM 에이전트로 엮은 사내 데이터 어시스턴트입니다.
모든 컴포넌트가 로컬에서 동작하며 외부 API(OpenAI, Claude 등)는 사용하지 않습니다.

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
| **MCP 서버 (도구)** | 벡터 검색 / NL2SQL / 지식 그래프 (+ 커밋 이력 조회) MCP 도구 |
| **도구 자동 선택** | 하이브리드 라우터가 질문 유형을 분석해 적합한 MCP 도구를 자동 매칭 |
| **AI 에이전트 연동** | 로컬 LLM(Ollama)이 MCP로 도구를 호출하고 최종 답변 생성 |

**왜 MCP인가**: 기존 RAG 파이프라인(청킹→임베딩→인덱싱→검색→리랭킹)은 튜닝 파라미터가 많고 장애 지점이 분산돼 운영 복잡도가 높다는 문제의식에서, 도구 호출을 MCP로 표준화해 복잡도를 낮추는 것이 과제의 핵심입니다.

**데이터셋** (`companyx-dataset-v1.0`, 과제 측 제공):

| 데이터 | 형식 | 규모 | 대응 도구 |
|---|---|---|---|
| 테이블 데이터 | SQL (DDL+INSERT) | 8개 테이블, 818행 | NL2SQL |
| 문서 데이터 | Markdown | 40건 (장애보고·기술문서·회의록·제안서) | 벡터 검색 |
| 관계 데이터 | JSON (노드+엣지) | 133노드, 354관계 | 지식 그래프 |
| 예시 질문 | JSON | 30개 (도구별 10개, 정답 도구 라벨 포함) | 라우터/전체 검증용 |

데이터셋은 이 저장소가 아니라 별도로 존재하며, 위치는 `DATASET_DIR`(또는 `.env`)로 지정합니다.

## 아키텍처

```
사용자 질문 → AI 에이전트 → 하이브리드 라우터 → MCP 서버(도구) → PostgreSQL/그래프 → 최종 답변
```

- **라우터** (`src/router.ts` + `src/semanticRouter.ts`): **키워드 가중치 매칭 + bge-m3 kNN 시맨틱**의 하이브리드.
  키워드가 단독 신호를 주면 그대로 채택하고, 침묵·동점일 때만 시맨틱(30개 라벨 질문 앵커)으로 판정한다.
- **MCP 서버** (`src/index.ts` + `src/tools/*`): [air](https://airmcp.dev)(`@airmcp-dev/core`) 프레임워크로 구현.
  - `vector_search`: 질문을 **bge-m3**로 임베딩 → pgvector 코사인 유사도 검색
  - `nl2sql`: LLM이 스키마·규칙·예시를 보고 SQL 생성 → `SELECT`/`WITH`만 허용 + 금지 키워드 검사 → `READ ONLY` 트랜잭션 실행
  - `knowledge_graph`: LLM이 질의 의도를 구조화(mode 기반) → 인메모리 그래프(노드 133/엣지 354) 순회.
    **방향·2홉 경로는 관계 스키마로 코드가 결정**(LLM 방향 오류 제거). 집계·랭킹·앵커리스 질의도 지원.
  - `commit_history`: git 저장소의 커밋 이력 조회 (팀 확장 기능, `src/config/repos.ts` 로컬 설정 필요)
- **에이전트** (`src/agent.ts`): 라우터 결과로 도구 호출 → 도구 결과(JSON)를 근거로 LLM이 최종 자연어 답변 생성.

기본 LLM은 **gemma4:e2b**(과제 권장 모델)이며, `LLM_MODEL` 환경변수로 교체할 수 있습니다(예: `qwen2.5:7b`).
그래프 도구의 방향·체인·집계는 **결정적 로직**이라 모델을 바꿔도 정확도가 유지됩니다.

## 프로젝트 구조

```
Sherpa/
├── package.json / tsconfig.json
├── .env                        # 로컬 실행 환경변수 (gitignore, loadEnv가 읽음)
├── src/
│   ├── index.ts                # defineServer — MCP 서버 진입점
│   ├── router.ts               # 키워드 가중치 라우터
│   ├── semanticRouter.ts       # bge-m3 kNN 시맨틱 + 하이브리드 게이트(routeHybrid)
│   ├── agent.ts                # 질문 → 라우터 → 도구 → LLM 답변, 전체 파이프라인
│   ├── config/
│   │   ├── repos.sample.ts     # commit_history 대상 저장소 설정 템플릿
│   │   └── repos.ts            # (로컬, gitignore) 실제 경로 채운 설정
│   ├── lib/
│   │   ├── loadEnv.ts          # 의존성 없는 .env 로더 (db/graph/ollama가 먼저 import)
│   │   ├── db.ts               # PostgreSQL 커넥션 풀 (환경변수 기반)
│   │   ├── ollama.ts           # embed()/generate() — bge-m3, gemma4:e2b 래퍼
│   │   └── graph.ts            # 그래프 로드 + traverse/traverseChain/aggregateRelation/filterTraverse/findTypePath/inferDirection
│   └── tools/
│       ├── vectorSearch.ts     # MCP 도구: 벡터 검색
│       ├── nl2sql.ts           # MCP 도구: NL2SQL (SELECT 전용 가드 + 스키마 규칙·예시)
│       ├── knowledgeGraph.ts   # MCP 도구: 지식 그래프 (mode 기반, 결정적 방향/경로)
│       └── commitHistory.ts    # MCP 도구: git 커밋 이력 조회 (팀 확장)
├── scripts/
│   ├── ingest_documents.py     # 문서 40건 청킹 + 임베딩 → document_chunks 적재 (Python)
│   ├── ask.ts                  # 전체 파이프라인 CLI 데모 (라우팅 근거 + 답변)
│   ├── evaluate.ts             # questions.json 30개 엔드투엔드 정확도 (1회)
│   ├── evaluate-multi.ts       # evaluate N회 반복 → 평균·최저·최고 (비결정성 제거)
│   ├── evaluate-router.ts      # 라우터 정확도 LOOCV (데이터 누수 방지)
│   ├── test-tools.ts / test-router.ts  # 개별 검증
│   └── docs/live-query-verification.md # "암기 아닌 실시간 조회" 검증 기록
```

## 사전 준비물

| 항목 | 버전/비고 |
|---|---|
| Node.js | 22+ (개발은 26에서 진행) |
| Python | 3.10+ (문서 임베딩 적재 스크립트용) |
| Docker | PostgreSQL + pgvector 컨테이너 실행용 |
| Ollama | 로컬 LLM/임베딩 실행 — 외부 API 미사용 |
| 데이터셋 | `companyx-dataset-v1.0/` (과제 제공, [블로그](https://liwonace.co.kr/blog/9) 참고) |

Ollama 모델 2종:

```bash
ollama pull bge-m3          # 임베딩 (1024차원, 다국어) — nomic-embed-text는 한국어 변별력이 약해 교체
ollama pull gemma4:e2b      # LLM (과제 권장). qwen2.5:7b 등으로 교체 가능(LLM_MODEL)
```

## 실행 방법 (단계별)

### 1. 환경변수 설정 (.env)

프로젝트 루트에 `.env`를 만들면 `loadEnv.ts`가 자동으로 읽어 주입합니다(터미널 `export` 불필요).

```bash
# .env
DATASET_DIR=/절대경로/companyx-dataset-v1.0
LLM_MODEL=gemma4:e2b
EMBED_MODEL=bge-m3
PGHOST=localhost
PGPORT=5432
PGUSER=companyx
PGPASSWORD=companyx
PGDATABASE=companyx
DATABASE_DSN=host=localhost port=5432 user=companyx password=companyx dbname=companyx
```

### 2. PostgreSQL + pgvector (Docker)

```bash
docker run -d --name companyx-pg \
  -e POSTGRES_USER=companyx -e POSTGRES_PASSWORD=companyx -e POSTGRES_DB=companyx \
  -p 5432:5432 pgvector/pgvector:pg16

# 스키마·데이터 적재 + 임베딩 컬럼을 1024차원(bge-m3)으로 변경
docker exec -i companyx-pg psql -U companyx -d companyx < "$DATASET_DIR/sql/01-schema.sql"
docker exec -i companyx-pg psql -U companyx -d companyx < "$DATASET_DIR/sql/02-data.sql"
docker exec -i companyx-pg psql -U companyx -d companyx \
  -c "TRUNCATE document_chunks; ALTER TABLE document_chunks ALTER COLUMN embedding TYPE vector(1024);"
```

### 3. Ollama + 모델

```bash
ollama serve &           # 이미 떠 있으면 생략
ollama pull bge-m3
ollama pull gemma4:e2b
```

### 4. Node 의존성

```bash
npm install
```

### 5. 문서 임베딩 적재 (Python)

```bash
python3 -m venv .venv
./.venv/bin/pip install "psycopg[binary]"
./.venv/bin/python scripts/ingest_documents.py   # 40문서 → H2/H3 청킹(약 200청크) → bge-m3 → document_chunks
```

### 6. commit_history 설정 (선택)

git 커밋 이력 도구를 쓰려면 `src/config/repos.sample.ts`를 복사해 `src/config/repos.ts`(로컬, gitignore)를 만들고 저장소 절대경로를 채웁니다.

### 7. 실행 & 검증

```bash
npm run ask -- "백업 정책은 어떻게 되어 있어?"   # 단일 질문 (라우팅 근거 + 답변)
npm run test:tools        # 도구 개별 호출
npm run evaluate:router   # 라우터 정확도 (LOOCV)
npm run evaluate          # 전체 e2e (30문항, 1회)
npm run evaluate:multi    # e2e N회 반복 → 평균·최저·최고 (기본 3회)
```

## 검증 결과

측정: `scripts/evaluate.ts`가 DB/그래프에서 직접 산출한 정답 키워드와 최종 LLM 답변을 대조.
비결정성 제거를 위해 `evaluate:multi`로 반복 측정.

### 엔드투엔드 (권장 모델 gemma4:e2b)

**3회 반복 모두 라우터 30/30(100%) · 답변 29/29(100%)** — 편차 0으로 재현 가능한 안정성.
개발 과정에서 58.6% → 75.9% → **100%**까지 끌어올렸다(그래프 도구 확장, 방향 결정화, nl2sql 프롬프트 하드닝, 하이브리드 라우터).

> **정직한 캐비엇**: 채점은 "정답 키워드 포함 여부"의 근사치라, 일부 답변(예: Q5 부서 필터 누락)은 실제로는 어긋나도 통과할 수 있다. 또 이 30문항에 맞춰 튜닝했으므로 100%가 **미지의 질문 성능을 보장하지는 않는다**. 단, 30문항 밖 질문(대전 매출 총액=64,366, Product-C2 사용 고객사)도 실데이터로 정확히 답하는 것을 별도 확인했다(`docs/live-query-verification.md`).

### 모델 독립성

그래프 도구의 **방향·2홉 체인·집계는 코드가 결정**하므로, gemma4:e2b·qwen2.5:7b 어느 모델에서도 지식그래프 9개 평가 문항이 모두 통과한다. 즉 정확도가 특정 LLM에 종속되지 않는다.

### 벡터 검색 (bge-m3)

`nomic-embed-text`(768차원)는 한국어 변별력이 약해(예: "백업 정책" 질의에서 정답 청크가 200개 중 97위) `bge-m3`(1024차원, 다국어)로 교체. 교체 후 벡터 검색 질문이 실용적 정확도로 상위 랭크된다.

## 설계 노트 및 트러블슈팅

- **그래프 도구 확장(집계·2홉·앵커리스)**: 초기 `traverse()`는 단일 관계 순회만 가능해 "이슈 최다 제품(집계)", "Product-D1 사용 고객사의 프로젝트(USES→HAS_PROJECT 2홉)", "진행 중 프로젝트를 이끄는 직원(개체명 없음)"을 못 풀었다. `aggregateRelation`(관계 개수 랭킹), `traverseChain`/`findTypePath`(관계 스키마로 2홉 경로 자동 구성), `filterTraverse`(타입/속성 필터 시작)를 추가해 해결.
- **그래프 방향 오류 → 결정화**: 소형 LLM이 `direction(out/in)`을 자주 틀려 빈 결과가 났다. `inferDirection`으로 **앵커 노드 타입 + 관계 스키마에서 방향을 코드가 확정**해 LLM 추측을 제거.
- **NL2SQL 프롬프트 하드닝**: enum 환각(`category='보안 솔루션'`(실제 `security`), `region='seoul'`(실제 `'서울'`))·존재하지 않는 컬럼 조인·"월 평균"/랭킹/분기 형식 오류를 스키마 규칙 + (테스트와 다른 값의) 예시로 보강. GROUP BY 강제, `AVG(amount)` 규칙, `quarter='YYYY-Qn'` 등.
- **하이브리드 라우터**: 순수 키워드 라우터는 표현이 바뀌면(`사용하는`→`쓰는`) 매칭에 실패한다. bge-m3 kNN 시맨틱을 결합하되, 키워드 단독 신호가 있으면 우선하고 침묵·동점일 때만 시맨틱을 쓰는 게이트로 회귀 없이 강건성을 높였다. 평가는 데이터 누수를 막기 위해 LOOCV로 측정.
- **답변 프롬프트**: 도구가 유효 데이터를 줬는데 "확인 불가"로 답하는 불충실성, 개체명 대신 속성으로 요약, 소수 반올림 누락, 나열 시 개수 누락을 지침으로 보완.
- **임베딩/청킹**: `bge-m3`로 교체(컬럼 768→1024), 문서를 H2/H3 경계로 청킹(H3는 부모 H2를 breadcrumb으로).
- **LLM 비결정성**: 구조화 출력(SQL/그래프 스펙)에 `temperature=0`. 최종 수치는 `evaluate:multi` 반복 평균으로 확정.
- **.env 로더**: 매번 `export`하는 번거로움을 없애려 의존성 없는 `loadEnv.ts`를 만들어 db/ollama/graph가 가장 먼저 import(터미널 export가 우선).
- **커밋된 node_modules 정리**: 저장소에 `node_modules`가 실수로 커밋돼 있었고, `.gitignore`의 `lib/` 규칙이 `node_modules/*/lib/`(typescript·esbuild 등의 실제 코드)까지 제외해 설치가 깨져 있었다. `git rm -r --cached node_modules` + `npm install`로 정리.
- **데이터셋 결함**: `questions.json`의 "서울물산 담당 엔지니어" 질문의 "서울물산"은 데이터셋에 없는 이름(고객사는 전부 `Client-*`)이라 평가에서 `known-issue`로 제외.

## 알려진 한계

- **평가 채점은 근사치**: 키워드 포함 여부 기반이라, 실제로 어긋난 답이 통과하거나(예: Q5 부서 필터) 맞는 답이 반올림 차이로 FAIL 될 수 있다. 통과율은 근사값이다.
- **튜닝셋 과적합**: 100%는 제공된 30문항 기준이며, 표현이 크게 다른 미지의 질문에서는 낮아질 수 있다.
- **NL2SQL 안전장치는 프로토타입 수준**: `SELECT`/`WITH` + 금지 키워드 + `READ ONLY`로 막고 있으나, 프로덕션이라면 read-only DB 롤이 더 안전하다.
- **응답 지연**: 로컬 소형 LLM 추론(특히 콜드 스타트 시 7GB급 모델 로딩)으로 질문당 수 초가 걸린다. `OLLAMA_KEEP_ALIVE`·GPU로 단축 가능.
