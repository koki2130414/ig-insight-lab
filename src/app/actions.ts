"use server";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import {
  authEnabled, checkPasscode, getContext, newSessionToken, requireAccount, requireOwned, type Ctx,
} from "@/lib/context";
import { ACCOUNT_METRICS, CHECKPOINTS, FORMATS, PURPOSES, STATUSES, DECISIONS, TEST_VARIABLES, CONVERSION_KINDS, ATTRIBUTIONS, COST_CATEGORIES, INTEREST_CATEGORIES, CATEGORY_KEYWORDS, type Checkpoint, type Purpose } from "@/lib/catalog";
import { parseBool, parseDateTime, parseDay, parseEnum, parseNumber, parseText, parseUrl } from "@/lib/parse";
import { validateRows, commitRows, MAX_IMPORT_ROWS, type ImportKind, IMPORT_KINDS } from "@/lib/importer";
import { buildUtmUrl, checkpointDrift, classifyByKeywords } from "@/lib/analytics";
import { generateRuleBased, generateWithAi, type GenInput } from "@/lib/generator";
import { resetDemo } from "@/lib/seed";
import { syncAccount } from "@/lib/instagram/sync";
import { weekStart, jstDay, addDays } from "@/lib/time";

// ---------- 共通 ----------
class FormError extends Error {}
function get(fd: FormData, k: string) {
  const v = fd.get(k);
  return typeof v === "string" ? v : null;
}
function must<T>(p: { ok: true; value: T } | { ok: false; error: string }, label: string): T {
  if (!p.ok) throw new FormError(`${label}: ${p.error}`);
  return p.value;
}
const txt = (fd: FormData, k: string, max = 5000) => must(parseText(get(fd, k), max), k);
const num = (fd: FormData, k: string, label: string, opts: { int?: boolean; min?: number } = {}) => must(parseNumber(get(fd, k), opts), label);
const back = (path: string, msg: string, kind: "ok" | "err" = "ok") => {
  const sep = path.includes("?") ? "&" : "?";
  redirect(`${path}${sep}${kind}=${encodeURIComponent(msg)}`);
};
async function guarded(path: string, fn: (ctx: Ctx) => Promise<string | void>) {
  const ctx = await getContext();
  let msg: string | void = undefined;
  try {
    msg = await fn(ctx);
  } catch (e) {
    if (e instanceof Error && "digest" in e) throw e; // redirect
    back(path, (e as Error).message, "err");
  }
  revalidatePath("/", "layout");
  if (msg) back(path, msg);
}

// ---------- 表示切替・ログイン ----------
export async function setDataset(fd: FormData) {
  const v = get(fd, "dataset");
  const c = await cookies();
  c.set("iil_dataset", v === "real" ? "real" : "demo", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
  redirect(await backPath());
}

/** 切替後は元のページへ（同一オリジンのパスのみ。詳細ページはデータセットが変わると無効なので一覧へ） */
async function backPath() {
  const ref = (await headers()).get("referer");
  try {
    const u = new URL(ref ?? "/", "http://x");
    const p = u.pathname;
    if (/^\/(posts|initiatives)\/[0-9a-f-]{36}/.test(p)) return p.startsWith("/posts") ? "/posts" : "/board";
    return p.startsWith("/") && !p.startsWith("//") ? p : "/";
  } catch {
    return "/";
  }
}

export async function setView(fd: FormData) {
  const v = get(fd, "view");
  const c = await cookies();
  c.set("iil_view", v === "farm" || v === "both" ? v : "personal", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  revalidatePath("/", "layout");
  redirect(await backPath());
}

export async function login(fd: FormData) {
  if (!authEnabled()) redirect("/");
  if (!checkPasscode(get(fd, "passcode") ?? "")) redirect("/login?err=1");
  const c = await cookies();
  c.set("iil_session", newSessionToken(), { httpOnly: true, sameSite: "lax", path: "/", secure: process.env.NODE_ENV === "production", maxAge: 60 * 60 * 24 * 30 });
  redirect("/");
}

export async function logout() {
  (await cookies()).delete("iil_session");
  redirect("/login");
}

// ---------- 投稿 ----------
export async function savePost(fd: FormData) {
  const id = get(fd, "id");
  let newId: string | undefined;
  await guarded(id ? `/posts/${id}` : "/posts/new", async (ctx) => {
    const acc = await requireAccount(ctx, get(fd, "account_id"));
    if (id) await requireOwned(ctx, "posts", id);
    const url = must(parseUrl(get(fd, "url")), "投稿URL");
    const postedAt = must(parseDateTime(get(fd, "posted_at"), true), "投稿日時");
    const format = must(parseEnum(get(fd, "format"), FORMATS), "形式");
    if (!format) throw new FormError("形式を選んでください");
    const targetId = get(fd, "target_id") || null;
    if (targetId) {
      const t = await ctx.db.query(`SELECT 1 FROM targets WHERE id=$1 AND account_id=$2`, [targetId, acc.id]);
      if (!t.length) throw new FormError("ターゲットが不正です");
    }
    const vals = [
      acc.id, url, postedAt, format, txt(fd, "theme", 200), targetId, must(parseEnum(get(fd, "purpose"), PURPOSES), "目的"),
      txt(fd, "hook", 300), num(fd, "duration_sec", "動画尺", { min: 0 }), txt(fd, "structure", 1000), txt(fd, "caption"), txt(fd, "cta", 300),
      txt(fd, "collaborator", 200), must(parseBool(get(fd, "is_ad")), "広告"), must(parseBool(get(fd, "is_giveaway")), "プレゼント企画"),
      num(fd, "production_minutes", "制作時間", { int: true, min: 0 }), num(fd, "production_cost", "制作費", { min: 0 }),
    ];
    try {
      if (id) {
        await ctx.db.query(
          `UPDATE posts SET url=$2,posted_at=$3,format=$4,theme=$5,target_id=$6,purpose=$7,hook=$8,duration_sec=$9,structure=$10,caption=$11,cta=$12,collaborator=$13,is_ad=$14,is_giveaway=$15,production_minutes=$16,production_cost=$17,updated_at=now() WHERE id=$18 AND account_id=$1`,
          [...vals, id]);
        return "保存しました";
      }
      const [r] = await ctx.db.query<{ id: string }>(
        `INSERT INTO posts(account_id,url,posted_at,format,theme,target_id,purpose,hook,duration_sec,structure,caption,cta,collaborator,is_ad,is_giveaway,production_minutes,production_cost,source)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'manual') RETURNING id`, vals);
      newId = r.id;
      const ini = get(fd, "initiative_id");
      if (ini) {
        await requireOwned(ctx, "initiatives", ini);
        await ctx.db.query(`UPDATE initiatives SET post_id=$1, status=CASE WHEN status IN ('idea','producing') THEN 'posted' ELSE status END, updated_at=now() WHERE id=$2 AND account_id=$3`, [r.id, ini, acc.id]);
        await ctx.db.query(`UPDATE posts SET initiative_id=$1 WHERE id=$2`, [ini, r.id]);
      }
    } catch (e) {
      if (String((e as Error).message).includes("duplicate") || String((e as Error).message).includes("unique")) throw new FormError("同じURLの投稿がすでに登録されています");
      throw e;
    }
  });
  if (newId) redirect(`/posts/${newId}?ok=${encodeURIComponent("投稿を登録しました。次に実績を入力してください")}`);
}

export async function deletePost(fd: FormData) {
  const id = get(fd, "id");
  await guarded(`/posts/${id}`, async (ctx) => {
    const acc = await requireOwned(ctx, "posts", id);
    await ctx.db.query(`DELETE FROM posts WHERE id=$1 AND account_id=$2`, [id, acc.id]);
  });
  redirect("/posts?ok=" + encodeURIComponent("削除しました"));
}

const SNAP_FIELDS = ["reach", "views", "likes", "comments", "saves", "shares", "profile_visits", "follows", "non_follower_reach"] as const;

export async function saveSnapshot(fd: FormData) {
  const postId = get(fd, "post_id");
  await guarded(`/posts/${postId}`, async (ctx) => {
    const acc = await requireOwned(ctx, "posts", postId);
    const [post] = await ctx.db.query<{ posted_at: Date }>(`SELECT posted_at FROM posts WHERE id=$1`, [postId]);
    const cp = must(parseEnum(get(fd, "checkpoint"), CHECKPOINTS as unknown as Record<Checkpoint, string>), "時点") as Checkpoint | null;
    if (!cp) throw new FormError("時点を選んでください");
    const captured = must(parseDateTime(get(fd, "captured_at"), true), "取得日時")!;
    const hours = (captured.getTime() - new Date(post.posted_at).getTime()) / 3600000;
    if (hours < 0) throw new FormError("取得日時が投稿日時より前です");
    const vals = SNAP_FIELDS.map((k) => num(fd, k, k, { int: true, min: 0 }));
    const watch = num(fd, "avg_watch_sec", "平均視聴時間", { min: 0 });
    if (vals.every((v) => v === null) && watch === null) throw new FormError("指標を1つ以上入力してください（空欄は未取得として扱います）");
    const measurement = get(fd, "measurement") === "estimated" ? "estimated" : "manual";
    const exists = await ctx.db.query(`SELECT id FROM post_metrics WHERE post_id=$1 AND checkpoint=$2 AND checkpoint<>'other'`, [postId, cp]);
    if (exists.length && get(fd, "overwrite") !== "1") throw new FormError(`${CHECKPOINTS[cp].label}の値はすでにあります。上書きする場合は「上書き」にチェックしてください`);
    if (exists.length) await ctx.db.query(`DELETE FROM post_metrics WHERE id=$1`, [(exists[0] as { id: string }).id]);
    await ctx.db.query(
      `INSERT INTO post_metrics(post_id,account_id,checkpoint,captured_at,hours_since_post,source,measurement,reach,views,likes,comments,saves,shares,profile_visits,follows,non_follower_reach,avg_watch_sec,note)
       VALUES ($1,$2,$3,$4,$5,'manual',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [postId, acc.id, cp, captured, hours, measurement, ...vals, watch, txt(fd, "note", 500)]);
    const drift = checkpointDrift(cp, hours);
    return drift === "drift" ? `保存しました（注意: 経過時間 ${hours.toFixed(0)}時間は${CHECKPOINTS[cp].label}から25%以上ずれています。比較時に除外できます）` : "実績を保存しました";
  });
}

export async function deleteSnapshot(fd: FormData) {
  const id = get(fd, "id");
  const postId = get(fd, "post_id");
  await guarded(`/posts/${postId}`, async (ctx) => {
    const acc = await requireOwned(ctx, "post_metrics", id);
    await ctx.db.query(`DELETE FROM post_metrics WHERE id=$1 AND account_id=$2`, [id, acc.id]);
    return "削除しました";
  });
}

// ---------- アカウント指標（期間） ----------
export async function saveAccountMetrics(fd: FormData) {
  await guarded("/metrics", async (ctx) => {
    const acc = await requireAccount(ctx, get(fd, "account_id"));
    const start = must(parseDay(get(fd, "period_start")), "開始日")!;
    const end = must(parseDay(get(fd, "period_end")), "終了日")!;
    if (start > end) throw new FormError("開始日が終了日より後です");
    const measurement = get(fd, "measurement") === "estimated" ? "estimated" : "manual";
    let n = 0;
    for (const m of ACCOUNT_METRICS) {
      const raw = get(fd, `m_${m.key}`);
      if (raw === null || raw.trim() === "") continue; // 空欄は保存しない（＝未入力のまま）
      const v = num(fd, `m_${m.key}`, m.label, m.key === "follower_net" ? { int: true } : { min: 0 });
      const ps = m.key === "followers" ? end : start; // フォロワー数は期間末時点のスナップショット
      await ctx.db.query(
        `INSERT INTO account_metrics(account_id,metric,period_start,period_end,value,status,source,measurement,captured_at)
         VALUES ($1,$2,$3,$4,$5,'ok','manual',$6,now())
         ON CONFLICT (account_id,metric,period_start,period_end,source) DO UPDATE SET value=EXCLUDED.value, measurement=EXCLUDED.measurement, captured_at=now()`,
        [acc.id, m.key, ps, end, v, measurement]);
      n++;
    }
    if (!n) throw new FormError("値を1つ以上入力してください");
    return `${n}件の指標を保存しました`;
  });
}

// ---------- ターゲット ----------
export async function saveTarget(fd: FormData) {
  await guarded("/targets", async (ctx) => {
    const acc = await requireAccount(ctx, get(fd, "account_id"));
    const id = get(fd, "id");
    const layer = get(fd, "layer") === "current" ? "current" : "desired";
    const name = txt(fd, "name", 100);
    if (!name) throw new FormError("名前を入力してください");
    const vals = [acc.id, layer, name, txt(fd, "needs"), txt(fd, "value_prop"), txt(fd, "themes"), txt(fd, "desired_action"), txt(fd, "monetization"),
      num(fd, "priority", "優先順位", { int: true, min: 1 }), txt(fd, "validation_method"), txt(fd, "evidence"), get(fd, "is_hypothesis") !== "0",
      fd.getAll("channels").map(String).filter((c) => ["content", "collab", "funnel", "ads"].includes(c))];
    if (layer === "current" && !vals[10]) throw new FormError("「現在の層」には根拠（どのデータから分かったか）を入力してください");
    if (id) {
      await requireOwned(ctx, "targets", id);
      await ctx.db.query(`UPDATE targets SET layer=$2,name=$3,needs=$4,value_prop=$5,themes=$6,desired_action=$7,monetization=$8,priority=$9,validation_method=$10,evidence=$11,is_hypothesis=$12,channels=$13,updated_at=now() WHERE id=$14 AND account_id=$1`, [...vals, id]);
    } else {
      await ctx.db.query(`INSERT INTO targets(account_id,layer,name,needs,value_prop,themes,desired_action,monetization,priority,validation_method,evidence,is_hypothesis,channels) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`, vals);
    }
    return "保存しました";
  });
}

export async function deleteTarget(fd: FormData) {
  await guarded("/targets", async (ctx) => {
    const id = get(fd, "id");
    const acc = await requireOwned(ctx, "targets", id);
    await ctx.db.query(`DELETE FROM targets WHERE id=$1 AND account_id=$2`, [id, acc.id]);
    return "削除しました";
  });
}

// ---------- 施策 ----------
export async function createInitiative(fd: FormData) {
  let id: string | undefined;
  const backPath = "/initiatives/new?" + (get(fd, "qs") ?? "");
  await guarded(backPath, async (ctx) => {
    const acc = await requireAccount(ctx, get(fd, "account_id"));
    const purpose = (must(parseEnum(get(fd, "purpose"), PURPOSES), "目的") ?? "trust") as Purpose;
    const targetId = get(fd, "target_id") || null;
    const target = targetId ? (await ctx.db.query<GenInput["target"] & { id: string }>(`SELECT id,name,needs,value_prop,themes,desired_action FROM targets WHERE id=$1 AND account_id=$2`, [targetId, acc.id]))[0] ?? null : null;
    const baseline = get(fd, "baseline") ? JSON.parse(get(fd, "baseline")!) : null;
    const input: GenInput = {
      accountKind: acc.kind, accountName: acc.display_name, target, purpose,
      materials: txt(fd, "materials", 1000) ?? "", minutes: num(fd, "minutes", "制作時間", { int: true, min: 0 }),
      testVariable: (must(parseEnum(get(fd, "variable"), TEST_VARIABLES), "検証項目") ?? null) as GenInput["testVariable"],
      theme: txt(fd, "theme", 100), baseline,
    };
    let generatedBy: "rule" | "ai" = "rule";
    let draft = generateRuleBased(input);
    if (get(fd, "mode") === "ai") {
      if (get(fd, "consent") !== "1") throw new FormError("AIへ送信する内容を確認し、同意にチェックしてください");
      const r = await generateWithAi(input);
      if ("error" in r) throw new FormError(r.error + "（ルールベースでの作成は可能です）");
      draft = r.draft;
      generatedBy = "ai";
    }
    const basePostId = get(fd, "base_post_id");
    if (basePostId) await requireOwned(ctx, "posts", basePostId);
    const [row] = await ctx.db.query<{ id: string }>(
      `INSERT INTO initiatives(account_id,title,status,target_id,goal,format,hypothesis,hooks,script,materials,caption,cta,expected_action,primary_metric,success_criteria,stop_criteria,est_minutes,est_cost,risks,next_test,test_variable,test_detail,baseline_post_ids,generated_by,facts,data_gaps,planned_week)
       VALUES ($1,$2,'idea',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26) RETURNING id`,
      [acc.id, draft.title, target?.id ?? null, purpose, draft.format, draft.hypothesis, draft.hooks, draft.script, draft.materials, draft.caption, draft.cta, draft.expected_action,
        draft.primary_metric, draft.success_criteria, draft.stop_criteria, draft.est_minutes, draft.est_cost, draft.risks, draft.next_test, draft.test_variable, draft.test_detail,
        basePostId ? [basePostId] : [], generatedBy, draft.facts, draft.data_gaps.join("\n") || null, weekStart(jstDay())]);
    id = row.id;
  });
  if (id) redirect(`/initiatives/${id}?ok=${encodeURIComponent("施策案を作成しました。内容を確認・編集してください")}`);
}

export async function saveInitiative(fd: FormData) {
  const id = get(fd, "id");
  await guarded(`/initiatives/${id}`, async (ctx) => {
    const acc = await requireOwned(ctx, "initiatives", id);
    const status = must(parseEnum(get(fd, "status"), STATUSES), "状態") ?? "idea";
    const postId = get(fd, "post_id") || null;
    if (postId) {
      const p = await ctx.db.query(`SELECT 1 FROM posts WHERE id=$1 AND account_id=$2`, [postId, acc.id]);
      if (!p.length) throw new FormError("投稿が不正です");
    }
    if (["posted", "measuring", "reviewed"].includes(status) && !postId) throw new FormError("「投稿済み」以降にするには、投稿を紐づけてください（投稿を先に登録）");
    const hooks = [get(fd, "hook1"), get(fd, "hook2"), get(fd, "hook3")].map((h) => (h ?? "").trim()).filter(Boolean);
    const confounders = { ad: get(fd, "c_ad") === "1", collab: get(fd, "c_collab") === "1", season: get(fd, "c_season") === "1", trend: get(fd, "c_trend") === "1", giveaway: get(fd, "c_giveaway") === "1", note: txt(fd, "c_note", 500) ?? "" };
    const decision = must(parseEnum(get(fd, "decision"), DECISIONS), "判定");
    if (status === "reviewed" && !decision) throw new FormError("振り返り済みにするには判定（再検証/継続/修正/終了）を選んでください");
    await ctx.db.query(
      `UPDATE initiatives SET title=$2,status=$3,target_id=$4,format=$5,hypothesis=$6,hooks=$7,script=$8,materials=$9,caption=$10,cta=$11,expected_action=$12,primary_metric=$13,
        success_criteria=$14,stop_criteria=$15,est_minutes=$16,est_cost=$17,risks=$18,next_test=$19,test_variable=$20,test_detail=$21,post_id=$22,confounders=$23,
        result_summary=$24,decision=$25,review_notes=$26,planned_week=$27,comparison_kind=$28,updated_at=now() WHERE id=$1 AND account_id=$29`,
      [id, txt(fd, "title", 200) ?? "無題", status, get(fd, "target_id") || null, must(parseEnum(get(fd, "format"), FORMATS), "形式"), txt(fd, "hypothesis"), hooks, txt(fd, "script"),
        txt(fd, "materials"), txt(fd, "caption"), txt(fd, "cta", 300), txt(fd, "expected_action", 300), get(fd, "primary_metric") || null, txt(fd, "success_criteria"), txt(fd, "stop_criteria"),
        num(fd, "est_minutes", "制作時間", { int: true, min: 0 }), num(fd, "est_cost", "費用", { min: 0 }), txt(fd, "risks"), txt(fd, "next_test"),
        must(parseEnum(get(fd, "test_variable"), TEST_VARIABLES), "検証項目"), txt(fd, "test_detail"), postId, confounders, txt(fd, "result_summary"), decision, txt(fd, "review_notes"),
        must(parseDay(get(fd, "planned_week"), false), "予定週"), get(fd, "comparison_kind") === "randomized" ? "randomized" : "observational", acc.id]);
    if (postId) await ctx.db.query(`UPDATE posts SET initiative_id=$1 WHERE id=$2`, [id, postId]);
    return "保存しました";
  });
}

export async function moveInitiative(fd: FormData) {
  const id = get(fd, "id");
  await guarded("/board", async (ctx) => {
    const acc = await requireOwned(ctx, "initiatives", id);
    const status = must(parseEnum(get(fd, "status"), STATUSES), "状態");
    const [ini] = await ctx.db.query<{ post_id: string | null; decision: string | null }>(`SELECT post_id, decision FROM initiatives WHERE id=$1`, [id]);
    if (status && ["posted", "measuring", "reviewed"].includes(status) && !ini.post_id) throw new FormError("投稿を紐づけてから移動してください（施策の詳細から）");
    if (status === "reviewed" && !ini.decision) throw new FormError("判定を記録してから「振り返り済み」にしてください（施策の詳細から）");
    await ctx.db.query(`UPDATE initiatives SET status=$2, updated_at=now() WHERE id=$1 AND account_id=$3`, [id, status, acc.id]);
    return `「${STATUSES[status!]}」に移動しました`;
  });
}

export async function deleteInitiative(fd: FormData) {
  const id = get(fd, "id");
  await guarded(`/initiatives/${id}`, async (ctx) => {
    const acc = await requireOwned(ctx, "initiatives", id);
    await ctx.db.query(`DELETE FROM initiatives WHERE id=$1 AND account_id=$2`, [id, acc.id]);
  });
  redirect("/board?ok=" + encodeURIComponent("削除しました"));
}

// ---------- 成果・費用・UTM ----------
export async function saveConversion(fd: FormData) {
  await guarded(get(fd, "back") || "/funnel", async (ctx) => {
    const acc = await requireAccount(ctx, get(fd, "account_id"));
    const kind = must(parseEnum(get(fd, "kind"), CONVERSION_KINDS), "種類");
    const attribution = must(parseEnum(get(fd, "attribution"), ATTRIBUTIONS), "経路");
    if (!kind || !attribution) throw new FormError("種類と経路の確からしさを選んでください");
    const ini = get(fd, "initiative_id") || null;
    if (ini) await requireOwned(ctx, "initiatives", ini);
    await ctx.db.query(
      `INSERT INTO conversions(account_id,occurred_at,kind,quantity,revenue,gross_profit,attribution,initiative_id,utm_campaign,external_ref,note,source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'manual')`,
      [acc.id, must(parseDateTime(get(fd, "occurred_at"), true), "日時"), kind, num(fd, "quantity", "数量", { int: true, min: 0 }), num(fd, "revenue", "売上"), num(fd, "gross_profit", "粗利益"),
        attribution, ini, txt(fd, "utm_campaign", 200), txt(fd, "external_ref", 200), txt(fd, "note", 1000)]);
    return "記録しました";
  });
}

export async function deleteConversion(fd: FormData) {
  await guarded("/funnel", async (ctx) => {
    const id = get(fd, "id");
    const acc = await requireOwned(ctx, "conversions", id);
    await ctx.db.query(`DELETE FROM conversions WHERE id=$1 AND account_id=$2`, [id, acc.id]);
    return "削除しました";
  });
}

export async function saveCost(fd: FormData) {
  await guarded(get(fd, "back") || "/funnel", async (ctx) => {
    const acc = await requireAccount(ctx, get(fd, "account_id"));
    const ini = get(fd, "initiative_id") || null;
    if (ini) await requireOwned(ctx, "initiatives", ini);
    const cat = must(parseEnum(get(fd, "category"), COST_CATEGORIES), "区分");
    const amount = num(fd, "amount", "金額", { min: 0 });
    if (!cat || amount === null) throw new FormError("区分と金額を入力してください");
    await ctx.db.query(`INSERT INTO costs(account_id,initiative_id,category,amount,occurred_on,note) VALUES ($1,$2,$3,$4,$5,$6)`,
      [acc.id, ini, cat, amount, must(parseDay(get(fd, "occurred_on")), "日付"), txt(fd, "note", 500)]);
    return "費用を記録しました";
  });
}

export async function saveUtm(fd: FormData) {
  await guarded(get(fd, "back") || "/funnel", async (ctx) => {
    const acc = await requireAccount(ctx, get(fd, "account_id"));
    const campaign = txt(fd, "utm_campaign", 100);
    const base = txt(fd, "base_url", 1000);
    if (!campaign || !base) throw new FormError("URLとキャンペーン名を入力してください");
    const source = txt(fd, "utm_source", 50) ?? "instagram";
    const medium = txt(fd, "utm_medium", 50) ?? "social";
    const content = txt(fd, "utm_content", 100);
    const full = buildUtmUrl(base, { source, medium, campaign, content });
    if (!full) throw new FormError("URLが不正です（http/https）");
    const ini = get(fd, "initiative_id") || null;
    if (ini) await requireOwned(ctx, "initiatives", ini);
    await ctx.db.query(`INSERT INTO utm_links(account_id,initiative_id,label,full_url,utm_source,utm_medium,utm_campaign,utm_content) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [acc.id, ini, txt(fd, "label", 100), full, source, medium, campaign, content]);
    return "UTM付きURLを作成しました";
  });
}

// ---------- オーディエンス ----------
export async function addTag(fd: FormData) {
  await guarded("/audience", async (ctx) => {
    const pid = get(fd, "person_id");
    await requireOwned(ctx, "audience_people", pid);
    const cat = get(fd, "category");
    if (!cat || !(cat in INTEREST_CATEGORIES)) throw new FormError("カテゴリが不正です");
    await ctx.db.query(`INSERT INTO person_tags(person_id,category,basis,evidence,confirmed) VALUES ($1,$2,'manual',$3,true) ON CONFLICT (person_id,category,basis) DO UPDATE SET evidence=EXCLUDED.evidence, confirmed=true`,
      [pid, cat, txt(fd, "evidence", 300) ?? "手動タグ"]);
    return "タグを付けました";
  });
}

export async function updateTag(fd: FormData) {
  await guarded("/audience", async (ctx) => {
    const id = get(fd, "tag_id");
    const [t] = await ctx.db.query<{ person_id: string }>(`SELECT person_id FROM person_tags WHERE id=$1`, [id]);
    if (!t) throw new FormError("見つかりません");
    await requireOwned(ctx, "audience_people", t.person_id);
    if (get(fd, "op") === "delete") await ctx.db.query(`DELETE FROM person_tags WHERE id=$1`, [id]);
    else await ctx.db.query(`UPDATE person_tags SET confirmed=true WHERE id=$1`, [id]);
    return get(fd, "op") === "delete" ? "タグを外しました" : "推定を確認済みにしました";
  });
}

/** 自己紹介・アンケート回答のキーワードから推定タグを付ける（推定・根拠語つき・要確認） */
export async function classifyKeywords(fd: FormData) {
  await guarded("/audience", async (ctx) => {
    const acc = await requireAccount(ctx, get(fd, "account_id"));
    const people = await ctx.db.query<{ id: string; bio: string | null; survey_answer: string | null }>(`SELECT id,bio,survey_answer FROM audience_people WHERE account_id=$1`, [acc.id]);
    let n = 0;
    for (const p of people) {
      const hits = classifyByKeywords([p.bio, p.survey_answer].filter(Boolean).join(" / "), CATEGORY_KEYWORDS);
      for (const h of hits) {
        const conf = Math.min(0.9, 0.4 + 0.15 * h.evidence.length);
        const r = await ctx.db.query(`INSERT INTO person_tags(person_id,category,basis,evidence,confidence,confirmed) VALUES ($1,$2,'keyword',$3,$4,false) ON CONFLICT DO NOTHING RETURNING id`,
          [p.id, h.category, `キーワード: ${h.evidence.join("、")}`, conf]);
        n += r.length;
      }
    }
    return `${people.length}人を確認し、推定タグを${n}件追加しました（要確認）`;
  });
}

// ---------- 週次レビュー ----------
export async function saveReview(fd: FormData) {
  const week = get(fd, "week");
  await guarded(`/review?week=${week}`, async (ctx) => {
    const acc = await requireAccount(ctx, get(fd, "account_id"));
    const w = must(parseDay(week), "週")!;
    const summary = JSON.parse(get(fd, "summary") ?? "{}");
    await ctx.db.query(
      `INSERT INTO weekly_reviews(account_id,week_start,available_minutes,summary,notes,generated_by) VALUES ($1,$2,$3,$4,$5,'rule')
       ON CONFLICT (account_id,week_start) DO UPDATE SET available_minutes=EXCLUDED.available_minutes, summary=EXCLUDED.summary, notes=EXCLUDED.notes, updated_at=now()`,
      [acc.id, w, num(fd, "available_minutes", "制作可能時間", { int: true, min: 0 }), summary, txt(fd, "notes")]);
    const plan = get(fd, "plan_ids")?.split(",").filter(Boolean) ?? [];
    for (const pid of plan) {
      await requireOwned(ctx, "initiatives", pid);
      await ctx.db.query(`UPDATE initiatives SET planned_week=$1 WHERE id=$2`, [addDays(weekStart(w), 7), pid]);
    }
    return "週次レビューを保存しました";
  });
}

// ---------- 設定・データ ----------
export async function saveAccountSettings(fd: FormData) {
  await guarded("/settings", async (ctx) => {
    const acc = await requireAccount(ctx, get(fd, "account_id"));
    const roles = (txt(fd, "roles", 3000) ?? "").split("\n").map((s) => s.trim()).filter(Boolean);
    await ctx.db.query(`UPDATE accounts SET display_name=$2, roles=$3, follower_target=$4, weekly_minutes=$5 WHERE id=$1`,
      [acc.id, txt(fd, "display_name", 100) ?? acc.display_name, roles, num(fd, "follower_target", "目標フォロワー数", { int: true, min: 0 }), num(fd, "weekly_minutes", "制作可能時間", { int: true, min: 0 })]);
    return "保存しました";
  });
}

export async function saveUserSetting(fd: FormData) {
  await guarded("/settings", async (ctx) => {
    const key = get(fd, "key");
    if (key !== "gross_profit_rule") throw new FormError("不正な設定");
    await ctx.db.query(`INSERT INTO user_settings(user_id,key,value) VALUES ($1,$2,$3) ON CONFLICT (user_id,key) DO UPDATE SET value=EXCLUDED.value`, [ctx.userId, key, JSON.stringify(txt(fd, "value", 2000))]);
    return "保存しました";
  });
}

export async function resetDemoData() {
  await guarded("/settings", async (ctx) => {
    await resetDemo(ctx.db, ctx.userId);
    return "デモデータを初期状態に戻しました";
  });
}

export async function deleteRealData(fd: FormData) {
  await guarded("/settings", async (ctx) => {
    if (get(fd, "confirm") !== "削除する") throw new FormError("確認欄に「削除する」と入力してください");
    const accs = await ctx.db.query<{ id: string }>(`SELECT id FROM accounts WHERE user_id=$1 AND dataset='real'`, [ctx.userId]);
    for (const a of accs) {
      for (const t of ["post_metrics", "account_metrics", "audience_aggregates", "conversions", "costs", "utm_links", "weekly_reviews", "initiatives", "posts", "import_batches"]) {
        await ctx.db.query(`DELETE FROM ${t} WHERE account_id=$1`, [a.id]);
      }
      await ctx.db.query(`DELETE FROM audience_people WHERE account_id=$1`, [a.id]);
    }
    return "実データ（投稿・指標・オーディエンス・施策・成果）を削除しました。ターゲット設定と接続は残っています";
  });
}

export async function disconnect(fd: FormData) {
  await guarded("/settings", async (ctx) => {
    const acc = await requireAccount(ctx, get(fd, "account_id"));
    await ctx.db.query(`UPDATE connections SET status='disconnected', token_ciphertext=NULL, token_expires_at=NULL, updated_at=now() WHERE account_id=$1`, [acc.id]);
    return "接続を解除し、保存していたトークンを削除しました（Instagram側のアプリ連携も解除する場合はInstagramの設定から）";
  });
}

export async function syncNow(fd: FormData) {
  await guarded("/settings", async (ctx) => {
    const acc = await requireAccount(ctx, get(fd, "account_id"));
    if (acc.dataset !== "real") throw new FormError("デモデータでは同期できません");
    const r = await syncAccount(ctx.db, acc.id);
    return `同期しました: 投稿${r.media}件・スナップショット${r.snapshots}件・週次 ${r.period}${r.notes.length ? `（取得できなかった項目 ${r.notes.length}件は接続状態に表示）` : ""}`;
  });
}

// ---------- 取り込み（クライアントから呼ぶ） ----------
export type ImportResponse = {
  ok: boolean;
  message?: string;
  rows?: { row: number; ok: boolean; errors: string[]; duplicate?: boolean }[];
  inserted?: number;
  duplicates?: number;
  errors?: number;
};

export async function importRows(args: { accountId: string; kind: ImportKind; rows: Record<string, unknown>[]; commit: boolean; filename: string; format: "csv" | "json"; measurement: "measured" | "manual" | "estimated" }): Promise<ImportResponse> {
  const ctx = await getContext();
  try {
    const acc = await requireAccount(ctx, args.accountId);
    if (!(args.kind in IMPORT_KINDS)) return { ok: false, message: "種類が不正です" };
    if (!Array.isArray(args.rows) || args.rows.length === 0) return { ok: false, message: "行がありません" };
    if (args.rows.length > MAX_IMPORT_ROWS) return { ok: false, message: `一度に取り込めるのは${MAX_IMPORT_ROWS}行までです` };
    const measurement = (["measured", "manual", "estimated"] as const).includes(args.measurement) ? args.measurement : "manual";
    const validated = validateRows(args.kind, args.rows);
    if (!args.commit) {
      return { ok: true, rows: validated.map((v) => ({ row: v.row, ok: v.ok, errors: v.errors })), errors: validated.filter((v) => !v.ok).length };
    }
    const res = await ctx.db.transaction((tx) => commitRows(tx, acc.id, args.kind, validated, args.format === "json" ? "json" : "csv", measurement));
    await ctx.db.query(`INSERT INTO import_batches(account_id,kind,filename,rows_total,inserted,duplicates,errors) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [acc.id, args.kind, String(args.filename).slice(0, 200), args.rows.length, res.inserted, res.duplicates, res.errors.length]);
    revalidatePath("/", "layout");
    const dup = new Set(res.duplicateRows);
    const errMap = new Map(res.errors.map((e) => [e.row, e.errors]));
    return {
      ok: true, inserted: res.inserted, duplicates: res.duplicates, errors: res.errors.length,
      rows: validated.map((v) => ({ row: v.row, ok: !errMap.has(v.row), errors: errMap.get(v.row) ?? [], duplicate: dup.has(v.row) })),
    };
  } catch (e) {
    return { ok: false, message: (e as Error).message };
  }
}
