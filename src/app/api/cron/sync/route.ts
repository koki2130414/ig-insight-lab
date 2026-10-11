import crypto from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { getDb } from "@/lib/db";
import { syncConnected } from "@/lib/instagram/auto";

// Vercel Cron から定期的に呼ばれ、接続済みアカウントの公式APIデータを同期する
export const maxDuration = 300;

function authorized(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false; // 未設定なら誰も呼べない
  const got = Buffer.from(req.headers.get("authorization") ?? "");
  const want = Buffer.from(`Bearer ${secret}`);
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ ok: false }, { status: 401 });
  const db = await getDb();
  // 定期実行では、直近30分以内に同期したアカウントだけ飛ばす
  const results = await syncConnected(db, { staleMs: 30 * 60 * 1000 });
  return NextResponse.json({ ok: true, results: results.map((r) => ({ handle: r.handle, ok: r.ok, message: r.message })) });
}
