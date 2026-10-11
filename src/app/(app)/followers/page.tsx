import Link from "next/link";
import { getContext } from "@/lib/context";
import { deleteFollowerList, importFollowers } from "@/app/actions";
import { Badge, Card, Empty, Field, Flash, Note, PageHeader, SourceBadge } from "@/components/ui";
import { Submit } from "@/components/client";
import { FollowerChart } from "@/components/charts";
import { followerSeries } from "@/lib/queries";
import { diffFollowers } from "@/lib/followers";
import { metaConfigured } from "@/lib/instagram/adapter";
import { fmtDate, fmtDateTime } from "@/lib/time";

type List = { id: string; captured_at: Date; filename: string | null; total: number };
type Member = { list_id: string; username: string; followed_at: Date | null };

function Who({ names, tone }: { names: string[]; tone: "green" | "red" }) {
  if (!names.length) return <p className="text-sm text-muted">なし</p>;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {names.map((n) => (
        <li key={n}>
          <a href={`https://www.instagram.com/${n}/`} target="_blank" rel="noopener noreferrer"
            className={`inline-block rounded border px-2 py-0.5 text-[13px] ${tone === "green" ? "border-leaf/30 bg-leaf-soft" : "border-warn/30 bg-warn-soft"}`}>@{n}</a>
        </li>
      ))}
    </ul>
  );
}

export default async function FollowersPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const acc = ctx.current;
  const [series, lists, conn] = await Promise.all([
    followerSeries(ctx, acc.id),
    ctx.db.query<List>(`SELECT id, captured_at, filename, total FROM follower_lists WHERE account_id=$1 ORDER BY captured_at DESC LIMIT 12`, [acc.id]),
    ctx.db.query<{ status: string; last_synced_at: Date | null }>(`SELECT status, last_synced_at FROM connections WHERE account_id=$1`, [acc.id]),
  ]);
  const members = lists.length
    ? await ctx.db.query<Member>(`SELECT list_id, username, followed_at FROM follower_list_members WHERE list_id IN (SELECT id FROM follower_lists WHERE account_id=$1 ORDER BY captured_at DESC LIMIT 12)`, [acc.id])
    : [];
  const byList = new Map<string, Member[]>();
  for (const m of members) byList.set(m.list_id, [...(byList.get(m.list_id) ?? []), m]);
  const names = (id: string) => (byList.get(id) ?? []).map((m) => m.username);

  // 新しい順に、1つ前の一覧との差分
  const diffs = lists.slice(0, -1).map((cur, i) => ({ cur, prev: lists[i + 1], ...diffFollowers(names(lists[i + 1].id), names(cur.id)) }));
  const latest = lists[0];
  const recent = latest
    ? (byList.get(latest.id) ?? []).filter((m) => m.followed_at).sort((a, b) => new Date(b.followed_at!).getTime() - new Date(a.followed_at!).getTime()).slice(0, 40)
    : [];

  // 日ごとのフォロワー数（同じ日に複数あれば公式API優先）
  const daily = new Map<string, { day: string; value: number | null; source: string }>();
  for (const s of series) {
    const k = String(s.day);
    if (!daily.has(k) || s.source === "api") daily.set(k, { ...s, day: k });
  }
  const days = [...daily.values()];
  const rows = days.map((d, i) => ({ ...d, change: i > 0 && d.value !== null && days[i - 1].value !== null ? d.value - days[i - 1].value! : null })).reverse().slice(0, 30);

  const c = conn[0];
  const auto = c?.status === "connected" && metaConfigured().ok;

  return (
    <>
      <PageHeader title={`フォロワーの増減｜${acc.display_name}`} sub="フォロワー数は公式APIで自動更新。誰がフォローした・外したかは、Instagramの書き出しファイルを取り込むたびに更新します。" />
      <Flash sp={sp} />

      <Card title="自動更新の状態" className="mb-4">
        {ctx.dataset === "demo" ? (
          <p className="text-sm text-muted">デモデータは自動更新しません。</p>
        ) : auto ? (
          <p className="text-sm"><Badge t="green">自動更新中</Badge> 1日4回（6時・12時・18時・0時ごろ）と、前回から1時間以上たってこのアプリを開いたときに公式APIから同期します。最終同期: {fmtDateTime(c?.last_synced_at ?? null)}</p>
        ) : (
          <Note t="gold">公式APIが未接続のため、自動更新は止まっています。<Link href="/settings" className="underline">設定・接続</Link>で @{acc.handle} を接続すると、フォロワー数・投稿・インサイトが自動で更新されます。</Note>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="フォロワー数の推移">
          {days.length === 0 ? (
            <p className="text-sm text-muted">まだ記録がありません。</p>
          ) : (
            <>
              <FollowerChart data={days.map((d) => ({ day: d.day, value: d.value }))} target={acc.follower_target} />
              <table className="mt-3 w-full text-sm">
                <thead><tr className="text-left text-xs text-muted"><th className="py-1">日付</th><th className="text-right">フォロワー</th><th className="text-right">前回比</th><th></th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.day} className="border-t border-line">
                      <td className="py-1">{fmtDate(r.day)}</td>
                      <td className="num text-right">{r.value === null ? "未取得" : r.value.toLocaleString("ja-JP")}</td>
                      <td className={`num text-right ${r.change !== null && r.change < 0 ? "text-warn" : "text-leaf"}`}>{r.change === null ? "—" : `${r.change > 0 ? "+" : ""}${r.change}`}</td>
                      <td className="text-right"><SourceBadge source={r.source} measurement={r.source === "api" ? "measured" : "manual"} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </Card>

        <Card title="誰がフォローした・外したか">
          {lists.length === 0 ? (
            <Empty title="フォロワー一覧がまだありません">下の手順でInstagramから書き出したファイルを取り込むと表示されます。</Empty>
          ) : (
            <div className="space-y-4">
              {diffs.length === 0 && (
                <Note>一覧が1回分だけなので、フォローを外した人はまだ分かりません。次に書き出して取り込むと、その間の増減が表示されます。</Note>
              )}
              {diffs.map((d) => (
                <div key={d.cur.id} className="rounded-md border border-line p-3">
                  <div className="mb-2 text-xs text-muted">{fmtDateTime(d.prev.captured_at)} → {fmtDateTime(d.cur.captured_at)}（{d.prev.total.toLocaleString("ja-JP")}人 → {d.cur.total.toLocaleString("ja-JP")}人）</div>
                  <h3 className="mb-1 text-sm font-bold text-leaf">フォローした人 {d.gained.length}人</h3>
                  <Who names={d.gained} tone="green" />
                  <h3 className="mb-1 mt-3 text-sm font-bold text-warn">フォローを外した人 {d.lost.length}人</h3>
                  <Who names={d.lost} tone="red" />
                </div>
              ))}
              {recent.length > 0 && (
                <div>
                  <h3 className="mb-1 text-sm font-bold">最近フォローした人（{fmtDateTime(latest.captured_at)}の一覧より）</h3>
                  <ul className="divide-y divide-line text-sm">
                    {recent.map((m) => (
                      <li key={m.username} className="flex justify-between py-1">
                        <a href={`https://www.instagram.com/${m.username}/`} target="_blank" rel="noopener noreferrer" className="underline">@{m.username}</a>
                        <span className="text-xs text-muted">{fmtDateTime(m.followed_at)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-[12px] text-muted">「外した人」には、アカウントの削除・停止、ユーザーネームの変更、こちらからのブロック・削除も含まれます（ユーザーネームを変えた人は「外した人」と「フォローした人」の両方に出ます）。</p>
            </div>
          )}
        </Card>
      </div>

      <Card title="フォロワー一覧を取り込む" className="mt-4">
        <div className="grid gap-4 lg:grid-cols-2">
          <div className="text-sm">
            <p className="mb-2">公式APIではフォロワーの「人数」しか取得できず、「誰が」は取得できません。そのため、Instagram公式の「情報をダウンロード」で書き出したファイルを使います。</p>
            <ol className="list-decimal space-y-1 pl-5 text-[13px]">
              <li>Instagramアプリ → プロフィール → メニュー → <b>アカウントセンター</b></li>
              <li><b>あなたの情報とアクセス許可</b> → <b>情報をダウンロード</b> → 情報をダウンロードまたは転送</li>
              <li>@{acc.handle} を選ぶ → <b>情報の一部</b> → <b>フォロワーとフォロー中</b> だけにチェック</li>
              <li><b>デバイスにダウンロード</b> → 期間「全期間」、形式「<b>JSON</b>」 → ファイルを作成</li>
              <li>準備ができたら通知・メールが届くので、zipをダウンロードしてここで取り込む（zipのままでOK）</li>
            </ol>
            <p className="mt-2 text-[12px] text-muted">書き出すたびに前回との差分（フォローした人・外した人）が記録されます。週1回など定期的に書き出すのがおすすめです。</p>
          </div>
          {ctx.dataset === "demo" ? (
            <Note t="gold">取り込みは「実データ」表示に切り替えてから行えます。</Note>
          ) : (
            <form action={importFollowers} className="space-y-3">
              <input type="hidden" name="account_id" value={acc.id} />
              <Field label={`ファイル（@${acc.handle} の書き出し。zip / followers_1.json / followers_1.html）`}>
                <input type="file" name="file" accept=".zip,.json,.html" required className="field" />
              </Field>
              <Field label="書き出しを作った日時（空欄なら今）" hint="通知・メールに書かれた日時。差分の期間に使います">
                <input type="datetime-local" name="captured_at" className="field" />
              </Field>
              <Submit pendingText="取り込み中…">取り込む</Submit>
            </form>
          )}
        </div>
        {lists.length > 0 && (
          <ul className="mt-4 divide-y divide-line text-sm">
            {lists.map((l) => (
              <li key={l.id} className="flex items-center justify-between gap-2 py-1.5">
                <span>{fmtDateTime(l.captured_at)}・{l.total.toLocaleString("ja-JP")}人 <span className="text-xs text-muted">{l.filename}</span></span>
                {ctx.dataset === "real" && (
                  <form action={deleteFollowerList}><input type="hidden" name="list_id" value={l.id} /><Submit className="text-xs text-warn underline" confirm="この一覧を削除しますか？" pendingText="削除中">削除</Submit></form>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
