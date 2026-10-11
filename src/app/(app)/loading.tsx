// 画面を切り替えた瞬間に表示する仮の画面（データの読み込み中）
export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse">
      <div className="mb-2 h-7 w-56 rounded bg-line/70" />
      <div className="mb-6 h-4 w-80 max-w-full rounded bg-line/50" />
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-20 rounded-md border border-line bg-white" />
        ))}
      </div>
      <div className="mt-4 h-48 rounded-lg border border-line bg-white" />
      <span className="sr-only">読み込み中…</span>
    </div>
  );
}
