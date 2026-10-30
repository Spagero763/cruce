import { PGlite } from "@electric-sql/pglite";
import { Store, type Db } from "../src/db.js";

let shared: Promise<Db> | null = null;

async function start(): Promise<Db> {
  const pg = new PGlite();
  const db: Db = { query: async <T>(text: string, params?: unknown[]) => (await pg.query(text, params as never[])).rows as T[] };
  await new Store(db).migrate();
  return db;
}

/** A real Postgres running in-process, emptied for each caller. One instance per test file. */
export async function memoryStore(): Promise<Store> {
  const db = await (shared ??= start());
  await db.query("truncate hits, locks, nonces, rates, partners, quotes, orders, events, orphans, buy_calls restart identity cascade");
  return new Store(db);
}
