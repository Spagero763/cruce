import postgres from "postgres";
import type { Db } from "./db.js";

export function connect(url: string): Db {
  // Neon's pooler runs in transaction mode, which can't keep prepared statements.
  const sql = postgres(url, { prepare: false, max: 5, idle_timeout: 20, onnotice: () => {} });
  return {
    query: async <T>(text: string, params: unknown[] = []) => (await sql.unsafe(text, params as never[])) as unknown as T[],
  };
}
