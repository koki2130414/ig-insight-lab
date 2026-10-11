import "server-only";
import crypto from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb, type Db } from "./db";
import { LOCAL_USER } from "./seed";

export type Dataset = "demo" | "real";
export type View = "personal" | "farm" | "both";

export type Account = {
  id: string;
  user_id: string;
  dataset: Dataset;
  kind: "personal" | "farm";
  handle: string;
  display_name: string;
  roles: string[];
  follower_target: number | null;
  weekly_minutes: number | null;
  ig_user_id: string | null;
};

export type Ctx = {
  db: Db;
  userId: string;
  dataset: Dataset;
  view: View;
  accounts: Account[]; // このデータセットの2アカウント
  current: Account; // 単一表示時の対象（both のときは personal）
  selected: Account[]; // 表示対象
};

function sessionToken() {
  const secret = process.env.SESSION_SECRET || process.env.APP_PASSCODE || "";
  return crypto.createHmac("sha256", secret).update(`session:${LOCAL_USER}`).digest("hex");
}

export function authEnabled() {
  return Boolean(process.env.APP_PASSCODE);
}

export function checkPasscode(input: string) {
  const expected = process.env.APP_PASSCODE || "";
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function newSessionToken() {
  return sessionToken();
}

/** ログイン済みのユーザーIDを返す。未ログインならログイン画面へ */
export async function requireUser(): Promise<string> {
  if (!authEnabled()) {
    // インターネットに公開される環境では、パスコード無しで開けないようにする
    if (process.env.VERCEL || process.env.REQUIRE_PASSCODE === "1") throw new Error("APP_PASSCODE が未設定のため表示できません。環境変数に APP_PASSCODE を設定してください");
    return LOCAL_USER;
  }
  const c = await cookies();
  const tok = c.get("iil_session")?.value;
  const expected = sessionToken();
  if (!tok || tok.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(tok), Buffer.from(expected))) {
    redirect("/login");
  }
  return LOCAL_USER;
}

export async function getContext(): Promise<Ctx> {
  const userId = await requireUser();
  const db = await getDb();
  const c = await cookies();
  let dataset = c.get("iil_dataset")?.value as Dataset | undefined;
  if (dataset !== "demo" && dataset !== "real") {
    // 未選択: 実データが1件でもあれば実データ、無ければデモ
    const [{ n }] = await db.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM posts p JOIN accounts a ON a.id=p.account_id WHERE a.user_id=$1 AND a.dataset='real'`,
      [userId],
    );
    dataset = n > 0 ? "real" : "demo";
  }
  const viewRaw = c.get("iil_view")?.value;
  const view: View = viewRaw === "farm" || viewRaw === "both" ? viewRaw : "personal";
  const accounts = await db.query<Account>(
    `SELECT id,user_id,dataset,kind,handle,display_name,roles,follower_target,weekly_minutes,ig_user_id
       FROM accounts WHERE user_id=$1 AND dataset=$2 ORDER BY kind DESC`,
    [userId, dataset],
  );
  const current = accounts.find((a) => a.kind === (view === "both" ? "personal" : view)) ?? accounts[0];
  const selected = view === "both" ? accounts : [current];
  return { db, userId, dataset, view, accounts, current, selected };
}

/**
 * 書き込み・参照時のアカウント検証。
 * ユーザーの所有かつ「現在のデータセット」のアカウントでなければ拒否する。
 * → デモ表示中に実データへ書き込む／その逆を防ぐ。
 */
export async function requireAccount(ctx: Ctx, accountId: unknown): Promise<Account> {
  const acc = ctx.accounts.find((a) => a.id === accountId);
  if (!acc) throw new Error("このアカウントは操作できません（他ユーザーまたは別データセットのアカウント）");
  return acc;
}

/** 投稿など子レコードの所有チェック */
export async function requireOwned(ctx: Ctx, table: "posts" | "initiatives" | "targets" | "conversions" | "audience_people" | "costs" | "utm_links" | "post_metrics", id: unknown) {
  if (typeof id !== "string" || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error("IDが不正です");
  const rows = await ctx.db.query<{ account_id: string }>(`SELECT account_id FROM ${table} WHERE id=$1`, [id]);
  if (!rows.length) throw new Error("見つかりません");
  return requireAccount(ctx, rows[0].account_id);
}
