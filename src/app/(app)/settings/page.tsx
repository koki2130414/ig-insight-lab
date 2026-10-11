import { getContext } from "@/lib/context";
import { deleteRealData, disconnect, saveAccountSettings, saveUserSetting, syncNow } from "@/app/actions";
import { Badge, Card, Field, Flash, Note, PageHeader } from "@/components/ui";
import { Submit } from "@/components/client";
import { ACCOUNT_METRICS, POST_METRICS, FORMATS } from "@/lib/catalog";
import { GRAPH_VERSION, metaConfigured } from "@/lib/instagram/adapter";
import { aiConnected } from "@/lib/generator";
import { fmtDateTime } from "@/lib/time";

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const realAccounts = await ctx.db.query<{ id: string; display_name: string; handle: string }>(`SELECT id, display_name, handle FROM accounts WHERE user_id=$1 AND dataset='real' ORDER BY kind DESC`, [ctx.userId]);
  const conns = await ctx.db.query<{ account_id: string; status: string; token_expires_at: Date | null; scopes: string[]; ig_username: string | null; last_synced_at: Date | null; last_sync_range: string | null; last_error: string | null }>(
    `SELECT account_id, status, token_expires_at, scopes, ig_username, last_synced_at, last_sync_range, last_error FROM connections WHERE account_id IN (SELECT id FROM accounts WHERE user_id=$1)`, [ctx.userId]);
  const [rule] = await ctx.db.query<{ value: string | null }>(`SELECT value FROM user_settings WHERE user_id=$1 AND key='gross_profit_rule'`, [ctx.userId]);
  const meta = metaConfigured();

  return (
    <>
      <PageHeader title="設定・接続" sub="アカウントの役割、目標、公式API接続、データの書き出し・削除" />
      <Flash sp={sp} />

      <div className="grid gap-4 lg:grid-cols-2">
        {ctx.accounts.map((a) => (
          <Card key={a.id} title={`${a.display_name}（@${a.handle}）`}>
            <form action={saveAccountSettings} className="space-y-3">
              <input type="hidden" name="account_id" value={a.id} />
              <Field label="表示名"><input name="display_name" defaultValue={a.display_name} className="field" /></Field>
              <Field label="アカウントの役割（初期仮説・1行に1つ）"><textarea name="roles" rows={4} defaultValue={a.roles.join("\n")} className="field" /></Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="フォロワー目標" hint={a.kind === "farm" ? "売上・粗利益・継続購入・運営負担と合わせて見る" : undefined}><input name="follower_target" inputMode="numeric" defaultValue={a.follower_target ?? ""} className="field num" /></Field>
                <Field label="週の制作可能時間（分）"><input name="weekly_minutes" inputMode="numeric" defaultValue={a.weekly_minutes ?? ""} className="field num" /></Field>
              </div>
              <Submit>保存</Submit>
            </form>
          </Card>
        ))}
      </div>

      <Card title="粗利益の算定条件" className="mt-4">
        <form action={saveUserSetting} className="space-y-2">
          <input type="hidden" name="key" value="gross_profit_rule" />
          <textarea name="value" rows={2} defaultValue={rule?.value ?? ""} className="field" placeholder="例: 粗利益＝売上−（米の原価＋袋・箱＋送料＋決済手数料）。人件費・制作費は含めない" />
          <Submit>保存</Submit>
        </form>
      </Card>

      <Card title={`Instagram公式API接続（Instagram API with Instagram Login / ${GRAPH_VERSION}）`} className="mt-4">
        <div className="space-y-2">
          <Note>プロアカウント（ビジネス／クリエイター）で、自分が管理するアカウントのみ接続できます。アカウント名を入力するだけで非公開のインサイトを取得する機能はありません。Instagramのパスワードはこのアプリに保存しません。</Note>
          {!meta.ok && <Note t="gold">接続に必要な環境変数が未設定です: {meta.missing.join(", ")}（README「アカウント接続」を参照）。API未接続でも、手入力・CSVで全機能を使えます。</Note>}
        </div>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {realAccounts.map((a) => {
            const c = conns.find((x) => x.account_id === a.id);
            const status = c?.status ?? "disconnected";
            return (
              <div key={a.id} className="rounded-md border border-line p-3 text-sm">
                <div className="flex items-center justify-between">
                  <b>{a.display_name}（@{a.handle}）</b>
                  <Badge t={status === "connected" ? "green" : status === "disconnected" ? "gray" : "red"}>{{ connected: "接続中", expired: "期限切れ", error: "エラー", disconnected: "未接続" }[status]}</Badge>
                </div>
                <dl className="mt-2 grid grid-cols-[7rem_1fr] gap-y-1 text-[13px]">
                  <dt className="text-muted">最終同期</dt><dd>{fmtDateTime(c?.last_synced_at ?? null)}</dd>
                  <dt className="text-muted">取得期間</dt><dd>{c?.last_sync_range ?? "—"}</dd>
                  <dt className="text-muted">トークン期限</dt><dd>{fmtDateTime(c?.token_expires_at ?? null)}</dd>
                  <dt className="text-muted">許可された権限</dt><dd className="break-all">{c?.scopes?.join(", ") || "—"}</dd>
                </dl>
                {c?.last_error && <p className="mt-2 whitespace-pre-wrap rounded bg-warn-soft p-2 text-xs">取得できなかった項目・エラー:\n{c.last_error}</p>}
                <div className="mt-3 flex flex-wrap gap-2">
                  {meta.ok && <a href={`/api/oauth/instagram/start?account=${a.id}`} className={status === "connected" ? "btn-ghost" : "btn"}>{status === "connected" ? "再接続" : "接続する"}</a>}
                  {status === "connected" && ctx.dataset === "real" && (
                    <form action={syncNow}><input type="hidden" name="account_id" value={a.id} /><Submit className="btn-ghost" pendingText="同期中…">今すぐ同期</Submit></form>
                  )}
                  {c && status !== "disconnected" && ctx.dataset === "real" && (
                    <form action={disconnect}><input type="hidden" name="account_id" value={a.id} /><Submit className="btn-ghost" confirm="接続を解除し、保存しているトークンを削除しますか？" pendingText="解除中">接続解除</Submit></form>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <details className="mt-4 text-sm">
          <summary className="cursor-pointer font-semibold">指標ごとの取得可否（公式APIで確認できたもの）</summary>
          <div className="mt-2 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="mb-1 text-xs font-bold">投稿単位</h3>
              <ul className="space-y-1 text-[13px]">
                {POST_METRICS.map((m) => (
                  <li key={m.key}><b>{m.label}</b>: {m.api ? <>API {m.api.name}（{m.api.formats?.map((f) => FORMATS[f]).join("・")}）{m.api.note && ` ※${m.api.note}`}</> : <span className="text-warn">API非対応 — {m.apiUnavailableReason}</span>}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="mb-1 text-xs font-bold">アカウント単位</h3>
              <ul className="space-y-1 text-[13px]">
                {ACCOUNT_METRICS.map((m) => (
                  <li key={m.key}><b>{m.label}</b>: {m.api ? <>API {m.api.name}{m.api.note && ` ※${m.api.note}`}</> : <span className="text-warn">API非対応 — {m.apiUnavailableReason}</span>}</li>
                ))}
              </ul>
              <p className="mt-2 text-[12px] text-muted">投稿後24時間・72時間・7日の値は、過去にさかのぼって取得できません。同期した時点のスナップショット（各時点の±25%以内）か手入力で記録します。ストーリーズの指標は公開後24時間のみ取得できます。</p>
            </div>
          </div>
        </details>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card title="AI">
          <p className="text-sm">{aiConnected() ? <Badge t="green">接続済み</Badge> : <Badge>AI未接続</Badge>} 施策案の生成に使います。送信前に送信内容を表示し、同意を求めます。個人のプロフィールやオーディエンスの個人データは送りません。</p>
        </Card>
        <Card title="データの書き出し">
          <p className="mb-2 text-sm">実データをJSONで書き出します。トークンは含みません。</p>
          <a href="/api/export" className="btn-ghost">JSONをダウンロード</a>
        </Card>
        <Card title="データの削除">
          <form action={deleteRealData} className="space-y-2">
            <p className="text-sm">実データの投稿・指標・オーディエンス・施策・成果をすべて削除します（元に戻せません）。</p>
            <input name="confirm" placeholder="「削除する」と入力" className="field" />
            <Submit className="btn-danger" pendingText="削除中…">実データを削除</Submit>
          </form>
        </Card>
      </div>
    </>
  );
}
