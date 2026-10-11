import Link from "next/link";
import { getContext } from "@/lib/context";
import { initiativesFor } from "@/lib/queries";
import { moveInitiative } from "@/app/actions";
import { Badge, Flash, Note, PageHeader } from "@/components/ui";
import { Submit } from "@/components/client";
import { DECISIONS, STATUSES, TEST_VARIABLES, FORMATS } from "@/lib/catalog";
import { fmtDate } from "@/lib/time";

export default async function Board({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const all = await initiativesFor(ctx, ctx.selected.map((a) => a.id));
  const name = (id: string) => ctx.accounts.find((a) => a.id === id)?.display_name;
  const statuses = Object.keys(STATUSES) as (keyof typeof STATUSES)[];
  return (
    <>
      <PageHeader title="施策検証ボード" sub="アイデア → 制作中 → 投稿済み → 計測中 → 振り返り済み" actions={<Link href="/initiatives/new" className="btn">施策をつくる</Link>} />
      <Flash sp={sp} />
      <p className="mb-2 text-xs text-muted md:hidden">{statuses.map((s) => `${STATUSES[s]} ${all.filter((i) => i.status === s).length}`).join("・")}（空の列は省略）</p>
      <div className="mb-4"><Note>自然投稿どうしの比較は「比較検証」です（ランダム化したA/Bテストではありません）。1回の検証で変える点は原則1つ。単発の結果で勝ちパターンを決めません。</Note></div>
      <div className="grid gap-3 md:grid-cols-5">
        {statuses.map((st) => {
          const items = all.filter((i) => i.status === st);
          return (
            <section key={st} className={`rounded-lg border border-line bg-white/60 p-2 ${items.length === 0 ? "hidden md:block" : ""}`}>
              <h2 className="mb-2 flex items-center justify-between px-1 text-sm font-bold">{STATUSES[st]}<span className="text-xs font-normal text-muted">{items.length}</span></h2>
              <div className="space-y-2">
                {items.length === 0 && <p className="px-1 py-2 text-xs text-muted">なし</p>}
                {items.map((i) => {
                  const idx = statuses.indexOf(st);
                  const next = statuses[idx + 1];
                  return (
                    <article key={i.id} className="rounded-md border border-line bg-white p-2.5 text-sm shadow-sm">
                      <Link href={`/initiatives/${i.id}`} className="font-semibold leading-snug hover:underline">{i.title}</Link>
                      <div className="mt-1.5 flex flex-wrap gap-1">
                        {ctx.view === "both" && <Badge>{name(i.account_id)}</Badge>}
                        {i.format && <Badge>{FORMATS[i.format as keyof typeof FORMATS]}</Badge>}
                        {i.test_variable && <Badge t="gold">変更点: {TEST_VARIABLES[i.test_variable as keyof typeof TEST_VARIABLES]}</Badge>}
                        <Badge>{i.comparison_kind === "randomized" ? "ランダム化比較" : "比較検証"}</Badge>
                        {i.generated_by === "ai" ? <Badge t="green">AI案</Badge> : i.generated_by === "rule" ? <Badge>ルール案</Badge> : null}
                        {i.decision && <Badge t={i.decision === "continue" ? "green" : i.decision === "stop" ? "red" : "gold"}>{DECISIONS[i.decision as keyof typeof DECISIONS]}</Badge>}
                      </div>
                      {i.planned_week && st !== "reviewed" && <div className="mt-1 text-[11px] text-muted">予定週: {fmtDate(i.planned_week)}〜</div>}
                      <form action={moveInitiative} className="mt-2 flex gap-1">
                        <input type="hidden" name="id" value={i.id} />
                        <select name="status" defaultValue={next ?? st} className="min-w-0 flex-1 rounded border border-line px-1 py-1 text-xs" aria-label="移動先">
                          {statuses.map((s) => <option key={s} value={s}>{STATUSES[s]}</option>)}
                        </select>
                        <Submit className="btn-ghost px-2 py-1 text-xs" pendingText="…">移動</Submit>
                      </form>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
