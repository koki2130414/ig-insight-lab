import crypto from "node:crypto";
import type { Db } from "./db";
import {
  FORMATS, PURPOSES, CHECKPOINTS, MEASUREMENTS, CONVERSION_KINDS, ATTRIBUTIONS, PERIOD_METRIC_KEYS, INTEREST_CATEGORIES,
} from "./catalog";
import {
  parseBool, parseDateTime, parseDay, parseEnum, parseNumber, parseText, parseUrl, type Parsed,
} from "./parse";

export const IMPORT_KINDS = {
  posts: "投稿",
  post_metrics: "投稿の実績（24h/72h/7d）",
  account_metrics: "アカウント指標（期間）",
  conversions: "問い合わせ・購入・申込",
  audience_people: "オーディエンスのサンプル（自己紹介・アンケート）",
  audience_aggregates: "オーディエンス集計（年齢・地域など）",
} as const;
export type ImportKind = keyof typeof IMPORT_KINDS;

type FieldSpec = { key: string; label: string; required?: boolean; aliases?: string[]; help?: string };

const metricFields: FieldSpec[] = [
  { key: "reach", label: "リーチ", aliases: ["reach", "リーチしたアカウント"] },
  { key: "views", label: "閲覧数", aliases: ["views", "ビュー", "再生数"] },
  { key: "likes", label: "いいね", aliases: ["likes", "いいね！"] },
  { key: "comments", label: "コメント", aliases: ["comments"] },
  { key: "saves", label: "保存", aliases: ["saves", "saved", "保存数"] },
  { key: "shares", label: "シェア", aliases: ["shares", "シェア数"] },
  { key: "profile_visits", label: "プロフィール訪問", aliases: ["profile_visits", "プロフィールへのアクセス"] },
  { key: "follows", label: "投稿由来フォロー", aliases: ["follows", "フォロー"] },
  { key: "non_follower_reach", label: "非フォロワーへのリーチ", aliases: ["non_follower_reach"] },
  { key: "avg_watch_sec", label: "平均視聴時間(秒)", aliases: ["avg_watch_sec"] },
];

export const IMPORT_FIELDS: Record<ImportKind, FieldSpec[]> = {
  posts: [
    { key: "url", label: "投稿URL", required: true, aliases: ["url", "permalink", "パーマリンク"] },
    { key: "posted_at", label: "投稿日時", required: true, aliases: ["posted_at", "投稿日", "公開日時", "timestamp"] },
    { key: "format", label: "形式", required: true, aliases: ["format", "投稿タイプ", "種類"], help: "reel / feed / carousel / story（日本語ラベル可）" },
    { key: "external_id", label: "メディアID", aliases: ["external_id", "media_id", "投稿ID"] },
    { key: "theme", label: "テーマ", aliases: ["theme"] },
    { key: "purpose", label: "目的", aliases: ["purpose"] },
    { key: "hook", label: "冒頭の言葉", aliases: ["hook", "フック"] },
    { key: "duration_sec", label: "動画尺(秒)", aliases: ["duration_sec", "尺"] },
    { key: "structure", label: "構成", aliases: ["structure"] },
    { key: "caption", label: "投稿文", aliases: ["caption", "説明"] },
    { key: "cta", label: "CTA", aliases: ["cta"] },
    { key: "collaborator", label: "コラボ相手", aliases: ["collaborator", "コラボ"] },
    { key: "is_ad", label: "広告利用", aliases: ["is_ad", "広告"] },
    { key: "is_giveaway", label: "プレゼント企画", aliases: ["is_giveaway", "プレゼント"] },
    { key: "production_minutes", label: "制作時間(分)", aliases: ["production_minutes"] },
    { key: "production_cost", label: "制作費(円)", aliases: ["production_cost"] },
  ],
  post_metrics: [
    { key: "post_url", label: "投稿URL", aliases: ["post_url", "url", "permalink"], help: "投稿URLかメディアIDのどちらかが必要" },
    { key: "external_id", label: "メディアID", aliases: ["external_id", "media_id"] },
    { key: "checkpoint", label: "時点", required: true, aliases: ["checkpoint", "時点"], help: "24h / 72h / 7d / other" },
    { key: "captured_at", label: "取得日時", required: true, aliases: ["captured_at", "取得日時", "記録日時"] },
    ...metricFields,
  ],
  account_metrics: [
    { key: "metric", label: "指標キー", required: true, aliases: ["metric", "指標"], help: PERIOD_METRIC_KEYS.join(" / ") },
    { key: "period_start", label: "期間開始日", required: true, aliases: ["period_start", "開始日"] },
    { key: "period_end", label: "期間終了日", required: true, aliases: ["period_end", "終了日"] },
    { key: "value", label: "値", aliases: ["value", "値"], help: "空欄は未取得として保存" },
    { key: "captured_at", label: "取得日時", aliases: ["captured_at", "取得日時"] },
  ],
  conversions: [
    { key: "occurred_at", label: "発生日時", required: true, aliases: ["occurred_at", "日時", "注文日"] },
    { key: "kind", label: "種類", required: true, aliases: ["kind", "種類"], help: Object.keys(CONVERSION_KINDS).join(" / ") },
    { key: "attribution", label: "経路の確からしさ", required: true, aliases: ["attribution", "経路"], help: "measured / self_reported / unknown_path" },
    { key: "quantity", label: "数量", aliases: ["quantity", "数量"] },
    { key: "revenue", label: "売上(円)", aliases: ["revenue", "売上"] },
    { key: "gross_profit", label: "粗利益(円)", aliases: ["gross_profit", "粗利"] },
    { key: "utm_campaign", label: "utm_campaign", aliases: ["utm_campaign"] },
    { key: "post_url", label: "関連投稿URL", aliases: ["post_url"] },
    { key: "external_ref", label: "注文番号など", aliases: ["external_ref", "注文番号", "order_id"], help: "重複防止に使う。無ければ内容から自動生成" },
    { key: "note", label: "メモ", aliases: ["note", "メモ"] },
  ],
  audience_people: [
    { key: "segment", label: "区分", required: true, aliases: ["segment", "区分"], help: "follower / commenter / survey / customer / other" },
    { key: "handle", label: "ユーザー名", required: true, aliases: ["handle", "username", "ユーザー名"] },
    { key: "bio", label: "自己紹介", aliases: ["bio", "自己紹介"] },
    { key: "survey_answer", label: "アンケート回答", aliases: ["survey_answer", "回答"] },
    { key: "selection_method", label: "対象者の選び方", required: true, aliases: ["selection_method", "選び方"] },
    { key: "self_categories", label: "本人申告カテゴリ", aliases: ["self_categories", "カテゴリ"], help: "food;education のように ; 区切り。アンケート等で本人が選んだもののみ" },
  ],
  audience_aggregates: [
    { key: "segment", label: "対象", required: true, aliases: ["segment"], help: "followers / reached / engaged" },
    { key: "dimension", label: "軸", required: true, aliases: ["dimension"], help: "age / gender / city / country" },
    { key: "bucket", label: "区分", required: true, aliases: ["bucket"] },
    { key: "value", label: "値", required: true, aliases: ["value"] },
    { key: "unit", label: "単位", aliases: ["unit"], help: "count / percent" },
    { key: "timeframe", label: "対象期間", required: true, aliases: ["timeframe"], help: "例: this_month, 2026-09" },
    { key: "captured_at", label: "取得日時", required: true, aliases: ["captured_at"] },
  ],
};

export const MAX_IMPORT_ROWS = 5000;

const FORMAT_ALIASES: Record<string, keyof typeof FORMATS> = {
  reels: "reel", "リール": "reel", image: "feed", photo: "feed", "フィード": "feed", "写真": "feed",
  carousel_album: "carousel", "カルーセル": "carousel", stories: "story", "ストーリーズ": "story", "ストーリー": "story", video: "feed",
};

export type RowResult = { row: number; ok: boolean; errors: string[]; data?: Record<string, unknown> };

/** マッピング済みの行（キー=内部キー）を検証する */
export function validateRows(kind: ImportKind, rows: Record<string, unknown>[]): RowResult[] {
  return rows.map((raw, i) => {
    const errors: string[] = [];
    const data: Record<string, unknown> = {};
    const take = <T,>(key: string, p: Parsed<T>) => {
      if (p.ok) data[key] = p.value;
      else errors.push(`${labelOf(kind, key)}: ${p.error}`);
    };
    const req = (key: string) => {
      if (data[key] === null || data[key] === undefined) errors.push(`${labelOf(kind, key)}は必須です`);
    };
    switch (kind) {
      case "posts":
        take("url", parseUrl(raw.url)); req("url");
        take("posted_at", parseDateTime(raw.posted_at, true));
        take("format", parseEnum(raw.format, FORMATS, FORMAT_ALIASES)); req("format");
        take("external_id", parseText(raw.external_id, 100));
        for (const k of ["theme", "hook", "structure", "caption", "cta", "collaborator"]) take(k, parseText(raw[k]));
        take("purpose", parseEnum(raw.purpose, PURPOSES));
        take("duration_sec", parseNumber(raw.duration_sec, { min: 0 }));
        take("is_ad", parseBool(raw.is_ad));
        take("is_giveaway", parseBool(raw.is_giveaway));
        take("production_minutes", parseNumber(raw.production_minutes, { int: true, min: 0 }));
        take("production_cost", parseNumber(raw.production_cost, { min: 0 }));
        break;
      case "post_metrics":
        take("post_url", parseUrl(raw.post_url));
        take("external_id", parseText(raw.external_id, 100));
        if (!data.post_url && !data.external_id) errors.push("投稿URLかメディアIDが必要です");
        take("checkpoint", parseEnum(raw.checkpoint, Object.fromEntries(Object.keys(CHECKPOINTS).map((k) => [k, k])) as Record<string, string>, { "24": "24h", "72": "72h", "7日": "7d", "168h": "7d" })); req("checkpoint");
        take("captured_at", parseDateTime(raw.captured_at, true));
        for (const f of metricFields) take(f.key, parseNumber(raw[f.key], { int: f.key !== "avg_watch_sec", min: 0 }));
        break;
      case "account_metrics":
        take("metric", parseEnum(raw.metric, Object.fromEntries(PERIOD_METRIC_KEYS.map((k) => [k, k])) as Record<string, string>)); req("metric");
        take("period_start", parseDay(raw.period_start));
        take("period_end", parseDay(raw.period_end));
        if (typeof data.period_start === "string" && typeof data.period_end === "string" && data.period_start > data.period_end) errors.push("期間開始日が終了日より後です");
        take("value", parseNumber(raw.value, data.metric === "follower_net" ? {} : { min: 0 }));
        take("captured_at", parseDateTime(raw.captured_at));
        break;
      case "conversions":
        take("occurred_at", parseDateTime(raw.occurred_at, true));
        take("kind", parseEnum(raw.kind, CONVERSION_KINDS)); req("kind");
        take("attribution", parseEnum(raw.attribution, ATTRIBUTIONS)); req("attribution");
        take("quantity", parseNumber(raw.quantity, { int: true, min: 0 }));
        take("revenue", parseNumber(raw.revenue));
        take("gross_profit", parseNumber(raw.gross_profit));
        take("utm_campaign", parseText(raw.utm_campaign, 200));
        take("post_url", parseUrl(raw.post_url));
        take("external_ref", parseText(raw.external_ref, 200));
        take("note", parseText(raw.note, 1000));
        break;
      case "audience_people": {
        take("segment", parseEnum(raw.segment, { follower: "フォロワー", commenter: "コメントした人", survey: "アンケート回答者", customer: "顧客", other: "その他" })); req("segment");
        take("handle", parseText(raw.handle, 100)); req("handle");
        take("bio", parseText(raw.bio, 2000));
        take("survey_answer", parseText(raw.survey_answer, 2000));
        take("selection_method", parseText(raw.selection_method, 300)); req("selection_method");
        const cats = raw.self_categories ? String(raw.self_categories).split(/[;；,、]/).map((s) => s.trim()).filter(Boolean) : [];
        const bad = cats.filter((c) => !(c in INTEREST_CATEGORIES));
        if (bad.length) errors.push(`本人申告カテゴリが不正です: ${bad.join(", ")}`);
        data.self_categories = cats.filter((c) => c in INTEREST_CATEGORIES);
        break;
      }
      case "audience_aggregates":
        take("segment", parseEnum(raw.segment, { followers: "フォロワー", reached: "到達した人", engaged: "反応した人" })); req("segment");
        take("dimension", parseEnum(raw.dimension, { age: "年齢", gender: "性別", city: "市区町村", country: "国", age_gender: "年齢×性別" })); req("dimension");
        take("bucket", parseText(raw.bucket, 100)); req("bucket");
        take("value", parseNumber(raw.value, { min: 0 })); req("value");
        take("unit", parseEnum(raw.unit ?? "count", { count: "人数", percent: "割合(%)" }));
        if (!data.unit) data.unit = "count";
        take("timeframe", parseText(raw.timeframe, 50)); req("timeframe");
        take("captured_at", parseDateTime(raw.captured_at, true));
        break;
    }
    return { row: i + 1, ok: errors.length === 0, errors, data: errors.length ? undefined : data };
  });
}

function labelOf(kind: ImportKind, key: string) {
  return IMPORT_FIELDS[kind].find((f) => f.key === key)?.label ?? key;
}

/** ヘッダ名から内部キーへの自動対応づけ */
export function autoMap(kind: ImportKind, headers: string[]) {
  const map: Record<string, string> = {};
  for (const f of IMPORT_FIELDS[kind]) {
    const cands = [f.key, f.label, ...(f.aliases ?? [])].map((s) => s.toLowerCase());
    const h = headers.find((h) => cands.includes(h.trim().toLowerCase()));
    if (h) map[f.key] = h;
  }
  return map;
}

export type CommitResult = { inserted: number; duplicates: number; errors: RowResult[]; duplicateRows: number[] };

/**
 * 検証済みの行を保存。既存と重複する行は保存しない（上書きもしない）。
 * source: csv/json, measurement: 実測/手入力/推定
 */
export async function commitRows(
  db: Db,
  accountId: string,
  kind: ImportKind,
  rows: RowResult[],
  source: "csv" | "json",
  measurement: keyof typeof MEASUREMENTS,
): Promise<CommitResult> {
  const result: CommitResult = { inserted: 0, duplicates: 0, errors: rows.filter((r) => !r.ok), duplicateRows: [] };
  const now = new Date();
  for (const r of rows) {
    if (!r.ok || !r.data) continue;
    const d = r.data;
    let inserted = 0;
    switch (kind) {
      case "posts": {
        const res = await db.query(
          `INSERT INTO posts(account_id,external_id,url,posted_at,format,theme,purpose,hook,duration_sec,structure,caption,cta,collaborator,is_ad,is_giveaway,production_minutes,production_cost,source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) ON CONFLICT DO NOTHING RETURNING id`,
          [accountId, d.external_id, d.url, d.posted_at, d.format, d.theme, d.purpose, d.hook, d.duration_sec, d.structure, d.caption, d.cta, d.collaborator, d.is_ad, d.is_giveaway, d.production_minutes, d.production_cost, source],
        );
        inserted = res.length;
        break;
      }
      case "post_metrics": {
        const posts = await db.query<{ id: string; posted_at: Date }>(
          `SELECT id, posted_at FROM posts WHERE account_id=$1 AND ((url IS NOT NULL AND url=$2) OR (external_id IS NOT NULL AND external_id=$3)) LIMIT 1`,
          [accountId, d.post_url, d.external_id],
        );
        if (!posts.length) {
          result.errors.push({ row: r.row, ok: false, errors: ["対応する投稿が未登録です（先に投稿を取り込んでください）"] });
          continue;
        }
        const cap = d.captured_at as Date;
        const hours = (cap.getTime() - new Date(posts[0].posted_at).getTime()) / 3600000;
        if (hours < 0) {
          result.errors.push({ row: r.row, ok: false, errors: ["取得日時が投稿日時より前です"] });
          continue;
        }
        const res = await db.query(
          `INSERT INTO post_metrics(post_id,account_id,checkpoint,captured_at,hours_since_post,source,measurement,reach,views,likes,comments,saves,shares,profile_visits,follows,non_follower_reach,avg_watch_sec)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) ON CONFLICT DO NOTHING RETURNING id`,
          [posts[0].id, accountId, d.checkpoint, cap, hours, source, measurement, d.reach, d.views, d.likes, d.comments, d.saves, d.shares, d.profile_visits, d.follows, d.non_follower_reach, d.avg_watch_sec],
        );
        inserted = res.length;
        break;
      }
      case "account_metrics": {
        const res = await db.query(
          `INSERT INTO account_metrics(account_id,metric,period_start,period_end,value,status,source,measurement,captured_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,
          [accountId, d.metric, d.period_start, d.period_end, d.value, d.value === null ? "not_entered" : "ok", source, measurement, d.captured_at ?? now],
        );
        inserted = res.length;
        break;
      }
      case "conversions": {
        let postId: string | null = null;
        if (d.post_url) {
          const p = await db.query<{ id: string }>(`SELECT id FROM posts WHERE account_id=$1 AND url=$2`, [accountId, d.post_url]);
          postId = p[0]?.id ?? null;
        }
        const ref = (d.external_ref as string | null) ?? "auto:" + crypto.createHash("sha256").update(JSON.stringify([d.occurred_at, d.kind, d.quantity, d.revenue, d.note, d.utm_campaign])).digest("hex").slice(0, 24);
        const res = await db.query(
          `INSERT INTO conversions(account_id,occurred_at,kind,quantity,revenue,gross_profit,attribution,post_id,utm_campaign,external_ref,note,source)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT DO NOTHING RETURNING id`,
          [accountId, d.occurred_at, d.kind, d.quantity, d.revenue, d.gross_profit, d.attribution, postId, d.utm_campaign, ref, d.note, source],
        );
        inserted = res.length;
        break;
      }
      case "audience_people": {
        const res = await db.query<{ id: string }>(
          `INSERT INTO audience_people(account_id,segment,handle,bio,survey_answer,selection_method,source)
           VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING RETURNING id`,
          [accountId, d.segment, d.handle, d.bio, d.survey_answer, d.selection_method, source],
        );
        inserted = res.length;
        if (res[0]) {
          for (const c of d.self_categories as string[]) {
            await db.query(`INSERT INTO person_tags(person_id,category,basis,evidence,confirmed) VALUES ($1,$2,'self_reported','取り込みデータの本人申告',true) ON CONFLICT DO NOTHING`, [res[0].id, c]);
          }
        }
        break;
      }
      case "audience_aggregates": {
        const res = await db.query(
          `INSERT INTO audience_aggregates(account_id,segment,dimension,bucket,value,unit,timeframe,source,captured_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING RETURNING id`,
          [accountId, d.segment, d.dimension, d.bucket, d.value, d.unit, d.timeframe, source, d.captured_at],
        );
        inserted = res.length;
        break;
      }
    }
    if (inserted) result.inserted += inserted;
    else {
      result.duplicates++;
      result.duplicateRows.push(r.row);
    }
  }
  return result;
}
