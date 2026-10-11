import "server-only";
import type { Db } from "../db";
import { redact } from "../secrets";
import { metaConfigured } from "./adapter";
import { syncAccount } from "./sync";

/** 前回の同期からこの時間が過ぎていれば、画面を開いたときにも裏で同期する */
export const STALE_MS = 60 * 60 * 1000;
/** 同期が途中で止まった場合に、次の同期を許可するまでの時間 */
const LOCK_MS = 10 * 60 * 1000;

/**
 * 同期を始めてよいかを確認し、開始時刻を記録する（多重実行の防止）。
 * 実データ・接続中のアカウントのみ対象。
 */
async function claim(db: Db, accountId: string, staleMs: number) {
  const rows = await db.query<{ account_id: string }>(
    `UPDATE connections c SET sync_started_at=now()
       FROM accounts a
      WHERE c.account_id=$1 AND a.id=c.account_id AND a.dataset='real'
        AND c.status='connected' AND c.token_ciphertext IS NOT NULL
        AND (c.sync_started_at IS NULL OR c.sync_started_at < now() - ($2::int * interval '1 millisecond'))
        AND (c.last_synced_at IS NULL OR c.last_synced_at < now() - ($3::int * interval '1 millisecond'))
      RETURNING c.account_id`,
    [accountId, LOCK_MS, staleMs]);
  return rows.length > 0;
}

export type AutoResult = { accountId: string; handle: string; ok: boolean; message: string };

/**
 * 接続済みの実データアカウントを同期する。
 * staleMs: 前回同期からこの時間が経っていないアカウントは飛ばす（0 なら常に同期）
 * userId を渡すと、そのユーザーのアカウントだけを対象にする
 */
export async function syncConnected(db: Db, opts: { staleMs: number; userId?: string }): Promise<AutoResult[]> {
  if (!metaConfigured().ok) return [];
  const accounts = await db.query<{ id: string; handle: string }>(
    `SELECT a.id, a.handle FROM accounts a JOIN connections c ON c.account_id=a.id
      WHERE a.dataset='real' AND c.status='connected' AND c.token_ciphertext IS NOT NULL ${opts.userId ? "AND a.user_id=$1" : ""}
      ORDER BY c.last_synced_at NULLS FIRST`,
    opts.userId ? [opts.userId] : []);
  const results: AutoResult[] = [];
  for (const a of accounts) {
    if (!(await claim(db, a.id, opts.staleMs))) continue;
    try {
      const r = await syncAccount(db, a.id);
      results.push({ accountId: a.id, handle: a.handle, ok: true, message: `投稿${r.media}件・スナップショット${r.snapshots}件` });
    } catch (e) {
      results.push({ accountId: a.id, handle: a.handle, ok: false, message: redact((e as Error).message) });
    } finally {
      await db.query(`UPDATE connections SET sync_started_at=NULL WHERE account_id=$1`, [a.id]);
    }
  }
  return results;
}
