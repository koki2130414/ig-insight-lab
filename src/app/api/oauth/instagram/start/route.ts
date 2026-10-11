import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getContext } from "@/lib/context";
import { metaConfigured, OAUTH_AUTHORIZE, SCOPES } from "@/lib/instagram/adapter";

export async function GET(req: NextRequest) {
  const ctx = await getContext();
  const cfg = metaConfigured();
  if (!cfg.ok) return NextResponse.redirect(new URL(`/settings?err=${encodeURIComponent("Meta連携の環境変数が未設定です: " + cfg.missing.join(", "))}`, req.url));
  const accountId = req.nextUrl.searchParams.get("account");
  const acc = ctx.accounts.find((a) => a.id === accountId);
  if (!acc || acc.dataset !== "real") return NextResponse.redirect(new URL(`/settings?err=${encodeURIComponent("実データのアカウントを選んでください")}`, req.url));
  const state = crypto.randomBytes(24).toString("base64url");
  await ctx.db.query(`DELETE FROM oauth_states WHERE created_at < now() - interval '1 hour'`);
  await ctx.db.query(`INSERT INTO oauth_states(state,user_id,account_id) VALUES ($1,$2,$3)`, [state, ctx.userId, acc.id]);
  const url = new URL(OAUTH_AUTHORIZE);
  url.searchParams.set("client_id", process.env.META_APP_ID!);
  url.searchParams.set("redirect_uri", process.env.META_REDIRECT_URI!);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES.join(","));
  url.searchParams.set("state", state);
  const res = NextResponse.redirect(url);
  // state はDBとCookieの両方で照合する（CSRF対策）
  res.cookies.set("iil_oauth_state", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/oauth", maxAge: 600 });
  return res;
}
