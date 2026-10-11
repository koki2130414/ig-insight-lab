// 純粋関数（DBに依存しない）。テスト対象。
import { POST_RATES, CHECKPOINTS, type Checkpoint } from "./catalog";

export type Num = number | null | undefined;

/** 比率。分子・分母が欠損、または分母が0以下なら null（算出しない） */
export function safeRate(num: Num, den: Num): number | null {
  if (num === null || num === undefined || den === null || den === undefined) return null;
  if (!Number.isFinite(num) || !Number.isFinite(den) || den <= 0) return null;
  return num / den;
}

export function median(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

export function mean(values: number[]): number | null {
  const v = values.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** null を除外して集計。件数も返す（欠損はゼロとして扱わない） */
export function summarize(values: Num[]) {
  const v = values.filter((x): x is number => x !== null && x !== undefined && Number.isFinite(x));
  return { n: v.length, missing: values.length - v.length, mean: mean(v), median: median(v) };
}

export type MetricRow = {
  post_id: string;
  checkpoint: Checkpoint;
  hours_since_post: number | null;
  reach: number | null;
  views: number | null;
  likes: number | null;
  comments: number | null;
  saves: number | null;
  shares: number | null;
  profile_visits: number | null;
  follows: number | null;
  non_follower_reach: number | null;
  avg_watch_sec: number | null;
};

export function ratesFor(m: Partial<MetricRow>) {
  const out: Record<string, number | null> = {};
  for (const r of POST_RATES) {
    out[r.key] = safeRate(m[r.num as keyof MetricRow] as Num, m[r.den as keyof MetricRow] as Num);
  }
  return out;
}

/** 経過時間のずれ。チェックポイントの名目時間から ±25% を超えると警告 */
export function checkpointDrift(cp: Checkpoint, hours: number | null): "ok" | "drift" | "unknown" {
  const nominal = CHECKPOINTS[cp].hours;
  if (nominal === null || hours === null) return "unknown";
  return Math.abs(hours - nominal) / nominal > 0.25 ? "drift" : "ok";
}

export type PeerPost = {
  id: string;
  account_id: string;
  format: string;
  purpose: string | null;
  is_ad: boolean | null;
  is_giveaway: boolean | null;
  posted_at: Date | string;
};

export type CompareOptions = {
  checkpoint: Checkpoint;
  samePurpose: boolean;
  excludeAds: boolean;
  excludeDrift: boolean;
};

/**
 * 比較対象を選ぶ: 同じアカウント・同じ形式・同じチェックポイント（＝投稿後経過時間）に限る。
 * other チェックポイントは経過時間がそろわないため比較に使わない。
 */
export function selectPeers(
  target: PeerPost,
  posts: PeerPost[],
  metrics: MetricRow[],
  opt: CompareOptions,
): { peers: PeerPost[]; peerMetrics: MetricRow[] } {
  if (opt.checkpoint === "other") return { peers: [], peerMetrics: [] };
  const byPost = new Map<string, MetricRow>();
  for (const m of metrics) if (m.checkpoint === opt.checkpoint) byPost.set(m.post_id, m);
  const peers = posts.filter((p) => {
    if (p.id === target.id) return false;
    if (p.account_id !== target.account_id) return false;
    if (p.format !== target.format) return false;
    if (opt.samePurpose && p.purpose !== target.purpose) return false;
    if (opt.excludeAds && (p.is_ad || p.is_giveaway)) return false;
    const m = byPost.get(p.id);
    if (!m) return false;
    if (opt.excludeDrift && checkpointDrift(opt.checkpoint, m.hours_since_post) === "drift") return false;
    return true;
  });
  return { peers, peerMetrics: peers.map((p) => byPost.get(p.id)!) };
}

export const COMPARE_KEYS = ["reach", "views", "saves", "shares", "profile_visits", "follows", ...POST_RATES.map((r) => r.key)] as const;

export function compareStats(target: MetricRow | undefined, peerMetrics: MetricRow[]) {
  const peerRates = peerMetrics.map((m) => ({ ...m, ...ratesFor(m) }));
  const tRates = target ? { ...target, ...ratesFor(target) } : undefined;
  return COMPARE_KEYS.map((key) => {
    const s = summarize(peerRates.map((m) => (m as unknown as Record<string, Num>)[key]));
    const value = tRates ? ((tRates as unknown as Record<string, Num>)[key] ?? null) : null;
    const vsMedian = value !== null && s.median !== null && s.median > 0 ? value / s.median : null;
    return { key, value, ...s, vsMedian };
  });
}

/** 期間指標の比較は「同じ期間・同じ定義」に限る */
export function samePeriod(a: { period_start: string; period_end: string }, b: { period_start: string; period_end: string }) {
  return a.period_start === b.period_start && a.period_end === b.period_end;
}

/** 施策の判定提案。単発の結果で勝ちパターンを断定しない */
export function suggestDecision(results: { vsMedian: number | null }[]): { decision: "retest" | "continue" | "modify" | "stop"; reason: string } {
  const valid = results.filter((r) => r.vsMedian !== null) as { vsMedian: number }[];
  if (valid.length === 0) return { decision: "retest", reason: "比較できる結果がまだありません（指標未入力または比較対象不足）。" };
  if (valid.length === 1) {
    return { decision: "retest", reason: `結果は1回分のみです（中央値比 ${valid[0].vsMedian.toFixed(2)}倍）。単発の結果では判断しません。同じ変更点でもう一度試してください。` };
  }
  const above = valid.filter((r) => r.vsMedian >= 1.1).length;
  const below = valid.filter((r) => r.vsMedian < 0.6).length;
  if (above >= Math.ceil(valid.length * 0.66)) return { decision: "continue", reason: `${valid.length}回中${above}回で中央値を1.1倍以上上回りました。継続しつつ、他の要因（季節・コラボ・広告）も確認してください。` };
  if (below >= Math.ceil(valid.length * 0.66)) return { decision: "stop", reason: `${valid.length}回中${below}回で中央値の0.6倍未満でした。終了を検討してください。` };
  return { decision: "modify", reason: `${valid.length}回の結果がばらついています。変更点を1つに絞って修正してください。` };
}

/** 週の制作可能時間から実行可能な施策数を出す。大量投稿を最善としない */
export function feasibleCount(availableMinutes: number | null, estMinutes: (number | null)[]) {
  if (!availableMinutes || availableMinutes <= 0) return { count: 0, perItem: null as number | null, note: "制作可能時間が未設定です。" };
  const known = estMinutes.filter((m): m is number => typeof m === "number" && m > 0);
  const perItem = median(known) ?? 90;
  const count = Math.max(0, Math.min(3, Math.floor((availableMinutes * 0.8) / perItem)));
  return { count, perItem, note: `1件あたり約${Math.round(perItem)}分（${known.length ? "過去の見積の中央値" : "仮の90分"}）で、制作可能時間の8割で計算。上限3件。` };
}

export function buildUtmUrl(base: string, p: { source: string; medium: string; campaign: string; content?: string | null }) {
  let u: URL;
  try {
    u = new URL(base);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  u.searchParams.set("utm_source", p.source);
  u.searchParams.set("utm_medium", p.medium);
  u.searchParams.set("utm_campaign", p.campaign);
  if (p.content) u.searchParams.set("utm_content", p.content);
  return u.toString();
}

export function classifyByKeywords(text: string | null | undefined, keywords: Record<string, string[]>) {
  if (!text) return [];
  const hits: { category: string; evidence: string[] }[] = [];
  for (const [cat, words] of Object.entries(keywords)) {
    const ev = words.filter((w) => text.includes(w));
    if (ev.length) hits.push({ category: cat, evidence: ev });
  }
  return hits;
}
