import Link from "next/link";
import { getContext } from "@/lib/context";
import { addTag, classifyKeywords, updateTag } from "@/app/actions";
import { Badge, Card, Empty, Flash, Note, Options, PageHeader, SourceBadge } from "@/components/ui";
import { Disclosure, Submit } from "@/components/client";
import { INTEREST_CATEGORIES } from "@/lib/catalog";
import { fmtDateTime } from "@/lib/time";

type Agg = { segment: string; dimension: string; bucket: string; value: number | null; unit: string; timeframe: string; source: string; captured_at: Date };
type Person = { id: string; segment: string; handle: string | null; bio: string | null; survey_answer: string | null; selection_method: string | null; source: string };
type Tag = { id: string; person_id: string; category: string; basis: string; evidence: string | null; confidence: number | null; confirmed: boolean };

const SEGMENTS = [
  { key: "followers", label: "フォロワー", desc: "公式インサイトのフォロワー属性（上位のみ・フォロワー100人以上で取得可）" },
  { key: "reached", label: "投稿に到達した人", desc: "到達者の属性。非フォロワーを含む。フォロワー属性から推測しない" },
  { key: "engaged", label: "投稿に反応した人", desc: "反応したアカウントの属性（期間内の反応が100件以上で取得可）" },
] as const;
const DIMS: Record<string, string> = { age: "年齢", gender: "性別", city: "市区町村", country: "国", age_gender: "年齢×性別" };
const PEOPLE_SEG: Record<string, string> = { follower: "フォロワー", commenter: "コメントした人", survey: "アンケート回答者", customer: "顧客", other: "その他" };
const BASIS: Record<string, string> = { self_reported: "本人申告", manual: "手動タグ", keyword: "推定（キーワード）", ai: "推定（AI）" };

export default async function AudiencePage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const acc = ctx.current;
  const aggs = await ctx.db.query<Agg>(`SELECT * FROM audience_aggregates WHERE account_id=$1 ORDER BY captured_at DESC, value DESC NULLS LAST`, [acc.id]);
  const people = await ctx.db.query<Person>(`SELECT * FROM audience_people WHERE account_id=$1 ORDER BY segment, imported_at DESC`, [acc.id]);
  const tags = await ctx.db.query<Tag>(`SELECT t.* FROM person_tags t JOIN audience_people p ON p.id=t.person_id WHERE p.account_id=$1`, [acc.id]);

  // 最新の取得日時の集計だけを使う（異なる時点を混ぜない）
  const latest = (seg: string, dim: string) => {
    const rows = aggs.filter((a) => a.segment === seg && a.dimension === dim);
    if (!rows.length) return [];
    const t = new Date(rows[0].captured_at).getTime();
    return rows.filter((r) => new Date(r.captured_at).getTime() === t);
  };

  // サンプル（取り込んだ人）を、区分×選び方ごとに集計
  const groups = new Map<string, Person[]>();
  for (const p of people) {
    const k = `${p.segment}||${p.selection_method ?? "（選び方未記録）"}`;
    groups.set(k, [...(groups.get(k) ?? []), p]);
  }

  return (
    <>
      <PageHeader title={`オーディエンス分析｜${acc.display_name}`} sub="「フォロワー」「投稿に到達した人」「投稿に反応した人」を分けて扱います。取得できた集計だけを表示します。" />
      <Flash sp={sp} />
      <div className="mb-4"><Note>名前や写真から年齢・性別・職業を推定しません。健康・政治・宗教などのセンシティブな属性は扱いません。</Note></div>

      <div className="grid gap-4 lg:grid-cols-3">
        {SEGMENTS.map((s) => {
          const dims = Object.keys(DIMS).map((d) => ({ d, rows: latest(s.key, d) })).filter((x) => x.rows.length);
          return (
            <Card key={s.key} title={s.label}>
              <p className="mb-3 text-[12px] text-muted">{s.desc}</p>
              {dims.length === 0 ? (
                <p className="rounded-md border border-dashed border-line p-3 text-center text-sm text-muted">未取得<br /><span className="text-[12px]">API接続、または<Link href="/import" className="underline">集計CSVの取り込み</Link>で表示されます</span></p>
              ) : dims.map(({ d, rows }) => {
                const max = Math.max(...rows.map((r) => r.value ?? 0), 1);
                return (
                  <div key={d} className="mb-3">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-semibold">{DIMS[d]}</span>
                      <span className="flex items-center gap-1 text-muted">{rows[0].timeframe}・{fmtDateTime(rows[0].captured_at)} <SourceBadge source={rows[0].source} measurement="measured" /></span>
                    </div>
                    <ul className="space-y-1">
                      {rows.slice(0, 8).map((r) => (
                        <li key={r.bucket} className="grid grid-cols-[5.5rem_1fr_3.5rem] items-center gap-2 text-xs">
                          <span className="truncate">{r.bucket}</span>
                          <span className="h-2 rounded bg-paper"><span className="block h-2 rounded bg-leaf" style={{ width: `${((r.value ?? 0) / max) * 100}%` }} /></span>
                          <span className="num text-right">{r.value === null ? "未取得" : r.unit === "percent" ? `${r.value}%` : r.value.toLocaleString("ja-JP")}</span>
                        </li>
                      ))}
                    </ul>
                    {rows.length > 8 && <p className="mt-1 text-[11px] text-muted">ほか{rows.length - 8}区分</p>}
                  </div>
                );
              })}
            </Card>
          );
        })}
      </div>

      <Card
        title="本人が提供したサンプル（自己紹介・アンケート・コメント・顧客）"
        className="mt-4"
        actions={
          <form action={classifyKeywords}>
            <input type="hidden" name="account_id" value={acc.id} />
            <Submit className="btn-ghost" pendingText="分類中…">キーワードから推定タグを付ける</Submit>
          </form>
        }
      >
        <Note t="gold">ここでの構成比は「取り込んだ人の中での比率」です。回答者やコメントした人の特徴を、フォロワー全体の構成比として扱いません。推定タグは根拠と信頼度つきで表示し、確認・修正できます。</Note>
        {people.length === 0 ? (
          <div className="mt-3"><Empty title="サンプルがありません"><Link href="/import" className="underline">オーディエンスのサンプル</Link>（自己紹介・アンケート回答など、本人が持っているデータ）を取り込むと分類できます。</Empty></div>
        ) : (
          <div className="mt-3 space-y-4">
            {[...groups.entries()].map(([k, ps]) => {
              const [seg, method] = k.split("||");
              const ids = new Set(ps.map((p) => p.id));
              const gt = tags.filter((t) => ids.has(t.person_id));
              const classified = new Set(gt.filter((t) => t.category !== "unknown").map((t) => t.person_id));
              const unclassified = ps.length - classified.size;
              return (
                <div key={k} className="rounded-md border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-bold">{PEOPLE_SEG[seg]}</span>
                    <span className="text-muted">対象者の選び方: {method}</span>
                    <Badge>{ps.length}人</Badge>
                    <Badge t={unclassified / ps.length > 0.5 ? "gold" : "gray"}>未分類 {Math.round((unclassified / ps.length) * 100)}%（{unclassified}人）</Badge>
                  </div>
                  <div className="mt-2 grid gap-1 text-xs sm:grid-cols-2 lg:grid-cols-3">
                    {Object.entries(INTEREST_CATEGORIES).filter(([c]) => c !== "unknown").map(([c, label]) => {
                      const confirmed = new Set(gt.filter((t) => t.category === c && t.confirmed).map((t) => t.person_id)).size;
                      const est = new Set(gt.filter((t) => t.category === c && !t.confirmed).map((t) => t.person_id)).size;
                      return (
                        <div key={c} className="flex justify-between rounded bg-paper px-2 py-1">
                          <span>{label}</span>
                          <span className="num">確認済 {confirmed}／推定 {est}（{ps.length}人中）</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
            <Disclosure summary={`1人ずつ確認・修正する（${people.length}人）`}>
              <ul className="divide-y divide-line">
                {people.map((p) => (
                  <li key={p.id} className="py-2.5 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">@{p.handle}</span>
                      <Badge>{PEOPLE_SEG[p.segment]}</Badge>
                      {p.source === "demo" && <Badge t="demo">デモ</Badge>}
                    </div>
                    {p.bio && <p className="mt-0.5 text-[13px] text-muted">自己紹介: {p.bio}</p>}
                    {p.survey_answer && <p className="mt-0.5 text-[13px] text-muted">回答: {p.survey_answer}</p>}
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {tags.filter((t) => t.person_id === p.id).map((t) => (
                        <span key={t.id} className="inline-flex items-center gap-1 rounded border border-line bg-white px-1.5 py-0.5 text-[11px]">
                          <span className={t.confirmed ? "font-semibold text-leaf" : "text-rice"}>{INTEREST_CATEGORIES[t.category as keyof typeof INTEREST_CATEGORIES] ?? t.category}</span>
                          <span className="text-muted">{BASIS[t.basis]}{t.confidence !== null && !t.confirmed ? `・信頼度${Math.round(t.confidence * 100)}%` : ""}{t.evidence ? `・${t.evidence}` : ""}</span>
                          {!t.confirmed && (
                            <form action={updateTag} className="inline"><input type="hidden" name="tag_id" value={t.id} /><input type="hidden" name="op" value="confirm" /><button className="text-leaf underline">確認</button></form>
                          )}
                          <form action={updateTag} className="inline"><input type="hidden" name="tag_id" value={t.id} /><input type="hidden" name="op" value="delete" /><button className="text-warn underline" aria-label="タグを外す">外す</button></form>
                        </span>
                      ))}
                      <form action={addTag} className="inline-flex items-center gap-1">
                        <input type="hidden" name="person_id" value={p.id} />
                        <select name="category" className="rounded border border-line px-1 py-0.5 text-xs"><Options map={INTEREST_CATEGORIES} /></select>
                        <input name="evidence" placeholder="根拠（例: 本人と面識）" className="w-36 rounded border border-line px-1 py-0.5 text-xs" />
                        <button className="text-xs underline">追加</button>
                      </form>
                    </div>
                  </li>
                ))}
              </ul>
            </Disclosure>
          </div>
        )}
      </Card>
    </>
  );
}
