import { NextResponse } from "next/server";
import { getContext } from "@/lib/context";

// 現在のデータセット（実データ/デモ）をJSONでエクスポート。認証情報（トークン）は含めない
export async function GET() {
  const ctx = await getContext();
  const ids = ctx.accounts.map((a) => a.id);
  const q = (sql: string) => ctx.db.query(sql, [JSON.stringify(ids)]);
  const inAcc = `account_id IN (SELECT jsonb_array_elements_text($1::jsonb)::uuid)`;
  const data = {
    exported_at: new Date().toISOString(),
    dataset: ctx.dataset,
    accounts: ctx.accounts.map(({ id, kind, handle, display_name, roles, follower_target, weekly_minutes }) => ({ id, kind, handle, display_name, roles, follower_target, weekly_minutes })),
    targets: await q(`SELECT * FROM targets WHERE ${inAcc}`),
    posts: await q(`SELECT * FROM posts WHERE ${inAcc}`),
    post_metrics: await q(`SELECT * FROM post_metrics WHERE ${inAcc}`),
    account_metrics: await q(`SELECT * FROM account_metrics WHERE ${inAcc}`),
    audience_aggregates: await q(`SELECT * FROM audience_aggregates WHERE ${inAcc}`),
    audience_people: await q(`SELECT * FROM audience_people WHERE ${inAcc}`),
    person_tags: await q(`SELECT t.* FROM person_tags t JOIN audience_people p ON p.id=t.person_id WHERE p.${inAcc}`),
    initiatives: await q(`SELECT * FROM initiatives WHERE ${inAcc}`),
    conversions: await q(`SELECT * FROM conversions WHERE ${inAcc}`),
    costs: await q(`SELECT * FROM costs WHERE ${inAcc}`),
    utm_links: await q(`SELECT * FROM utm_links WHERE ${inAcc}`),
    weekly_reviews: await q(`SELECT * FROM weekly_reviews WHERE ${inAcc}`),
    connections: await q(`SELECT account_id, provider, status, ig_username, last_synced_at, last_sync_range FROM connections WHERE ${inAcc}`),
  };
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="ig-insight-lab-${ctx.dataset}-${new Date().toISOString().slice(0, 10)}.json"`,
      "cache-control": "no-store",
    },
  });
}
