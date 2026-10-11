import Link from "next/link";
import type { ReactNode } from "react";
import { MEASUREMENTS, SOURCES } from "@/lib/catalog";
import { fmtDateTime } from "@/lib/time";

export function PageHeader({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold tracking-tight md:text-2xl">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className = "", actions, id }: { title?: ReactNode; children: ReactNode; className?: string; actions?: ReactNode; id?: string }) {
  return (
    <section id={id} className={`min-w-0 rounded-lg border border-line bg-card p-4 md:p-5 ${className}`}>
      {(title || actions) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          {title && <h2 className="text-[15px] font-bold">{title}</h2>}
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

const tone = {
  gray: "bg-paper text-muted border-line",
  green: "bg-leaf-soft text-leaf border-leaf/20",
  gold: "bg-rice-soft text-rice border-rice/20",
  red: "bg-warn-soft text-warn border-warn/20",
  demo: "bg-demo-soft text-demo border-demo/30",
};
export function Badge({ children, t = "gray", title }: { children: ReactNode; t?: keyof typeof tone; title?: string }) {
  return <span title={title} className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-[11px] font-medium ${tone[t]}`}>{children}</span>;
}

export function SourceBadge({ source, measurement }: { source: string; measurement?: string }) {
  const t = source === "demo" ? "demo" : measurement === "estimated" ? "gold" : measurement === "measured" ? "green" : "gray";
  return (
    <Badge t={t} title={`取得元: ${SOURCES[source as keyof typeof SOURCES] ?? source}`}>
      {source === "demo" ? "デモ" : MEASUREMENTS[measurement as keyof typeof MEASUREMENTS] ?? source}
    </Badge>
  );
}

/** 値の表示。null は「未取得」（ゼロとは区別） */
export function Val({ v, unit, digits = 0, missing = "未取得" }: { v: number | null | undefined; unit?: "count" | "ratio" | "yen" | "seconds"; digits?: number; missing?: string }) {
  if (v === null || v === undefined || Number.isNaN(v)) return <span className="text-xs font-medium text-muted">{missing}</span>;
  if (unit === "ratio") return <span className="num">{(v * 100).toFixed(1)}%</span>;
  if (unit === "yen") return <span className="num">¥{Math.round(v).toLocaleString("ja-JP")}</span>;
  if (unit === "seconds") return <span className="num">{v.toFixed(1)}秒</span>;
  return <span className="num">{v.toLocaleString("ja-JP", { maximumFractionDigits: digits })}</span>;
}

export function Stat({ label, children, sub, href }: { label: string; children: ReactNode; sub?: ReactNode; href?: string }) {
  const body = (
    <div className="rounded-md border border-line bg-white p-3">
      <div className="text-[11px] font-medium text-muted">{label}</div>
      <div className="mt-1 text-xl font-bold">{children}</div>
      {sub && <div className="mt-1 text-[11px] text-muted">{sub}</div>}
    </div>
  );
  return href ? <Link href={href} className="block hover:opacity-80">{body}</Link> : body;
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="rounded-md border border-dashed border-line bg-paper/60 p-5 text-center">
      <div className="text-sm font-semibold">{title}</div>
      {children && <div className="mt-2 text-sm text-muted">{children}</div>}
    </div>
  );
}

export function Note({ children, t = "gray" }: { children: ReactNode; t?: "gray" | "gold" | "red" | "green" }) {
  const c = { gray: "bg-paper border-line text-muted", gold: "bg-rice-soft border-rice/30 text-ink", red: "bg-warn-soft border-warn/30 text-ink", green: "bg-leaf-soft border-leaf/20 text-ink" }[t];
  return <div className={`rounded-md border px-3 py-2 text-[13px] leading-relaxed ${c}`}>{children}</div>;
}

export function Captured({ at }: { at: Date | string | null }) {
  return <span className="text-[11px] text-muted">取得: {fmtDateTime(at)}</span>;
}

export function Field({ label, children, hint, className = "" }: { label: string; children: ReactNode; hint?: string; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export function Options({ map, empty }: { map: Record<string, string>; empty?: string }) {
  return (
    <>
      {empty !== undefined && <option value="">{empty}</option>}
      {Object.entries(map).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
    </>
  );
}

export function Flash({ sp }: { sp: { ok?: string; err?: string } }) {
  if (!sp.ok && !sp.err) return null;
  return (
    <div className="mb-4" role={sp.err ? "alert" : "status"}>
      <Note t={sp.err ? "red" : "green"}>{sp.err ?? sp.ok}</Note>
    </div>
  );
}
