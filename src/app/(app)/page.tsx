import Link from "next/link";
import { getContext, type Account, type Ctx } from "@/lib/context";
import { accountMetricsFor, conversionsInRange, followerSeries, initiativesFor, periodsFor, postsFor, metricsFor, type AccMetric } from "@/lib/queries";
import { Badge, Card, Empty, Flash, Note, PageHeader, SourceBadge, Stat, Val } from "@/components/ui";
import { FollowerChart } from "@/components/charts";
import { ACCOUNT_METRICS, ATTRIBUTIONS, CONVERSION_KINDS, STATUSES, CHECKPOINTS } from "@/lib/catalog";
import { safeRate } from "@/lib/analytics";
import { fmtDate, jstDay, weekStart, nowMs } from "@/lib/time";

type SP = { period?: string; ok?: string; err?: string };

export default async function Dashboard({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const ids = ctx.selected.map((a) => a.id);
  const periods = await periodsFor(ctx, ids);
  const sel = sp.period?.split("_");
  const period = sel && sel.length === 2 ? { period_start: sel[0], period_end: sel[1] } : periods[0];

  return (
    <>
      <PageHeader
        title={ctx.view === "both" ? "2アカウント比較" : `ダッシュボード｜${ctx.current.display_name}`}
        sub="同じ期間・同じ定義の数値だけを並べます。取得できていない指標は「未取得」と表示します。"
        actions={<Link href="/metrics" className="btn-ghost">期間の指標を入力</Link>}
      />
      <Flash sp={sp} />
      <NextActions ctx={ctx} />
      {periods.length > 0 && (
        <form className="mb-4 flex flex-wrap items-end gap-2">
          <label className="block">
            <span className="label">期間（指標のある期間から選択）</span>
            <select name="period" defaultValue={period ? `${period.period_start}_${period.period_end}` : ""} className="field w-auto">
              {periods.map((p) => (
                <option key={p.period_start + p.period_end} value={`${p.period_start}_${p.period_end}`}>
                  {fmtDate(p.period_start)} 〜 {fmtDate(p.period_end)}
                </option>
              ))}
            </select>
          </label>
          <button className="btn-ghost">表示</button>
        </form>
      )}
      {!period ? (
        <>
        <LatestFollowers ctx={ctx} />
        <Empty title="期間の指標がまだありません">
          <Link className="underline" href="/metrics">期間の指標を入力</Link>するか、<Link className="underline" href="/import">CSVで取り込み</Link>、または<Link className="underline" href="/settings">公式APIを接続</Link>してください。
        </Empty>
        </>
      ) : ctx.view === "both" ? (
        <CompareTable ctx={ctx} start={period.period_start} end={period.period_end} />
      ) : (
        <AccountPanel ctx={ctx} acc={ctx.current} start={period.period_start} end={period.period_end} />
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <WeekInitiatives ctx={ctx} />
      </div>
    </>
  );
}

function metricCell(m: AccMetric | undefined, unit: "count" | "ratio" = "count") {
  return (
    <span className="inline-flex items-center gap-1.5">
      <Val v={m?.value ?? null} unit={unit} />
      {m && <SourceBadge source={m.source} measurement={m.measurement} />}
    </span>
  );
}

async function AccountPanel({ ctx, acc, start, end }: { ctx: Ctx; acc: Account; start: string; end: string }) {
  const m = await accountMetricsFor(ctx, acc.id, start, end);
  const conv = await conversionsInRange(ctx, acc.id, start, end);
  const series = await followerSeries(ctx, acc.id);
  const reach = m.get("reach");
  const nonF = m.get("reach_non_follower");
  // 非フォロワー割合は、同じ期間・同じ取得元の値どうしでのみ計算
  const nonRatio = reach && nonF && reach.source === nonF.source ? safeRate(nonF.value, reach.value) : null;
  const followers = m.get("followers");
  const byKind = (k: string) => conv.filter((c) => c.kind === k);
  const sum = (rows: typeof conv, f: "n" | "revenue") => rows.reduce((a, r) => a + (r[f] ?? 0), 0);
  const revenueRows = conv.filter((c) => c.revenue !== null);
  const revenueMissing = conv.reduce((a, c) => a + c.revenue_missing, 0);

  return (
    <div className="space-y-4">
      <Card title={`${fmtDate(start)}〜${fmtDate(end)} の指標`} actions={<Link href="/metrics" className="text-xs underline">指標の定義と入力</Link>}>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <Stat label="フォロワー数（期間末）" sub={followers ? <>時点: {fmtDate(followers.period_end)} <SourceBadge source={followers.source} measurement={followers.measurement} /></> : "期間内の記録なし"}>
            <Val v={followers?.value} />
          </Stat>
          <Stat label="フォロワー純増" sub="投稿の効果とは断定しない">{metricCell(m.get("follower_net"))}</Stat>
          <Stat label="リーチ（アカウント全体）" sub="ユニーク。投稿リーチの合計ではない">{metricCell(reach)}</Stat>
          <Stat label="非フォロワーへのリーチ割合" sub={nonRatio === null ? "全体リーチと非フォロワーリーチが同じ取得元で必要" : `${nonF?.value?.toLocaleString("ja-JP")}人`}><Val v={nonRatio} unit="ratio" /></Stat>
          <Stat label="閲覧数">{metricCell(m.get("views"))}</Stat>
          <Stat label="保存">{metricCell(m.get("saves"))}</Stat>
          <Stat label="シェア">{metricCell(m.get("shares"))}</Stat>
          <Stat label="コメント">{metricCell(m.get("comments"))}</Stat>
          <Stat label="プロフィール訪問">{metricCell(m.get("profile_visits"))}</Stat>
          <Stat label="リンクタップ">{metricCell(m.get("link_taps"))}</Stat>
          <Stat label="LINE登録">{metricCell(m.get("line_signups"))}</Stat>
          <Stat label="問い合わせ（記録件数）" href="/funnel" sub={`うち計測できた成果 ${sum(byKind("inquiry").filter((c) => c.attribution === "measured"), "n")}件`}><Val v={sum(byKind("inquiry"), "n")} /></Stat>
          <Stat label="購入（記録件数）" href="/funnel" sub={`うち計測できた成果 ${sum(byKind("purchase").filter((c) => c.attribution === "measured"), "n")}件`}><Val v={sum(byKind("purchase"), "n")} /></Stat>
          <Stat label="売上（記録分）" href="/funnel" sub={revenueMissing ? `売上未入力 ${revenueMissing}件あり` : "経路の内訳は導線画面"}>
            <Val v={revenueRows.length ? sum(revenueRows, "revenue") : null} unit="yen" missing="記録なし" />
          </Stat>
        </div>
        {conv.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
            {conv.map((c) => (
              <Badge key={c.kind + c.attribution} t={c.attribution === "measured" ? "green" : c.attribution === "self_reported" ? "gold" : "gray"}>
                {CONVERSION_KINDS[c.kind as keyof typeof CONVERSION_KINDS]}・{ATTRIBUTIONS[c.attribution as keyof typeof ATTRIBUTIONS]} {c.n}件
              </Badge>
            ))}
          </div>
        )}
      </Card>
      <Card title="フォロワー数の推移" actions={acc.follower_target ? <span className="text-xs text-muted">目標 {acc.follower_target.toLocaleString("ja-JP")}人（破線）。売上・粗利・継続購入・運営負担と合わせて見る</span> : null}>
        <FollowerChart data={series.map((s) => ({ day: s.day, value: s.value }))} target={acc.follower_target} />
        {acc.follower_target && followers?.value ? (
          <p className="mt-2 text-xs text-muted">目標まで {Math.max(0, acc.follower_target - followers.value).toLocaleString("ja-JP")}人（期間末時点）。フォロワー数だけで施策の良し悪しを判断しない。</p>
        ) : null}
      </Card>
    </div>
  );
}

async function CompareTable({ ctx, start, end }: { ctx: Ctx; start: string; end: string }) {
  const maps = await Promise.all(ctx.accounts.map((a) => accountMetricsFor(ctx, a.id, start, end)));
  return (
    <Card title={`${fmtDate(start)}〜${fmtDate(end)}｜同じ期間で比較`}>
      <Note>両アカウントとも同じ期間・同じ指標定義の値だけを並べています。片方しかない値は「未取得」です。取得元（実測/手入力）が違う場合はバッジで確認してください。</Note>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="py-2 pr-2 font-medium">指標</th>
              {ctx.accounts.map((a) => <th key={a.id} className="py-2 pr-2 font-medium">{a.display_name}</th>)}
            </tr>
          </thead>
          <tbody>
            {ACCOUNT_METRICS.map((def) => (
              <tr key={def.key} className="border-b border-line/60">
                <td className="py-2 pr-2" title={def.definition}>{def.label}</td>
                {maps.map((m, i) => <td key={i} className="py-2 pr-2">{metricCell(m.get(def.key))}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

async function WeekInitiatives({ ctx }: { ctx: Ctx }) {
  const ws = weekStart(jstDay());
  const all = await initiativesFor(ctx, ctx.selected.map((a) => a.id));
  const thisWeek = all.filter((i) => i.planned_week === ws && (i.status === "idea" || i.status === "producing"));
  const waiting = all.filter((i) => i.status === "posted" || i.status === "measuring");
  const list = (items: typeof all, empty: string) =>
    items.length ? (
      <ul className="space-y-2">
        {items.map((i) => (
          <li key={i.id}>
            <Link href={`/initiatives/${i.id}`} className="flex items-center justify-between gap-2 rounded-md border border-line bg-white px-3 py-2 text-sm hover:bg-paper">
              <span className="truncate">{i.title}</span>
              <Badge t={i.status === "measuring" ? "gold" : "gray"}>{STATUSES[i.status as keyof typeof STATUSES]}</Badge>
            </Link>
          </li>
        ))}
      </ul>
    ) : <p className="text-sm text-muted">{empty}</p>;
  return (
    <>
      <Card title="今週実行する施策" actions={<Link href="/initiatives/new" className="text-xs underline">施策をつくる</Link>}>
        {list(thisWeek, "今週の予定はありません。週次レビューで次週の3施策を決めましょう。")}
      </Card>
      <Card title="検証待ちの施策" actions={<Link href="/board" className="text-xs underline">検証ボード</Link>}>
        {list(waiting, "検証待ちの施策はありません。")}
      </Card>
    </>
  );
}

/** 次にやること（入力漏れ・計測時期の到来） */
async function NextActions({ ctx }: { ctx: Ctx }) {
  const items: { text: string; href: string }[] = [];
  const now = nowMs();
  for (const acc of ctx.selected) {
    const [posts, metrics] = await Promise.all([postsFor(ctx, acc.id), metricsFor(ctx, acc.id)]);
    for (const p of posts.slice(0, 30)) {
      const age = (now - new Date(p.posted_at).getTime()) / 3600000;
      for (const cp of ["24h", "72h", "7d"] as const) {
        const h = CHECKPOINTS[cp].hours!;
        if (age >= h && age <= h * 1.25 + 12 && !metrics.some((m) => m.post_id === p.id && m.checkpoint === cp)) {
          items.push({ text: `${acc.display_name}: ${fmtDate(p.posted_at)}の投稿の「${CHECKPOINTS[cp].label}」の数値を記録する時期です`, href: `/posts/${p.id}#snapshot` });
        }
      }
    }
    if (posts.length === 0) items.push({ text: `${acc.display_name}: 投稿がまだ登録されていません`, href: "/posts/new" });
  }
  const inis = await initiativesFor(ctx, ctx.selected.map((a) => a.id));
  for (const i of inis.filter((x) => x.status === "measuring" && now - new Date(x.updated_at).getTime() > 7 * 86400000)) {
    items.push({ text: `「${i.title}」の計測開始から7日以上たちました。振り返りを記録しましょう`, href: `/initiatives/${i.id}#review` });
  }
  if (!items.length) return null;
  return (
    <Card title="次にやること" className="mb-4 border-leaf/30">
      <ul className="space-y-1.5 text-sm">
        {items.slice(0, 6).map((it, i) => (
          <li key={i}><Link href={it.href} className="underline decoration-line underline-offset-4 hover:decoration-leaf">{it.text}</Link></li>
        ))}
      </ul>
      {items.length > 6 && <p className="mt-2 text-xs text-muted">ほか{items.length - 6}件</p>}
    </Card>
  );
}

/** 期間の指標がまだ無いときでも、記録済みの最新フォロワー数とその推移は表示する */
async function LatestFollowers({ ctx }: { ctx: Ctx }) {
  const items = await Promise.all(ctx.selected.map(async (acc) => ({ acc, series: await followerSeries(ctx, acc.id) })));
  if (!items.some((i) => i.series.length)) return null;
  return (
    <div className="mb-4 grid gap-4 lg:grid-cols-2">
      {items.map(({ acc, series }) => {
        const last = series[series.length - 1];
        return (
          <Card key={acc.id} title={`${acc.display_name}のフォロワー数`}>
            {last ? (
              <>
                <div className="text-2xl font-bold"><Val v={last.value} />人</div>
                <div className="mt-1 text-xs text-muted">時点: {fmtDate(last.day)} <SourceBadge source={last.source} measurement={last.source === "api" ? "measured" : "manual"} />{acc.follower_target ? `・目標 ${acc.follower_target.toLocaleString("ja-JP")}人` : ""}</div>
                <div className="mt-3"><FollowerChart data={series.map((s) => ({ day: s.day, value: s.value }))} target={acc.follower_target} /></div>
              </>
            ) : <p className="text-sm text-muted">まだ記録がありません。</p>}
          </Card>
        );
      })}
    </div>
  );
}
