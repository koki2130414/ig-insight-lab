"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useFormStatus } from "react-dom";
import { useState, type ReactNode } from "react";

export function Submit({ children, className = "btn", pendingText = "保存中…", confirm }: { children: ReactNode; className?: string; pendingText?: string; confirm?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? pendingText : children}
    </button>
  );
}

const NAV = [
  { href: "/", label: "ダッシュボード" },
  { href: "/posts", label: "投稿と比較" },
  { href: "/import", label: "取り込み" },
  { href: "/followers", label: "フォロワー増減" },
  { href: "/audience", label: "オーディエンス" },
  { href: "/targets", label: "ターゲット" },
  { href: "/initiatives/new", label: "施策をつくる" },
  { href: "/board", label: "検証ボード" },
  { href: "/funnel", label: "導線・売上" },
  { href: "/review", label: "週次レビュー" },
  { href: "/settings", label: "設定・接続" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto pb-1 md:flex-col md:overflow-visible md:pb-0">
      {NAV.map((n) => {
        const active = n.href === "/" ? path === "/" : path.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            className={`whitespace-nowrap rounded-md px-3 py-2 text-sm ${active ? "bg-leaf text-white font-semibold" : "text-ink hover:bg-white"}`}
          >
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function Disclosure({ summary, children, defaultOpen = false }: { summary: ReactNode; children: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-md border border-line bg-white">
      <button type="button" onClick={() => setOpen(!open)} className="flex w-full items-center justify-between px-3 py-2 text-left text-sm font-semibold">
        <span>{summary}</span>
        <span className="text-muted">{open ? "−" : "＋"}</span>
      </button>
      {open && <div className="border-t border-line p-3">{children}</div>}
    </div>
  );
}

export function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="btn-ghost"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? "コピーしました" : "コピー"}
    </button>
  );
}
