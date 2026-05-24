import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "@shared/schema";

const { Pool } = pg;

let db: ReturnType<typeof drizzle> | null = null;
let pool: pg.Pool | null = null;

if (process.env.DATABASE_URL) {
  try {
    pool = new Pool({ connectionString: process.env.DATABASE_URL });
    db = drizzle(pool, { schema });
    console.log("[DB] PostgreSQL pool initialized");
  } catch (err) {
    console.warn("[DB] Failed to initialize database pool:", err);
  }
} else {
  console.warn("[DB] DATABASE_URL not set — running without database connection");
}

export { db, pool };
