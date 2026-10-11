import { getContext } from "@/lib/context";
import { Card, Note, PageHeader } from "@/components/ui";
import { Importer } from "@/components/importer-ui";
import { IMPORT_FIELDS, IMPORT_KINDS } from "@/lib/importer";
import { fmtDateTime } from "@/lib/time";

export default async function ImportPage() {
  const ctx = await getContext();
  const batches = await ctx.db.query<{ kind: string; filename: string; rows_total: number; inserted: number; duplicates: number; errors: number; created_at: Date; display_name: string }>(
    `SELECT b.*, a.display_name FROM import_batches b JOIN accounts a ON a.id=b.account_id WHERE a.user_id=$1 AND a.dataset=$2 ORDER BY b.created_at DESC LIMIT 10`,
    [ctx.userId, ctx.dataset],
  );
  return (
    <>
      <PageHeader title="CSV・JSONの取り込み" sub="ユーザー自身が用意した投稿実績・インサイト・成果データを取り込みます。" />
      <div className="mb-4 grid gap-3 text-[13px] md:grid-cols-3">
        <Note>おすすめの順番: ①投稿 → ②投稿の実績（24h/72h/7d）→ ③アカウント指標 → ④問い合わせ・購入。実績は投稿URLかメディアIDで投稿に紐づけます。</Note>
        <Note>フォロワー一覧に職業や自己紹介が含まれるとは限りません。オーディエンスのサンプルは、本人が持っている自己紹介・アンケート回答などがある場合だけ取り込みます。</Note>
        <Note>同じファイルを何度取り込んでも、同じ投稿URL・同じ時点・同じ期間の値は重複登録しません（既存値の上書きもしません）。</Note>
      </div>
      <Card>
        <Importer
          accounts={ctx.accounts.map((a) => ({ id: a.id, name: `${a.display_name}（@${a.handle}）` }))}
          defaultAccount={ctx.current.id}
          kinds={IMPORT_KINDS}
          fields={IMPORT_FIELDS}
        />
      </Card>
      {batches.length > 0 && (
        <Card title="取り込み履歴" className="mt-4">
          <ul className="space-y-1 text-sm">
            {batches.map((b, i) => (
              <li key={i} className="flex flex-wrap gap-x-3 text-[13px]">
                <span className="text-muted">{fmtDateTime(b.created_at)}</span>
                <span>{b.display_name}・{IMPORT_KINDS[b.kind as keyof typeof IMPORT_KINDS]}</span>
                <span className="text-muted">{b.filename}</span>
                <span>追加{b.inserted}／重複{b.duplicates}／エラー{b.errors}（全{b.rows_total}行）</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </>
  );
}
