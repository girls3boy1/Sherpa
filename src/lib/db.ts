import "./loadEnv.js";
import pg from "pg";

const { Pool } = pg;

/**
 * PostgreSQL 커넥션 풀.
 * 기본값은 macOS(Homebrew) 로컬 소켓 접속(host: "/tmp")이며,
 * 환경변수(PGHOST/PGPORT/PGDATABASE/PGUSER/PGPASSWORD)로 재정의할 수 있다.
 * user/password를 지정하지 않으면 OS 사용자 기반 peer 인증을 사용한다.
 */
export const pool = new Pool({
  host: process.env.PGHOST ?? "/tmp",
  port: process.env.PGPORT ? Number(process.env.PGPORT) : 5432,
  database: process.env.PGDATABASE ?? "companyx",
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
});
