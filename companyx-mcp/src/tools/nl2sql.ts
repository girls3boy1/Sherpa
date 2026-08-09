import { defineTool } from "@airmcp-dev/core";
import { pool } from "../lib/db.js";
import { generate } from "../lib/ollama.js";

const SCHEMA = `
departments(id, name, head_id -> employees.id)
employees(id, name, email, position, dept_id -> departments.id, hire_date, salary, is_active)
clients(id, name, industry, region[경기|광주|대구|대전|부산|서울|인천|제주], company_size[enterprise|mid|startup], contact_name, contact_email, registered_at, is_active)
products(id, name, category[cloud|consulting|data|security], description, price_monthly, version, release_date, status)
contracts(id, client_id -> clients.id, product_id -> products.id, manager_id -> employees.id, contract_type[maintenance|project|subscription], amount, start_date, end_date, status[active|cancelled|completed])
projects(id, name, client_id -> clients.id, manager_id -> employees.id, contract_id -> contracts.id, status[planning|in_progress|on_hold|completed], start_date, end_date, budget)
sales(id, contract_id -> contracts.id, client_id -> clients.id, product_id -> products.id, amount, sale_date, quarter[형식: 'YYYY-Qn', 예: '2025-Q3'], category[cloud|consulting|data|security], region[경기|광주|대구|대전|부산|서울|인천|제주])
support_tickets(id, client_id -> clients.id, product_id -> products.id, assignee_id -> employees.id, title, description, priority[low|medium|high|critical], status[open|in_progress|resolved|closed] (미해결=open,in_progress / 해결됨=resolved,closed), created_at, resolved_at)
`.trim();

const FORBIDDEN = /\b(insert|update|delete|drop|alter|truncate|create|grant|revoke|copy|call|do)\b/i;

function extractSql(response: string): string {
  const fenced = response.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  const sql = (fenced ? fenced[1] : response).trim();
  return sql.replace(/;+\s*$/, "");
}

export const nl2sqlTool = defineTool("nl2sql", {
  description:
    "자연어 질문을 SQL로 변환해 정형 데이터(매출, 계약, 고객, 직원, 프로젝트, 기술지원 티켓)를 조회한다. " +
    "집계, 통계, 랭킹, 필터링처럼 숫자/정형 데이터 질의에 사용한다.",
  params: {
    question: "string",
  },
  annotations: { readOnlyHint: true },
  handler: async (params) => {
    const { question } = params as { question: string };
    const prompt = `다음은 PostgreSQL 데이터베이스 스키마입니다.

${SCHEMA}

사용자 질문에 답하는 SQL SELECT 쿼리를 작성하세요.
규칙:
- SELECT 문만 작성 (INSERT/UPDATE/DELETE/DDL 금지)
- 컬럼명 뒤 [a|b|c]는 해당 컬럼에 실제 저장된 값이다. WHERE 절에는 반드시 이 목록에 있는 값 그대로를 사용할 것 (한국어 지역명은 한국어 그대로, 그 외는 영문 소문자). 질문의 다른 한국어 표현(예: "진행 중", "심각", "활성")을 절대 그대로 값으로 쓰지 말고 반드시 괄호 안 목록의 값으로 치환할 것
- region 컬럼 값은 절대 영어로 번역하지 말 것 (예: '서울' O, 'seoul' X)
- _id로 끝나는 외래키 컬럼의 실제 이름이 필요하면 해당 테이블을 JOIN해서 name 컬럼을 함께 SELECT할 것 (id 숫자만 반환하지 말 것)
- 위 스키마에 명시된 컬럼만 사용할 것. 존재하지 않는 컬럼을 지어내지 말 것 (예: support_tickets 테이블에는 contract_id 컬럼이 없다)
- "상위/최다 N개 <고객사|제품|부서|직원>" 같은 랭킹은 반드시 그 개체로 GROUP BY 한 뒤 집계(SUM/COUNT)하고 ORDER BY ... DESC LIMIT N. 개별 행을 그대로 나열하지 말 것
- "평균 매출" 또는 "월 평균 매출"은 조건에 맞는 sales 행들의 AVG(amount)로 계산할 것
- 분기(예: "3분기") 질문은 sale_date 범위가 아니라 quarter 컬럼을 'YYYY-Qn' 형식으로 필터할 것 (예: quarter = '2025-Q3')
- 개수/합계/평균만 묻는 질문은 집계 함수(COUNT/SUM/AVG)로 단일 값을 반환할 것
- 결과가 많을 수 있는 경우 LIMIT을 적절히 사용
- \`\`\`sql 코드블록 안에만 SQL을 작성하고 다른 설명은 넣지 마세요

예시 (패턴 참고용, 실제 질문에 맞게 응용할 것):
Q: 2024년 1분기 총 매출액은?
A: \`\`\`sql
SELECT SUM(amount) FROM sales WHERE quarter = '2024-Q1'
\`\`\`
Q: cloud 카테고리의 평균 매출은?
A: \`\`\`sql
SELECT AVG(amount) FROM sales WHERE category = 'cloud'
\`\`\`
Q: 매출 상위 3개 제품은?
A: \`\`\`sql
SELECT p.name, SUM(s.amount) AS total
FROM sales s JOIN products p ON p.id = s.product_id
GROUP BY p.id, p.name ORDER BY total DESC LIMIT 3
\`\`\`
Q: high 우선순위 미해결 티켓은?
A: \`\`\`sql
SELECT * FROM support_tickets WHERE priority = 'high' AND status IN ('open', 'in_progress')
\`\`\`

질문: ${question}`;

    const response = await generate(prompt);
    const sql = extractSql(response);

    if (!/^(select|with)\b/i.test(sql)) {
      throw new Error(`생성된 쿼리가 SELECT로 시작하지 않습니다: ${sql}`);
    }
    if (FORBIDDEN.test(sql)) {
      throw new Error(`허용되지 않은 SQL 키워드가 포함되어 있습니다: ${sql}`);
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN READ ONLY");
      const { rows } = await client.query(sql);
      await client.query("COMMIT");
      return { question, sql, rowCount: rows.length, rows };
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  },
});
