import "server-only";
import fs from "node:fs";
import path from "node:path";

/**
 * DB アダプター。
 *  - DATABASE_URL が無ければ PGlite（組み込み PostgreSQL）を ./.data/pglite に保存
 *  - DATABASE_URL があれば node-postgres で接続（Supabase / PostgreSQL）
 * どちらも $1 形式のプレースホルダで query(sql, params) を呼ぶ。
 */
export type Row = Record<string, unknown>;
export interface Db {
  query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
  transaction<T>(fn: (tx: Db) => Promise<T>): Promise<T>;
}

type Holder = { db?: Promise<Db> };
const g = globalThis as unknown as { __igdb?: Holder };
g.__igdb ??= {};

async function createPglite(dataDir: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (!dataDir.startsWith("memory://")) fs.mkdirSync(dataDir, { recursive: true });
  const pg = new PGlite(dataDir);
  await pg.waitReady;
  const wrap = (q: { query: typeof pg.query }): Db => ({
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await q.query<T>(sql, params.map(normalizeParam));
      return r.rows;
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      return fn(this);
    },
  });
  const db = wrap(pg);
  db.transaction = async <T,>(fn: (tx: Db) => Promise<T>) =>
    pg.transaction(async (tx) => fn(wrap(tx as unknown as { query: typeof pg.query }))) as Promise<T>;
  return db;
}

async function createPg(url: string): Promise<Db> {
  const { Pool } = await import("pg");
  // Supabase の接続プーラーは独自CAの証明書のため、ローカル以外は TLS を使い証明書検証は行わない
  const u = new URL(url);
  const local = ["localhost", "127.0.0.1", "::1"].includes(u.hostname);
  u.searchParams.delete("sslmode");
  const pool = new Pool({
    connectionString: u.toString(),
    max: process.env.VERCEL ? 2 : 5,
    ssl: local || process.env.DATABASE_SSL === "disable" ? undefined : { rejectUnauthorized: false },
  });
  // 共用の Supabase プロジェクトでも他アプリと混ざらないよう、専用スキーマを使う（DB_SCHEMA）
  const schema = dbSchema();
  if (schema !== "public") pool.on("connect", (client) => void client.query(`SET search_path TO "${schema}"`));
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      const r = await pool.query(sql, params.map(normalizeParam));
      return r.rows as T[];
    },
    async transaction<T>(fn: (tx: Db) => Promise<T>) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const tx: Db = {
          async query<U>(sql: string, params: unknown[] = []) {
            const r = await client.query(sql, params.map(normalizeParam));
            return r.rows as U[];
          },
          transaction: (f) => f(tx),
        };
        const out = await fn(tx);
        await client.query("COMMIT");
        return out;
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    },
  };
  return db;
}

function normalizeParam(p: unknown) {
  if (p === undefined) return null;
  if (p !== null && typeof p === "object" && !(p instanceof Date)) return JSON.stringify(p);
  return p;
}

export function schemaSql() {
  return fs.readFileSync(path.join(process.cwd(), "db", "schema.sql"), "utf8");
}

/** 使用するスキーマ名（英小文字・数字・_ のみ） */
export function dbSchema() {
  const s = process.env.DB_SCHEMA || "public";
  if (!/^[a-z_][a-z0-9_]{0,40}$/.test(s)) throw new Error("DB_SCHEMA は英小文字・数字・_ で指定してください");
  return s;
}

export async function getDb(): Promise<Db> {
  const h = g.__igdb!;
  if (!h.db) {
    h.db = (async () => {
      if (process.env.VERCEL && !process.env.DATABASE_URL) {
        // Vercel ではファイルが保存されないため、組み込みDBは使わない
        throw new Error("DATABASE_URL が未設定です（Vercel では Supabase などの PostgreSQL が必要です）");
      }
      const db = process.env.DATABASE_URL
        ? await createPg(process.env.DATABASE_URL)
        : await createPglite(process.env.PGLITE_DIR || path.join(process.cwd(), ".data", "pglite"));
      await bootstrap(db);
      return db;
    })();
    h.db.catch(() => {
      h.db = undefined;
    });
  }
  return h.db;
}

/** テスト用: 新しいインメモリDBを作る */
export async function createTestDb(): Promise<Db> {
  const db = await createPglite("memory://");
  await bootstrap(db);
  return db;
}

async function bootstrap(db: Db) {
  const { ensureSeed } = await import("./seed");
  if (process.env.DATABASE_URL) {
    // 複数のサーバーが同時に起動しても初期化が重ならないよう、トランザクション内でアドバイザリロックを取る
    await db.transaction(async (tx) => {
      const schema = dbSchema();
      await tx.query("SELECT pg_advisory_xact_lock(213213)");
      if (schema !== "public") {
        // 既にあるときは作らない（専用ユーザーにはデータベース全体への作成権限が無いため）
        const exists = await tx.query(`SELECT 1 FROM pg_namespace WHERE nspname = $1`, [schema]);
        if (!exists.length) await tx.query(`CREATE SCHEMA "${schema}"`);
        await tx.query(`SET LOCAL search_path TO "${schema}", public`);
      }
      for (const stmt of splitSql(schemaSql())) await tx.query(stmt);
      await ensureSeed(tx);
    });
    return;
  }
  // PGlite は ; で分割して1文ずつ流す
  for (const stmt of splitSql(schemaSql())) await db.query(stmt);
  await ensureSeed(db);
}

function splitSql(sql: string) {
  return sql
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}
