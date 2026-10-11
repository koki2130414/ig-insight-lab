import "server-only";
import type { Ctx, Account } from "./context";
import { initiativesFor, metricsFor, postsFor, accountMetricsFor, type Initiative } from "./queries";
import { feasibleCount, ratesFor, median, safeRate } from "./analytics";
import { ACCOUNT_METRICS, FORMATS, TEST_VARIABLES, CONVERSION_KINDS, ATTRIBUTIONS } from "./catalog";
import { addDays, fmtDate, jstDayEnd, jstDayStart } from "./time";

export type ReviewSummary = {
  week: string;
  grown: { postId: string; label: string; checkpoint: string; vs: string; hypotheses: string[] }[];
  confirmed: string[];
  unconfirmed: string[];
  converted: string[];
  next: { id: string; title: string; minutes: number | null; materials: string | null; reason: string }[];
  stopOrModify: { id: string; title: string; decision: string }[];
  capacity: { minutes: number | null; count: number; note: string };
  generatedAt: string;
};

export async function buildReview(ctx: Ctx, acc: Account, week: string, availableMinutes: number | null): Promise<ReviewSummary> {
  const end = addDays(week, 6);
  const [posts, metrics, inis] = await Promise.all([postsFor(ctx, acc.id), metricsFor(ctx, acc.id), initiativesFor(ctx, [acc.id])]);
  const inWeek = posts.filter((p) => {
    const t = new Date(p.posted_at).getTime();
    return t >= jstDayStart(week).getTime() && t < jstDayEnd(end).getTime();
  });

  // 伸びた投稿: 同形式・同時点の中央値（広告/プレゼント除外）と比べて 1.2倍以上。理由は「仮説」
  const grown: ReviewSummary["grown"] = [];
  for (const p of inWeek) {
    for (const cp of ["7d", "72h", "24h"] as const) {
      const m = metrics.find((x) => x.post_id === p.id && x.checkpoint === cp);
      if (!m) continue;
      const peers = posts.filter((q) => q.id !== p.id && q.format === p.format && !q.is_ad && !q.is_giveaway)
        .map((q) => metrics.find((x) => x.post_id === q.id && x.checkpoint === cp)).filter((x): x is NonNullable<typeof x> => !!x);
      if (peers.length < 3) break;
      const r = ratesFor(m);
      const checks: [string, number | null, number | null][] = [
        ["リーチ", m.reach, median(peers.map((x) => x.reach).filter((v): v is number => v !== null))],
        ["保存率", r.save_rate, median(peers.map((x) => ratesFor(x).save_rate).filter((v): v is number => v !== null))],
        ["シェア率", r.share_rate, median(peers.map((x) => ratesFor(x).share_rate).filter((v): v is number => v !== null))],
      ];
      const ups = checks.filter(([, v, med]) => v !== null && med !== null && med > 0 && v / med >= 1.2);
      if (ups.length) {
        const hyp: string[] = [];
        if (p.hook) hyp.push(`冒頭の言葉「${p.hook.slice(0, 30)}」が合っていた可能性`);
        if (p.theme) hyp.push(`テーマ「${p.theme}」への関心`);
        if (p.duration_sec) hyp.push(`動画尺 ${p.duration_sec}秒`);
        if (p.collaborator) hyp.push(`コラボ（${p.collaborator}）による到達の広がり`);
        if (p.is_ad || p.is_giveaway) hyp.push("広告・プレゼント企画の影響（比較から除外して確認が必要）");
        hyp.push("季節・話題性の影響は未確認");
        grown.push({ postId: p.id, label: `${fmtDate(p.posted_at)} ${FORMATS[p.format as keyof typeof FORMATS]}「${(p.hook || p.theme || "").slice(0, 24)}」`, checkpoint: cp, vs: ups.map(([k, v, med]) => `${k} 中央値の${(v! / med!).toFixed(1)}倍`).join("、"), hypotheses: hyp });
      }
      break;
    }
  }

  // 届いた層について確認できたこと / 未確認のこと
  const am = await accountMetricsFor(ctx, acc.id, week, end);
  const confirmed: string[] = [];
  const unconfirmed: string[] = [];
  const reach = am.get("reach");
  const nonF = am.get("reach_non_follower");
  const ratio = reach && nonF && reach.source === nonF.source ? safeRate(nonF.value, reach.value) : null;
  if (ratio !== null) confirmed.push(`アカウント全体リーチのうち非フォロワーは ${(ratio * 100).toFixed(0)}%（${reach!.source === "demo" ? "デモ" : reach!.measurement === "measured" ? "実測" : "手入力"}）`);
  else unconfirmed.push("非フォロワーへのリーチ割合（全体リーチと非フォロワーリーチの両方が必要）");
  const aggs = await ctx.db.query<{ segment: string; dimension: string; bucket: string; value: number; unit: string }>(
    `SELECT segment, dimension, bucket, value, unit FROM audience_aggregates WHERE account_id=$1 AND captured_at >= $2 AND captured_at < $3 ORDER BY value DESC`,
    [acc.id, jstDayStart(week), jstDayEnd(end)]);
  for (const seg of ["followers", "reached", "engaged"]) {
    const top = aggs.filter((a) => a.segment === seg && a.dimension === "city").slice(0, 2);
    if (top.length) confirmed.push(`${seg === "followers" ? "フォロワー" : seg === "reached" ? "到達した人" : "反応した人"}の地域上位: ${top.map((t) => `${t.bucket}${t.unit === "percent" ? ` ${t.value}%` : ""}`).join("、")}`);
  }
  if (!aggs.some((a) => a.segment === "reached")) unconfirmed.push("投稿に到達した人の属性（今週分の集計なし）");
  for (const k of ["profile_visits", "link_taps", "line_signups"]) {
    if (!am.get(k) || am.get(k)!.value === null) unconfirmed.push(`${ACCOUNT_METRICS.find((m) => m.key === k)!.label}（未入力）`);
  }
  const missingSnaps = inWeek.filter((p) => !metrics.some((m) => m.post_id === p.id)).length;
  if (missingSnaps) unconfirmed.push(`今週の投稿のうち${missingSnaps}件は実績が未記録`);

  // 購入・問い合わせにつながった施策
  const conv = await ctx.db.query<{ kind: string; attribution: string; title: string | null; n: number }>(
    `SELECT c.kind, c.attribution, i.title, count(*)::int n FROM conversions c LEFT JOIN initiatives i ON i.id=c.initiative_id
      WHERE c.account_id=$1 AND c.occurred_at >= $2 AND c.occurred_at < $3 GROUP BY 1,2,3 ORDER BY n DESC`,
    [acc.id, jstDayStart(week), jstDayEnd(end)]);
  const converted = conv.map((c) => `${c.title ?? "施策不明"}: ${CONVERSION_KINDS[c.kind as keyof typeof CONVERSION_KINDS]} ${c.n}件（${ATTRIBUTIONS[c.attribution as keyof typeof ATTRIBUTIONS]}）`);

  // 次週の施策（制作可能時間から件数を決める。大量投稿を最善としない）
  const cap = feasibleCount(availableMinutes ?? acc.weekly_minutes, inis.map((i) => i.est_minutes));
  const prio = (i: Initiative) => (i.decision === "retest" ? 0 : i.decision === "modify" ? 1 : 2);
  const candidates = inis.filter((i) => i.status === "idea" || i.status === "producing").sort((a, b) => prio(a) - prio(b) || (a.est_minutes ?? 999) - (b.est_minutes ?? 999));
  const next = candidates.slice(0, Math.max(cap.count, 0)).slice(0, 3).map((i) => ({
    id: i.id, title: i.title, minutes: i.est_minutes, materials: i.materials,
    reason: i.status === "producing" ? "制作中のものを優先" : i.test_variable ? `変更点「${TEST_VARIABLES[i.test_variable as keyof typeof TEST_VARIABLES]}」の検証` : "アイデアから選択",
  }));
  // 再検証が必要な振り返り済み施策も候補に
  for (const i of inis.filter((x) => x.status === "reviewed" && (x.decision === "retest" || x.decision === "modify"))) {
    if (next.length >= Math.min(3, cap.count)) break;
    next.push({ id: i.id, title: i.title, minutes: i.est_minutes, materials: i.materials, reason: i.decision === "retest" ? "再検証（同じ変更点でもう一度）" : "修正して再実施" });
  }
  const stopOrModify = inis.filter((i) => i.decision === "stop" || i.decision === "modify").slice(0, 10).map((i) => ({ id: i.id, title: i.title, decision: i.decision! }));

  return { week, grown, confirmed, unconfirmed, converted, next, stopOrModify, capacity: { minutes: availableMinutes ?? acc.weekly_minutes, count: cap.count, note: cap.note }, generatedAt: new Date().toISOString() };
}
