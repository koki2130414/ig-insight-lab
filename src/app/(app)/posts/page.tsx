import Link from "next/link";
import { getContext } from "@/lib/context";
import { metricsFor, postsFor } from "@/lib/queries";
import { Badge, Card, Empty, Flash, Note, Options, PageHeader, SourceBadge, Val } from "@/components/ui";
import { CHECKPOINTS, FORMATS, POST_RATES, PURPOSES, type Checkpoint } from "@/lib/catalog";
import { checkpointDrift, ratesFor, summarize } from "@/lib/analytics";
import { fmtDateTime } from "@/lib/time";

type SP = { cp?: string; format?: string; purpose?: string; ads?: string; ok?: string; err?: string };

export default async function PostsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const acc = ctx.current;
  const cp: Exclude<Checkpoint, "other"> = sp.cp === "24h" || sp.cp === "7d" ? sp.cp : "72h";
  const excludeAds = sp.ads !== "include";
  const [posts, metrics] = await Promise.all([postsFor(ctx, acc.id), metricsFor(ctx, acc.id)]);
  const filtered = posts.filter((p) => (!sp.format || p.format === sp.format) && (!sp.purpose || p.purpose === sp.purpose));
  const at = new Map(metrics.filter((m) => m.checkpoint === cp).map((m) => [m.post_id, m]));

  // 形式ごとの集計（同じ時点・広告/プレゼント除外を選択可）
  const groups = Object.keys(FORMATS).map((f) => {
    const ps = filtered.filter((p) => p.format === f && (!excludeAds || !(p.is_ad || p.is_giveaway)));
    const ms = ps.map((p) => at.get(p.id)).filter((m): m is NonNullable<typeof m> => !!m && checkpointDrift(cp, m.hours_since_post) !== "drift");
    const withRates = ms.map((m) => ({ ...m, ...ratesFor(m) }));
    return {
      format: f, posts: ps.length, measured: ms.length,
      reach: summarize(ms.map((m) => m.reach)),
      rates: POST_RATES.map((r) => ({ ...r, s: summarize(withRates.map((m) => (m as unknown as Record<string, number | null>)[r.key])) })),
    };
  }).filter((g) => g.posts > 0);

  return (
    <>
      <PageHeader
        title={`投稿と比較｜${acc.display_name}`}
        sub="同じ形式・同じ投稿後経過時間の投稿どうしで比べます。平均だけでなく中央値と件数を表示します。"
        actions={<><Link href="/posts/new" className="btn">投稿を登録</Link><Link href="/import" className="btn-ghost">CSV取り込み</Link></>}
      />
      <Flash sp={sp} />
      {ctx.view === "both" && <div className="mb-3"><Note t="gold">2アカウント比較モードでは個人アカウントを表示しています。農園を見るには上部で「農園」を選んでください。</Note></div>}
      <form className="mb-4 flex flex-wrap items-end gap-2 text-sm">
        <label><span className="label">比較する時点</span>
          <select name="cp" defaultValue={cp} className="field w-auto">
            {(["24h", "72h", "7d"] as const).map((c) => <option key={c} value={c}>{CHECKPOINTS[c].label}</option>)}
          </select>
        </label>
        <label><span className="label">形式</span><select name="format" defaultValue={sp.format ?? ""} className="field w-auto"><Options map={FORMATS} empty="すべて" /></select></label>
        <label><span className="label">目的</span><select name="purpose" defaultValue={sp.purpose ?? ""} className="field w-auto"><Options map={PURPOSES} empty="すべて" /></select></label>
        <label><span className="label">広告・プレゼント企画</span>
          <select name="ads" defaultValue={excludeAds ? "exclude" : "include"} className="field w-auto"><option value="exclude">集計から除外</option><option value="include">含める</option></select>
        </label>
        <button className="btn-ghost">絞り込む</button>
      </form>

      {groups.length > 0 && (
        <Card title={`形式別の基準値（${CHECKPOINTS[cp].label}）`} className="mb-4">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead><tr className="border-b border-line text-left text-xs text-muted"><th className="py-2">形式</th><th>件数</th><th>リーチ 中央値 / 平均</th>{POST_RATES.slice(0, 4).map((r) => <th key={r.key} title={r.definition}>{r.label} 中央値 / 平均</th>)}</tr></thead>
              <tbody>
                {groups.map((g) => (
                  <tr key={g.format} className="border-b border-line/60">
                    <td className="py-2 font-medium">{FORMATS[g.format as keyof typeof FORMATS]}</td>
                    <td className="num">{g.measured}/{g.posts}件</td>
                    <td><Val v={g.reach.median} /> / <Val v={g.reach.mean} /></td>
                    {g.rates.slice(0, 4).map((r) => (
                      <td key={r.key}><Val v={r.s.median} unit="ratio" /> / <Val v={r.s.mean} unit="ratio" /><span className="ml-1 text-[11px] text-muted">n={r.s.n}</span></td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[12px] text-muted">件数「計測済み/全体」。経過時間が時点から25%以上ずれた記録は除外。n は率を計算できた件数（分母のリーチが無い・0の投稿は含めない）。</p>
        </Card>
      )}

      {filtered.length === 0 ? (
        <Empty title="投稿がありません"><Link className="underline" href="/posts/new">投稿を登録</Link>するか、<Link className="underline" href="/import">CSVで取り込み</Link>してください。</Empty>
      ) : (
        <Card title={`投稿一覧（${filtered.length}件）`}>
          <ul className="divide-y divide-line">
            {filtered.map((p) => {
              const m = at.get(p.id);
              const r = m ? ratesFor(m) : null;
              return (
                <li key={p.id}>
                  <Link href={`/posts/${p.id}`} className="flex flex-col gap-1 py-3 hover:bg-paper/60 sm:flex-row sm:items-center sm:justify-between">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted">
                        <span>{fmtDateTime(p.posted_at)}</span>
                        <Badge>{FORMATS[p.format as keyof typeof FORMATS]}</Badge>
                        {p.purpose && <Badge t="green">{PURPOSES[p.purpose as keyof typeof PURPOSES]}</Badge>}
                        {(p.is_ad || p.is_giveaway) && <Badge t="gold">{p.is_ad ? "広告" : "プレゼント企画"}</Badge>}
                        {p.collaborator && <Badge t="gold">コラボ</Badge>}
                        {p.source === "demo" && <Badge t="demo">デモ</Badge>}
                      </div>
                      <div className="mt-0.5 truncate text-sm font-medium">{p.hook || p.theme || p.caption?.slice(0, 40) || p.url || "（内容未入力）"}</div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center gap-3 text-xs">
                      {m ? (
                        <>
                          <span>リーチ <Val v={m.reach} /></span>
                          <span>保存率 <Val v={r!.save_rate} unit="ratio" /></span>
                          <span>シェア率 <Val v={r!.share_rate} unit="ratio" /></span>
                          <SourceBadge source={m.source} measurement={m.measurement} />
                        </>
                      ) : <span className="text-muted">{CHECKPOINTS[cp].label}の記録なし</span>}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </>
  );
}
