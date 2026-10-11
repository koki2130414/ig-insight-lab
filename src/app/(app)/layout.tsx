import { getContext, authEnabled } from "@/lib/context";
import { setDataset, setView, logout } from "@/app/actions";
import { Nav } from "@/components/client";
import { aiConnected } from "@/lib/generator";
import { after } from "next/server";
import { STALE_MS, syncConnected } from "@/lib/instagram/auto";

// 画面表示後の裏での同期（after）に使える時間
export const maxDuration = 300;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  const demo = ctx.dataset === "demo";
  if (!demo) {
    // 前回の同期から1時間以上たっていれば、画面を返した後に裏で同期する（表示は待たせない）
    const { db, userId } = ctx;
    after(() => syncConnected(db, { staleMs: STALE_MS, userId }).catch(() => undefined));
  }
  const views = [
    { v: "personal", label: "個人 @_ko_213" },
    { v: "farm", label: "農園 @213nouen" },
    { v: "both", label: "2アカウント比較" },
  ];
  return (
    <div className="min-h-dvh">
      {demo && (
        <div className="sticky top-0 z-30 border-b border-demo/30 bg-demo-soft px-4 py-1.5 text-center text-[13px] font-semibold text-demo" role="status">
          デモデータを表示中（架空の数値です。実データとは混ざりません）
        </div>
      )}
      <header className="border-b border-line bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-2 px-4 py-2.5">
          <div className="flex items-baseline gap-2">
            <span className="text-[15px] font-bold tracking-tight">IG Insight Lab</span>
            <span className="hidden text-xs text-muted sm:inline">人に寄り添い、夢への一歩を支える</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <form action={setView} className="flex overflow-hidden rounded-md border border-line text-xs">
              {views.map((x) => (
                <button key={x.v} name="view" value={x.v} className={`px-2.5 py-1.5 ${ctx.view === x.v ? "bg-ink text-white" : "bg-white hover:bg-paper"}`}>
                  {x.label}
                </button>
              ))}
            </form>
            <form action={setDataset} className="flex overflow-hidden rounded-md border border-line text-xs">
              <button name="dataset" value="real" className={`px-2.5 py-1.5 ${!demo ? "bg-leaf text-white" : "bg-white hover:bg-paper"}`}>実データ</button>
              <button name="dataset" value="demo" className={`px-2.5 py-1.5 ${demo ? "bg-demo text-white" : "bg-white hover:bg-paper"}`}>デモ</button>
            </form>
            {!aiConnected() && <span className="rounded border border-line bg-paper px-2 py-1 text-[11px] text-muted" title="ANTHROPIC_API_KEY 未設定。施策案はルールベースで作成します">AI未接続</span>}
            {authEnabled() && (
              <form action={logout}>
                <button className="text-xs text-muted underline">ログアウト</button>
              </form>
            )}
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:gap-6 md:py-6">
        <aside className="md:w-44 md:shrink-0">
          <div className="md:sticky md:top-12">
            <Nav />
          </div>
        </aside>
        <main className="min-w-0 flex-1 pb-16">{children}</main>
      </div>
    </div>
  );
}
