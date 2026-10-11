import Link from "next/link";
import { getContext } from "@/lib/context";
import { targetsFor, type Target } from "@/lib/queries";
import { deleteTarget, saveTarget } from "@/app/actions";
import { Badge, Card, Field, Flash, Note, PageHeader } from "@/components/ui";
import { Disclosure, Submit } from "@/components/client";

const CHANNELS: Record<string, string> = { content: "投稿内容", collab: "コラボ", funnel: "導線（プロフィール・リンク・LINE）", ads: "広告（配信先を指定できるのは広告のみ）" };

function TargetForm({ accountId, t, layer }: { accountId: string; t?: Target; layer: "current" | "desired" }) {
  return (
    <form action={saveTarget} className="space-y-3">
      <input type="hidden" name="account_id" value={accountId} />
      {t && <input type="hidden" name="id" value={t.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="層の名前*"><input name="name" defaultValue={t?.name ?? ""} required className="field" /></Field>
        <Field label="区分">
          <select name="layer" defaultValue={t?.layer ?? layer} className="field"><option value="desired">届けたい層（仮説）</option><option value="current">現在の層（データで確認）</option></select>
        </Field>
        <Field label="ニーズ"><textarea name="needs" rows={2} defaultValue={t?.needs ?? ""} className="field" /></Field>
        <Field label="届ける価値"><textarea name="value_prop" rows={2} defaultValue={t?.value_prop ?? ""} className="field" /></Field>
        <Field label="投稿テーマ"><textarea name="themes" rows={2} defaultValue={t?.themes ?? ""} className="field" placeholder="、区切り" /></Field>
        <Field label="行動してほしいこと"><textarea name="desired_action" rows={2} defaultValue={t?.desired_action ?? ""} className="field" /></Field>
        <Field label="収益・協業への接続"><textarea name="monetization" rows={2} defaultValue={t?.monetization ?? ""} className="field" /></Field>
        <Field label="仮説を確かめる方法"><textarea name="validation_method" rows={2} defaultValue={t?.validation_method ?? ""} className="field" /></Field>
        <Field label="優先順位（1が最優先）"><input name="priority" inputMode="numeric" defaultValue={t?.priority ?? ""} className="field num" /></Field>
        <Field label="根拠（現在の層は必須）" hint="例: 9月の購入者アンケート12件、オーディエンス集計（地域）"><input name="evidence" defaultValue={t?.evidence ?? ""} className="field" /></Field>
      </div>
      <fieldset>
        <legend className="label">届け方（手段を区別）</legend>
        <div className="flex flex-wrap gap-3 text-sm">
          {Object.entries(CHANNELS).map(([k, v]) => (
            <label key={k} className="flex items-center gap-1.5"><input type="checkbox" name="channels" value={k} defaultChecked={t?.channels?.includes(k)} />{v}</label>
          ))}
        </div>
      </fieldset>
      <input type="hidden" name="is_hypothesis" value={t?.is_hypothesis === false ? "0" : "1"} />
      <Submit>{t ? "保存" : "追加"}</Submit>
    </form>
  );
}

function TargetCard({ t, accountId }: { t: Target; accountId: string }) {
  return (
    <div className="rounded-md border border-line bg-white p-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {t.priority && <Badge t="green">優先{t.priority}</Badge>}
        <span className="font-bold">{t.name}</span>
        {t.layer === "desired" ? <Badge t="gold">仮説</Badge> : <Badge t="green">データで確認</Badge>}
      </div>
      <dl className="mt-2 grid gap-x-3 gap-y-1 text-[13px] sm:grid-cols-[7rem_1fr]">
        {([["ニーズ", t.needs], ["届ける価値", t.value_prop], ["投稿テーマ", t.themes], ["行動してほしいこと", t.desired_action], ["収益・協業", t.monetization], ["確かめる方法", t.validation_method], ["根拠", t.evidence]] as const)
          .filter(([, v]) => v)
          .map(([k, v]) => <div key={k} className="contents"><dt className="text-muted">{k}</dt><dd>{v}</dd></div>)}
        {t.channels?.length > 0 && <><dt className="text-muted">届け方</dt><dd>{t.channels.map((c) => CHANNELS[c]?.split("（")[0]).join("・")}</dd></>}
      </dl>
      <div className="mt-2 flex flex-wrap gap-2">
        <Link href={`/initiatives/new?target=${t.id}`} className="text-xs underline">この層向けの施策をつくる</Link>
      </div>
      <div className="mt-2">
        <Disclosure summary="編集">
          <TargetForm accountId={accountId} t={t} layer={t.layer as "current" | "desired"} />
          <form action={deleteTarget} className="mt-3 text-right">
            <input type="hidden" name="id" value={t.id} />
            <Submit className="text-xs text-warn underline" confirm="このターゲットを削除しますか？" pendingText="削除中">削除</Submit>
          </form>
        </Disclosure>
      </div>
    </div>
  );
}

export default async function TargetsPage({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const acc = ctx.current;
  const targets = await targetsFor(ctx, acc.id);
  const current = targets.filter((t) => t.layer === "current");
  const desired = targets.filter((t) => t.layer === "desired");
  return (
    <>
      <PageHeader title={`ターゲット設計｜${acc.display_name}`} sub="「現在の層」はデータで確認できたもの、「届けたい層」は編集可能な仮説です。" />
      <Flash sp={sp} />
      <div className="mb-4 space-y-2">
        <Note>アカウントの役割（仮説）: {acc.roles.join(" ／ ")}　<Link href="/settings" className="underline">編集</Link></Note>
        <Note t="gold">自然投稿では、配信する相手を直接指定できません。届けたい層へは「投稿内容」「コラボ」「導線」で近づけ、配信先を指定できるのは広告のみです。</Note>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title={`現在の層（${current.length}）`}>
          <div className="space-y-3">
            {current.length === 0 && (
              <p className="text-sm text-muted">
                まだ登録がありません。<Link href="/audience" className="underline">オーディエンス分析</Link>やアンケートで確認できたことを、根拠つきで登録してください。
              </p>
            )}
            {current.map((t) => <TargetCard key={t.id} t={t} accountId={acc.id} />)}
            <Disclosure summary="現在の層を追加"><TargetForm accountId={acc.id} layer="current" /></Disclosure>
          </div>
        </Card>
        <Card title={`届けたい層（仮説 ${desired.length}）`}>
          <div className="space-y-3">
            {desired.map((t) => <TargetCard key={t.id} t={t} accountId={acc.id} />)}
            <Disclosure summary="届けたい層を追加"><TargetForm accountId={acc.id} layer="desired" /></Disclosure>
          </div>
        </Card>
      </div>
    </>
  );
}
