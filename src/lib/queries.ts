import "server-only";
import type { Ctx } from "./context";
import { compareStats, selectPeers, type CompareOptions, type MetricRow, type PeerPost } from "./analytics";
import { jstDayEnd, jstDayStart } from "./time";
import type { Checkpoint } from "./catalog";

export type PostRow = PeerPost & {
  url: string | null; theme: string | null; hook: string | null; duration_sec: number | null; structure: string | null;
  caption: string | null; cta: string | null; collaborator: string | null; production_minutes: number | null; production_cost: number | null;
  target_id: string | null; source: string; external_id: string | null; initiative_id: string | null;
};

export type MetricFull = MetricRow & { id: string; captured_at: Date; source: string; measurement: string; note: string | null };

export async function postsFor(ctx: Ctx, accountId: string) {
  return ctx.db.query<PostRow>(`SELECT * FROM posts WHERE account_id=$1 ORDER BY posted_at DESC`, [accountId]);
}

export async function metricsFor(ctx: Ctx, accountId: string) {
  return ctx.db.query<MetricFull>(`SELECT * FROM post_metrics WHERE account_id=$1 ORDER BY captured_at`, [accountId]);
}

export async function comparisonFor(ctx: Ctx, post: PostRow, opt: CompareOptions) {
  const [posts, metrics] = await Promise.all([postsFor(ctx, post.account_id), metricsFor(ctx, post.account_id)]);
  const { peers, peerMetrics } = selectPeers(post, posts, metrics, opt);
  const target = metrics.find((m) => m.post_id === post.id && m.checkpoint === opt.checkpoint);
  return { peers, stats: compareStats(target, peerMetrics), target, metrics: metrics.filter((m) => m.post_id === post.id) };
}

export type AccMetric = { metric: string; period_start: string; period_end: string; value: number | null; status: string; unavailable_reason: string | null; source: string; measurement: string; captured_at: Date };

/** 期間の一覧（同じ期間・同じ定義でのみ比較するため、期間は完全一致で扱う） */
export async function periodsFor(ctx: Ctx, accountIds: string[]) {
  return ctx.db.query<{ period_start: string; period_end: string; n: number }>(
    `SELECT period_start, period_end, count(*)::int n FROM account_metrics
     WHERE account_id IN (SELECT jsonb_array_elements_text($1::jsonb)::uuid) AND metric <> 'followers' GROUP BY 1,2 ORDER BY period_end DESC, period_start DESC LIMIT 30`,
    [accountIds],
  );
}

export async function accountMetricsFor(ctx: Ctx, accountId: string, start: string, end: string) {
  const rows = await ctx.db.query<AccMetric>(
    `SELECT metric, period_start, period_end, value, status, unavailable_reason, source, measurement, captured_at FROM account_metrics
     WHERE account_id=$1 AND ((period_start=$2 AND period_end=$3) OR (metric='followers' AND period_start=period_end AND period_end BETWEEN $2 AND $3))
     ORDER BY captured_at DESC`,
    [accountId, start, end],
  );
  // 同じ指標が複数の取得元にある場合: API > CSV/JSON > 手入力 > デモ の順。フォロワー数は期間末に最も近いもの
  const prio: Record<string, number> = { api: 0, csv: 1, json: 1, manual: 2, demo: 3 };
  const map = new Map<string, AccMetric>();
  for (const r of rows.sort((a, b) => (b.period_end.localeCompare(a.period_end)) || prio[a.source] - prio[b.source])) {
    if (!map.has(r.metric)) map.set(r.metric, r);
  }
  return map;
}

export async function followerSeries(ctx: Ctx, accountId: string) {
  return ctx.db.query<{ day: string; value: number | null; source: string }>(
    `SELECT period_end AS day, value, source FROM account_metrics WHERE account_id=$1 AND metric='followers' ORDER BY period_end`,
    [accountId],
  );
}

export async function conversionsInRange(ctx: Ctx, accountId: string, start: string, end: string) {
  return ctx.db.query<{ kind: string; attribution: string; n: number; qty: number | null; revenue: number | null; gross_profit: number | null; revenue_missing: number }>(
    `SELECT kind, attribution, count(*)::int n, sum(quantity)::float8 qty, sum(revenue)::float8 revenue, sum(gross_profit)::float8 gross_profit,
            count(*) FILTER (WHERE revenue IS NULL)::int revenue_missing
       FROM conversions WHERE account_id=$1 AND occurred_at >= $2 AND occurred_at < $3 GROUP BY 1,2`,
    [accountId, jstDayStart(start), jstDayEnd(end)],
  );
}

export type Initiative = {
  id: string; account_id: string; title: string; status: string; target_id: string | null; goal: string | null; format: string | null;
  hypothesis: string | null; hooks: string[]; script: string | null; materials: string | null; caption: string | null; cta: string | null;
  expected_action: string | null; primary_metric: string | null; success_criteria: string | null; stop_criteria: string | null;
  est_minutes: number | null; est_cost: number | null; risks: string | null; next_test: string | null; test_variable: string | null;
  test_detail: string | null; comparison_kind: string; baseline_post_ids: string[]; post_id: string | null; generated_by: string;
  data_gaps: string | null; facts: string[]; confounders: Record<string, boolean | string>; result_summary: string | null; decision: string | null;
  review_notes: string | null; planned_week: string | null; created_at: Date; updated_at: Date;
};

export async function initiativesFor(ctx: Ctx, accountIds: string[]) {
  return ctx.db.query<Initiative>(`SELECT * FROM initiatives WHERE account_id IN (SELECT jsonb_array_elements_text($1::jsonb)::uuid) ORDER BY updated_at DESC`, [accountIds]);
}

export type Target = { id: string; account_id: string; layer: string; name: string; needs: string | null; value_prop: string | null; themes: string | null; desired_action: string | null; monetization: string | null; priority: number | null; validation_method: string | null; evidence: string | null; is_hypothesis: boolean; channels: string[] };

export async function targetsFor(ctx: Ctx, accountId: string) {
  return ctx.db.query<Target>(`SELECT * FROM targets WHERE account_id=$1 ORDER BY layer, priority NULLS LAST, name`, [accountId]);
}

export function latestCheckpoint(metrics: MetricRow[], postId: string): MetricRow | undefined {
  const order: Checkpoint[] = ["7d", "72h", "24h"];
  for (const cp of order) {
    const m = metrics.find((x) => x.post_id === postId && x.checkpoint === cp);
    if (m) return m;
  }
  return undefined;
}
