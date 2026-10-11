import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/context";
import { exchangeCode, graphAdapter } from "@/lib/instagram/adapter";
import { encryptSecret, redact } from "@/lib/secrets";

function back(req: NextRequest, kind: "ok" | "err", msg: string) {
  const res = NextResponse.redirect(new URL(`/settings?${kind}=${encodeURIComponent(msg)}`, req.url));
  res.cookies.delete({ name: "iil_oauth_state", path: "/api/oauth" });
  return res;
}

export async function GET(req: NextRequest) {
  const ctx = await getContext();
  const sp = req.nextUrl.searchParams;
  if (sp.get("error")) return back(req, "err", `接続がキャンセルされました（${sp.get("error_reason") ?? sp.get("error")}）`);
  const state = sp.get("state") ?? "";
  const cookieState = req.cookies.get("iil_oauth_state")?.value;
  if (!state || !cookieState || state !== cookieState) return back(req, "err", "state の検証に失敗しました。もう一度接続してください");
  const rows = await ctx.db.query<{ account_id: string; user_id: string; created_at: Date }>(`DELETE FROM oauth_states WHERE state=$1 RETURNING account_id, user_id, created_at`, [state]);
  const st = rows[0];
  if (!st || st.user_id !== ctx.userId || Date.now() - new Date(st.created_at).getTime() > 10 * 60 * 1000) return back(req, "err", "接続の有効期限が切れました。もう一度接続してください");
  const acc = ctx.accounts.find((a) => a.id === st.account_id) ?? (await ctx.db.query<{ id: string; handle: string; dataset: string }>(`SELECT id, handle, dataset FROM accounts WHERE id=$1 AND user_id=$2`, [st.account_id, ctx.userId]))[0];
  if (!acc || acc.dataset !== "real") return back(req, "err", "接続先アカウントが不正です");
  const code = sp.get("code");
  if (!code) return back(req, "err", "認可コードがありません");
  try {
    const tok = await exchangeCode(code);
    const profile = await graphAdapter(tok.accessToken).profile();
    // 別のInstagramアカウントでログインした場合は保存しない（データ混在防止）
    if (profile.username.toLowerCase() !== acc.handle.toLowerCase()) {
      return back(req, "err", `ログインしたアカウント(@${profile.username})が接続先(@${acc.handle})と違うため保存しませんでした`);
    }
    await ctx.db.query(
      `INSERT INTO connections(account_id,provider,status,token_ciphertext,token_expires_at,scopes,ig_username,last_error,updated_at)
       VALUES ($1,'instagram_login','connected',$2,$3,$4,$5,NULL,now())
       ON CONFLICT (account_id) DO UPDATE SET status='connected', token_ciphertext=EXCLUDED.token_ciphertext, token_expires_at=EXCLUDED.token_expires_at, scopes=EXCLUDED.scopes, ig_username=EXCLUDED.ig_username, last_error=NULL, updated_at=now()`,
      [acc.id, encryptSecret(tok.accessToken), tok.expiresAt, tok.permissions, profile.username]);
    await ctx.db.query(`UPDATE accounts SET ig_user_id=$2 WHERE id=$1`, [acc.id, profile.user_id ?? profile.id]);
    const missing = ["instagram_business_basic", "instagram_business_manage_insights"].filter((p) => !tok.permissions.includes(p));
    return back(req, "ok", `@${profile.username} を接続しました。${missing.length ? `未許可の権限: ${missing.join(", ")}（インサイトが取得できない可能性）` : "「今すぐ同期」でデータを取得できます"}`);
  } catch (e) {
    return back(req, "err", `接続に失敗しました: ${redact((e as Error).message)}`);
  }
}
