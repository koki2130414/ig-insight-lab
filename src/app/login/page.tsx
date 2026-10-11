import { login } from "@/app/actions";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { authEnabled } from "@/lib/context";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ err?: string; e?: string; g?: string }> }) {
  await connection(); // 実行時の環境変数で判定するため動的に描画
  if (!authEnabled()) redirect("/");
  const sp = await searchParams;
  return (
    <main className="mx-auto mt-24 max-w-sm px-4">
      <h1 className="mb-4 text-xl font-bold">IG Insight Lab</h1>
      <form action={login} className="space-y-3 rounded-lg border border-line bg-white p-5">
        <label className="block">
          <span className="label">パスコード</span>
          <input name="passcode" type="password" autoComplete="off" className="field" required />
        </label>
        {sp.err && (
          <p className="text-sm text-warn">
            パスコードが違います（Vercel の APP_PASSCODE と同じ値を入力してください。値を変えた場合は再デプロイ後に反映されます）
            {sp.e && sp.g && <span className="mt-1 block text-xs text-muted">文字数: 設定値 {sp.e} 文字 ／ 入力 {sp.g} 文字。ブラウザが古いパスコードを自動入力していないかも確認してください。</span>}
          </p>
        )}
        <button className="btn w-full">ログイン</button>
      </form>
    </main>
  );
}
