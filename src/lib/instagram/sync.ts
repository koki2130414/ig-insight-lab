import "server-only";
import type { Db } from "../db";
import { decryptSecret, encryptSecret, redact } from "../secrets";
import { graphAdapter, refreshToken, type InsightsAdapter } from "./adapter";
import { addDays, jstDay, jstDayEnd, jstDayStart, weekStart } from "../time";
import { normalizeIgUrl } from "../parse";
import type { Checkpoint, Format } from "../catalog";

function formatOf(m: { media_type: string; media_product_type?: string }): Format {
  if (m.media_product_type === "REELS") return "reel";
  if (m.media_product_type === "STORY") return "story";
  if (m.media_type === "CAROUSEL_ALBUM") return "carousel";
  return "feed";
}

/** 同期した時点の経過時間からチェックポイントを決める（±25%以内のみ。過去時点の値は復元しない） */
export function checkpointFor(hours: number): Checkpoint {
  for (const [cp, h] of [["24h", 24], ["72h", 72], ["7d", 168]] as const) if (Math.abs(hours - h) / h <= 0.25) return cp;
  return "other";
}

// 形式ごとに要求する投稿インサイト（公式ドキュメントで対応が確認できたもののみ）
const MEDIA_METRICS: Record<Format, string[]> = {
  reel: ["reach", "views", "likes", "comments", "saved", "shares", "ig_reels_avg_watch_time"],
  feed: ["reach", "views", "likes", "comments", "saved", "shares", "profile_visits", "follows"],
  carousel: ["reach", "views", "likes", "comments", "saved", "shares", "profile_visits", "follows"],
  story: ["reach", "views", "shares", "profile_visits", "follows"],
};
const COL: Record<string, string> = { saved: "saves", ig_reels_avg_watch_time: "avg_watch_sec" };

export async function syncAccount(db: Db, accountId: string, adapterOverride?: InsightsAdapter) {
  const [conn] = await db.query<{ token_ciphertext: string | null; token_expires_at: Date | null; status: string }>(
    `SELECT token_ciphertext, token_expires_at, status FROM connections WHERE account_id=$1`, [accountId]);
  if (!adapterOverride && (!conn || conn.status !== "connected" || !conn.token_ciphertext)) throw new Error("未接続です");
  let adapter = adapterOverride;
  if (!adapter) {
    let token = decryptSecret(conn.token_ciphertext!);
    // 期限7日前を切ったら更新（長期トークンは60日）
    if (conn.token_expires_at && new Date(conn.token_expires_at).getTime() - Date.now() < 7 * 86400000) {
      const r = await refreshToken(token);
      token = r.accessToken;
      await db.query(`UPDATE connections SET token_ciphertext=$2, token_expires_at=$3, updated_at=now() WHERE account_id=$1`, [accountId, encryptSecret(token), r.expiresAt]);
    }
    adapter = graphAdapter(token);
  }

  const now = new Date();
  const notes: string[] = [];
  try {
    const profile = await adapter.profile();
    const today = jstDay(now);
    if (typeof profile.followers_count === "number") {
      await db.query(
        `INSERT INTO account_metrics(account_id,metric,period_start,period_end,value,status,source,measurement,captured_at)
         VALUES ($1,'followers',$2,$2,$3,'ok','api','measured',$4) ON CONFLICT (account_id,metric,period_start,period_end,source) DO UPDATE SET value=EXCLUDED.value, captured_at=EXCLUDED.captured_at`,
        [accountId, today, profile.followers_count, now]);
    }

    const media = await adapter.recentMedia(50);
    let snapshots = 0;
    for (const m of media) {
      const format = formatOf(m);
      const url = m.permalink ? normalizeIgUrl(m.permalink) : null;
      // 手入力・CSVで先に登録済みの投稿（URLのみ）にメディアIDを紐づける
      // 投稿URLの /p/ と /reel/ の違いや、Web版のIDが入っている場合も、ショートコードで同じ投稿とみなす
      const code = url?.match(/\/(?:p|reel|tv)\/([^/]+)\/$/)?.[1];
      if (code) {
        await db.query(
          `UPDATE posts SET external_id=$2, url=$3, updated_at=now()
            WHERE account_id=$1 AND right(url, length($4)) = $4 AND external_id IS DISTINCT FROM $2
              AND NOT EXISTS (SELECT 1 FROM posts q WHERE q.account_id=$1 AND q.external_id=$2)`,
          [accountId, m.id, url, `/${code}/`]);
      }
      const [post] = await db.query<{ id: string }>(
        `INSERT INTO posts(account_id,external_id,url,posted_at,format,caption,source) VALUES ($1,$2,$3,$4,$5,$6,'api')
         ON CONFLICT (account_id, external_id) WHERE external_id IS NOT NULL DO UPDATE SET caption=EXCLUDED.caption, updated_at=now() RETURNING id`,
        [accountId, m.id, url, new Date(m.timestamp), format, m.caption ?? null]);
      const hours = (now.getTime() - new Date(m.timestamp).getTime()) / 3600000;
      if (hours > 24 * 30) continue; // 30日より古い投稿のスナップショットは比較に使わないため取らない
      const values = await adapter.mediaInsights(m.id, MEDIA_METRICS[format]);
      const row: Record<string, number | null> = {};
      for (const v of values) {
        const col = COL[v.name] ?? v.name;
        row[col] = v.name === "ig_reels_avg_watch_time" && v.value !== null ? v.value / 1000 : v.value;
      }
      const cp = checkpointFor(hours);
      await db.query(
        `INSERT INTO post_metrics(post_id,account_id,checkpoint,captured_at,hours_since_post,source,measurement,reach,views,likes,comments,saves,shares,profile_visits,follows,avg_watch_sec,note)
         VALUES ($1,$2,$3,$4,$5,'api','measured',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) ON CONFLICT DO NOTHING`,
        [post.id, accountId, cp, now, hours, row.reach ?? null, row.views ?? null, row.likes ?? null, row.comments ?? null, row.saves ?? null, row.shares ?? null,
          row.profile_visits ?? null, row.follows ?? null, row.avg_watch_sec ?? null,
          values.filter((v) => v.error).map((v) => `${v.name}: ${v.error}`).join(" / ") || null]);
      snapshots++;
    }

    // 直近の完了した週（月〜日, JST）のアカウント指標
    const start = addDays(weekStart(jstDay(now)), -7);
    const end = addDays(start, 6);
    const since = Math.floor(jstDayStart(start).getTime() / 1000);
    const until = Math.floor(jstDayEnd(end).getTime() / 1000) - 1;
    const totals = await adapter.accountTotals(["reach", "views", "accounts_engaged", "saves", "shares", "comments", "profile_links_taps"], since, until);
    const rf = await adapter.accountBreakdown("reach", "follow_type", since, until);
    const fu = await adapter.accountBreakdown("follows_and_unfollows", "follow_type", since, until);
    const put = async (metric: string, value: number | null, error?: string) => {
      await db.query(
        `INSERT INTO account_metrics(account_id,metric,period_start,period_end,value,status,unavailable_reason,source,measurement,captured_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,'api','measured',$8)
         ON CONFLICT (account_id,metric,period_start,period_end,source) DO UPDATE SET value=EXCLUDED.value,status=EXCLUDED.status,unavailable_reason=EXCLUDED.unavailable_reason,captured_at=EXCLUDED.captured_at`,
        [accountId, metric, start, end, value, value === null ? "unavailable" : "ok", error ? redact(error) : null, now]);
    };
    for (const t of totals) await put(t.name === "profile_links_taps" ? "link_taps" : t.name, t.value, t.error);
    await put("reach_non_follower", rf.breakdown["NON_FOLLOWER"] ?? null, rf.error ?? (rf.breakdown["NON_FOLLOWER"] === undefined ? "内訳が返りませんでした" : undefined));
    const follows = fu.breakdown["FOLLOWER"];
    const unfollows = fu.breakdown["NON_FOLLOWER"];
    await put("follower_net", follows !== undefined && unfollows !== undefined ? follows - unfollows : null, fu.error ?? (follows === undefined ? "フォロワー100人未満などで返りませんでした" : undefined));

    // フォロワー属性（取得できた集計のみ保存）
    for (const [seg, metric] of [["followers", "follower_demographics"], ["engaged", "engaged_audience_demographics"]] as const) {
      for (const bd of ["age", "gender", "city"]) {
        const r = await adapter.demographics(metric, bd, "this_month");
        if (r.error) {
          notes.push(`${metric}/${bd}: ${r.error}`);
          continue;
        }
        for (const [bucket, value] of Object.entries(r.breakdown)) {
          await db.query(
            `INSERT INTO audience_aggregates(account_id,segment,dimension,bucket,value,unit,timeframe,source,captured_at) VALUES ($1,$2,$3,$4,$5,'count','this_month','api',$6) ON CONFLICT DO NOTHING`,
            [accountId, seg, bd, bucket, value, now]);
        }
      }
    }

    await db.query(`UPDATE connections SET last_synced_at=$2, last_sync_range=$3, last_error=$4, ig_username=$5, updated_at=now() WHERE account_id=$1`,
      [accountId, now, `投稿: 直近${media.length}件（スナップショット${snapshots}件） / 週次: ${start}〜${end}`, notes.length ? redact(notes.join("\n")).slice(0, 2000) : null, profile.username]);
    return { media: media.length, snapshots, period: `${start}〜${end}`, notes };
  } catch (e) {
    const msg = redact((e as Error).message);
    await db.query(`UPDATE connections SET last_error=$2, status=CASE WHEN $3 THEN 'expired' ELSE status END, updated_at=now() WHERE account_id=$1`,
      [accountId, msg, /expired|session has been invalidated|code 190/i.test(msg)]);
    throw new Error(msg);
  }
}
