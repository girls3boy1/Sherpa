import { generate } from "../src/lib/ollama.js";

const SCHEMA = `
departments(id, name, head_id -> employees.id)
employees(id, name, email, position, dept_id -> departments.id, hire_date, salary, is_active)
clients(id, name, industry, region, company_size[enterprise|mid|startup], contact_name, contact_email, registered_at, is_active)
products(id, name, category[cloud|consulting|data|security], description, price_monthly, version, release_date, status)
contracts(id, client_id -> clients.id, product_id -> products.id, manager_id -> employees.id, contract_type[maintenance|project|subscription], amount, start_date, end_date, status[active|cancelled|completed])
projects(id, name, client_id -> clients.id, manager_id -> employees.id, contract_id -> contracts.id, status[planning|in_progress|on_hold|completed], start_date, end_date, budget)
sales(id, contract_id -> contracts.id, client_id -> clients.id, product_id -> products.id, amount, sale_date, quarter, category[cloud|consulting|data|security], region)
support_tickets(id, client_id -> clients.id, product_id -> products.id, assignee_id -> employees.id, title, description, priority[low|medium|high|critical], status[open|in_progress|resolved|closed], created_at, resolved_at)
`.trim();

const qs = ["기술지원팀 직원 목록과 연봉을 알려줘", "Critical 우선순위 티켓 중 아직 해결되지 않은 건은?"];

async function main() {
  for (const q of qs) {
    const prompt = `다음은 PostgreSQL 데이터베이스 스키마입니다.

${SCHEMA}

사용자 질문에 답하는 SQL SELECT 쿼리를 작성하세요.
규칙:
- SELECT 문만 작성 (INSERT/UPDATE/DELETE/DDL 금지)
- 컬럼명 뒤 [a|b|c]는 해당 컬럼에 실제 저장된 값이다. WHERE 절에는 반드시 이 목록에 있는 값 그대로(영문 소문자)를 사용하고, 질문의 한국어 표현(예: "진행 중", "심각", "활성")을 절대 그대로 값으로 쓰지 말 것
- _id로 끝나는 외래키 컬럼의 실제 이름이 필요하면 해당 테이블을 JOIN해서 name 컬럼을 함께 SELECT할 것 (id 숫자만 반환하지 말 것)
- 결과가 많을 수 있는 경우 LIMIT을 적절히 사용
- \`\`\`sql 코드블록 안에만 SQL을 작성하고 다른 설명은 넣지 마세요

질문: ${q}`;
    const raw = await generate(prompt);
    console.log("\n=== Q:", q, "===");
    console.log(raw);
  }
}

main();
