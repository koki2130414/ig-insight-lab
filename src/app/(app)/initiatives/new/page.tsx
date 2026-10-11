import Link from "next/link";
import { getContext, requireOwned, type Account } from "@/lib/context";
import { comparisonFor, targetsFor, type PostRow } from "@/lib/queries";
import { createInitiative } from "@/app/actions";
import { Badge, Card, Field, Flash, Note, Options, PageHeader } from "@/components/ui";
import { Submit } from "@/components/client";
import { CHECKPOINTS, FORMATS, PURPOSES, TEST_VARIABLES, type Format, type Purpose } from "@/lib/catalog";
import { aiConnected, buildAiPayload, generateRuleBased, rateLabel, type GenInput } from "@/lib/generator";
import { fmtDateTime } from "@/lib/time";

type SP = { base?: string; cp?: string; target?: string; purpose?: string; minutes?: string; materials?: string; variable?: string; theme?: string; ok?: string; err?: string; go?: string };

export default async function NewInitiative({ searchParams }: { searchParams: Promise<SP> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  let acc: Account = ctx.current;
  let base: PostRow | null = null;
  if (sp.base) {
    try {
      acc = await requireOwned(ctx, "posts", sp.base);
      [base] = await ctx.db.query<PostRow>(`SELECT * FROM posts WHERE id=$1`, [sp.base]);
    } catch {
      base = null;
    }
  }
  const targets = await targetsFor(ctx, acc.id);
  const target = targets.find((t) => t.id === sp.target) ?? null;
  const cp = sp.cp === "24h" || sp.cp === "7d" ? sp.cp : "72h";
  const purpose = (sp.purpose && sp.purpose in PURPOSES ? sp.purpose : base?.purpose ?? (acc.kind === "farm" ? "trust" : "relationship")) as Purpose;

  let baseline: GenInput["baseline"] = null;
  if (base) {
    const c = await comparisonFor(ctx, base, { checkpoint: cp, samePurpose: false, excludeAds: true, excludeDrift: true });
    const pick = (f: "median" | "value") => Object.fromEntries(c.stats.map((s) => [s.key, s[f]]));
    baseline = {
      postLabel: `${fmtDateTime(base.posted_at)}の投稿「${(base.hook || base.theme || "").slice(0, 30)}」`,
      format: base.format as Format,
      checkpoint: CHECKPOINTS[cp].label, n: c.peers.length, medians: pick("median"), values: pick("value"), hook: base.hook,
    };
  }

  const input: GenInput = {
    accountKind: acc.kind, accountName: acc.display_name,
    target: target ? { name: target.name, needs: target.needs, value_prop: target.value_prop, themes: target.themes, desired_action: target.desired_action } : null,
    purpose, materials: sp.materials ?? "", minutes: sp.minutes ? Number(sp.minutes) || null : 90,
    testVariable: sp.variable && sp.variable in TEST_VARIABLES ? (sp.variable as GenInput["testVariable"]) : null,
    theme: sp.theme || base?.theme || null, baseline,
  };
  const draft = sp.go ? generateRuleBased(input) : null;
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && !["ok", "err"].includes(k)) as [string, string][]).toString();
  const ai = aiConnected();

  const hidden = (
    <>
      <input type="hidden" name="account_id" value={acc.id} />
      <input type="hidden" name="purpose" value={purpose} />
      <input type="hidden" name="target_id" value={target?.id ?? ""} />
      <input type="hidden" name="materials" value={input.materials} />
      <input type="hidden" name="minutes" value={input.minutes ?? ""} />
      <input type="hidden" name="variable" value={input.testVariable ?? ""} />
      <input type="hidden" name="theme" value={input.theme ?? ""} />
      <input type="hidden" name="base_post_id" value={base?.id ?? ""} />
      <input type="hidden" name="baseline" value={baseline ? JSON.stringify(baseline) : ""} />
      <input type="hidden" name="qs" value={qs} />
    </>
  );

  return (
    <>
      <PageHeader title={`施策をつくる｜${acc.display_name}`} sub="条件を選ぶと施策案を作ります。事実（データ）・仮説・提案を分けて表示します。" />
      <Flash sp={sp} />
      <div className="grid gap-4 xl:grid-cols-[380px_1fr]">
        <Card title="1. 条件">
          <form className="space-y-3">
            <input type="hidden" name="go" value="1" />
            {base && <input type="hidden" name="base" value={base.id} />}
            {base ? (
              <Note t="green">比較元: <Link href={`/posts/${base.id}`} className="underline">{baseline?.postLabel}</Link>（{FORMATS[base.format as keyof typeof FORMATS]}）</Note>
            ) : (
              <Note>投稿の詳細画面の「この比較から施策を作る」から始めると、同条件の投稿との比較を根拠に使えます。</Note>
            )}
            {base && (
              <Field label="比較する時点">
                <select name="cp" defaultValue={cp} className="field">{(["24h", "72h", "7d"] as const).map((c) => <option key={c} value={c}>{CHECKPOINTS[c].label}</option>)}</select>
              </Field>
            )}
            <Field label="対象層">
              <select name="target" defaultValue={target?.id ?? ""} className="field">
                <option value="">未選択</option>
                {targets.map((t) => <option key={t.id} value={t.id}>{t.layer === "desired" ? "届けたい層: " : "現在の層: "}{t.name}</option>)}
              </select>
            </Field>
            <Field label="目的"><select name="purpose" defaultValue={purpose} className="field"><Options map={PURPOSES} /></select></Field>
            <Field label="テーマ" hint={acc.kind === "farm" ? "例: 若者が家業を継ぐ挑戦／父との農作業／米づくりの裏側／生産者が伝える米の選び方／収穫から食卓まで／農業体験／直販や地域連携の試行錯誤" : undefined}>
              <input name="theme" defaultValue={input.theme ?? ""} className="field" />
            </Field>
            <Field label="使える素材"><textarea name="materials" rows={2} defaultValue={input.materials} className="field" placeholder="例: 稲刈りの縦動画、父の手元のアップ" /></Field>
            <Field label="制作に使える時間（分）"><input name="minutes" inputMode="numeric" defaultValue={input.minutes ?? ""} className="field num" /></Field>
            <Field label="今回変える点（1つ）" hint="主な変更点は1回の検証で1つにします">
              <select name="variable" defaultValue={input.testVariable ?? ""} className="field"><Options map={TEST_VARIABLES} empty="決めない" /></select>
            </Field>
            <button className="btn w-full">施策案を表示</button>
          </form>
        </Card>

        <div className="space-y-4">
          {!draft ? (
            <Card title="2. 施策案"><p className="text-sm text-muted">左の条件を選んで「施策案を表示」を押してください。</p></Card>
          ) : (
            <>
              <Card title="2. 施策案（ルールベース）" actions={<Badge>{ai ? "ルールベース" : "AI未接続・ルールベース"}</Badge>}>
                <div className="space-y-3 text-sm">
                  <section>
                    <h3 className="mb-1 text-xs font-bold text-leaf">事実（データ）</h3>
                    {draft.facts.length ? <ul className="list-disc pl-5">{draft.facts.map((f, i) => <li key={i}>{f}</li>)}</ul> : <p className="text-muted">参照できるデータがありません。</p>}
                  </section>
                  {draft.data_gaps.length > 0 && (
                    <section>
                      <h3 className="mb-1 text-xs font-bold text-warn">不足しているデータ</h3>
                      <ul className="list-disc pl-5">{draft.data_gaps.map((f, i) => <li key={i}>{f}</li>)}</ul>
                    </section>
                  )}
                  <section><h3 className="mb-1 text-xs font-bold text-rice">仮説</h3><p>{draft.hypothesis}</p></section>
                  <section>
                    <h3 className="mb-1 text-xs font-bold">提案</h3>
                    <dl className="grid gap-x-3 gap-y-1.5 sm:grid-cols-[8rem_1fr]">
                      <dt className="text-muted">タイトル</dt><dd>{draft.title}</dd>
                      <dt className="text-muted">対象層</dt><dd>{draft.target}</dd>
                      <dt className="text-muted">投稿形式</dt><dd>{FORMATS[draft.format]}</dd>
                      <dt className="text-muted">冒頭のフック</dt><dd><ol className="list-decimal pl-5">{draft.hooks.map((h, i) => <li key={i}>{h}</li>)}</ol></dd>
                      <dt className="text-muted">台本・構成</dt><dd className="prose-pre">{draft.script}</dd>
                      <dt className="text-muted">撮影素材</dt><dd>{draft.materials}</dd>
                      <dt className="text-muted">投稿文・CTA</dt><dd>{draft.caption}<br />CTA: {draft.cta}</dd>
                      <dt className="text-muted">期待する行動</dt><dd>{draft.expected_action}</dd>
                      <dt className="text-muted">主指標</dt><dd>{rateLabel(draft.primary_metric)}</dd>
                      <dt className="text-muted">成功条件</dt><dd>{draft.success_criteria}</dd>
                      <dt className="text-muted">中止条件</dt><dd>{draft.stop_criteria}</dd>
                      <dt className="text-muted">制作時間・費用</dt><dd>約{draft.est_minutes}分・¥{draft.est_cost.toLocaleString("ja-JP")}</dd>
                      <dt className="text-muted">リスク</dt><dd>{draft.risks}</dd>
                      <dt className="text-muted">次の検証案</dt><dd>{draft.next_test}</dd>
                    </dl>
                  </section>
                </div>
                <form action={createInitiative} className="mt-4">
                  {hidden}
                  <input type="hidden" name="mode" value="rule" />
                  <Submit>この案を検証ボードに追加</Submit>
                </form>
              </Card>

              <Card title="AIで施策案を作る" actions={<Badge t={ai ? "green" : "gray"}>{ai ? "AI接続済み" : "AI未接続"}</Badge>}>
                {ai ? (
                  <form action={createInitiative} className="space-y-3">
                    {hidden}
                    <input type="hidden" name="mode" value="ai" />
                    <p className="text-sm">次の内容だけをAI（Anthropic API）に送ります。個人のプロフィールやオーディエンスの個人データは送りません。</p>
                    <pre className="max-h-64 overflow-auto rounded-md bg-paper p-3 text-[11px]">{JSON.stringify(buildAiPayload(input), null, 2)}</pre>
                    <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="consent" value="1" required /> 上の内容を送信することに同意します</label>
                    <Submit pendingText="生成中…">AIで作成して追加</Submit>
                  </form>
                ) : (
                  <p className="text-sm text-muted">ANTHROPIC_API_KEY を設定すると利用できます。未接続の間は上のルールベース案を使います（AI生成ではありません）。</p>
                )}
              </Card>
            </>
          )}
        </div>
      </div>
    </>
  );
}
