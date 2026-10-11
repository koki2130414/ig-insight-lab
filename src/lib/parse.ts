// 入力値の解釈。空欄・未取得は null（ゼロにしない）。
import { parseJstLocal, isDay } from "./time";

const NULL_TOKENS = new Set(["", "-", "—", "ー", "null", "NULL", "n/a", "N/A", "未取得", "未入力", "非対応"]);

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function parseNumber(raw: unknown, opts: { int?: boolean; min?: number } = {}): Parsed<number | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  if (typeof raw === "number") return check(raw);
  const s = String(raw).trim().replace(/[,，\s]/g, "").replace(/[０-９．]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0));
  if (NULL_TOKENS.has(s)) return { ok: true, value: null };
  const pct = s.endsWith("%");
  const n = Number(pct ? s.slice(0, -1) : s);
  if (!Number.isFinite(n)) return { ok: false, error: `数値ではありません: "${raw}"` };
  return check(n);
  function check(n: number): Parsed<number | null> {
    if (opts.min !== undefined && n < opts.min) return { ok: false, error: `${opts.min}以上にしてください: ${n}` };
    if (opts.int && !Number.isInteger(n)) return { ok: false, error: `整数にしてください: ${n}` };
    return { ok: true, value: n };
  }
}

export function parseBool(raw: unknown): Parsed<boolean | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const s = String(raw).trim().toLowerCase();
  if (NULL_TOKENS.has(s)) return { ok: true, value: null };
  if (["true", "1", "yes", "y", "はい", "あり", "有", "○"].includes(s)) return { ok: true, value: true };
  if (["false", "0", "no", "n", "いいえ", "なし", "無", "×"].includes(s)) return { ok: true, value: false };
  return { ok: false, error: `はい/いいえ で入力してください: "${raw}"` };
}

export function parseDateTime(raw: unknown, required = false): Parsed<Date | null> {
  const s = raw === null || raw === undefined ? "" : String(raw).trim();
  if (!s) return required ? { ok: false, error: "日時が必要です" } : { ok: true, value: null };
  const d = parseJstLocal(s);
  if (!d) return { ok: false, error: `日時の形式が不正です: "${s}"（例: 2026-10-01 18:30）` };
  return { ok: true, value: d };
}

export function parseDay(raw: unknown, required = true): Parsed<string | null> {
  const s = raw === null || raw === undefined ? "" : String(raw).trim().replaceAll("/", "-");
  if (!s) return required ? { ok: false, error: "日付が必要です" } : { ok: true, value: null };
  const m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const norm = m ? `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}` : s;
  if (!isDay(norm)) return { ok: false, error: `日付の形式が不正です: "${s}"（例: 2026-10-01）` };
  return { ok: true, value: norm };
}

export function parseText(raw: unknown, max = 5000): Parsed<string | null> {
  if (raw === null || raw === undefined) return { ok: true, value: null };
  const s = String(raw).replace(/\u0000/g, "").trim();
  if (!s) return { ok: true, value: null };
  if (s.length > max) return { ok: false, error: `${max}文字以内にしてください` };
  return { ok: true, value: s };
}

export function parseEnum<T extends string>(raw: unknown, allowed: Record<T, string>, aliases: Record<string, T> = {}): Parsed<T | null> {
  if (raw === null || raw === undefined || String(raw).trim() === "") return { ok: true, value: null };
  const s = String(raw).trim();
  if (s in allowed) return { ok: true, value: s as T };
  const byLabel = (Object.entries(allowed) as [T, string][]).find(([, label]) => label === s);
  if (byLabel) return { ok: true, value: byLabel[0] };
  const lower = s.toLowerCase();
  if (aliases[lower]) return { ok: true, value: aliases[lower] };
  return { ok: false, error: `値が不正です: "${s}"（${Object.keys(allowed).join(" / ")}）` };
}

export function parseUrl(raw: unknown): Parsed<string | null> {
  const s = raw === null || raw === undefined ? "" : String(raw).trim();
  if (!s) return { ok: true, value: null };
  try {
    const u = new URL(s);
    if (!/^https?:$/.test(u.protocol)) return { ok: false, error: "http(s)のURLにしてください" };
    return { ok: true, value: normalizeIgUrl(u.toString()) };
  } catch {
    return { ok: false, error: `URLの形式が不正です: "${s}"` };
  }
}

/** Instagram の投稿URLを正規化（クエリ・末尾スラッシュ揺れを吸収して重複判定を安定させる） */
export function normalizeIgUrl(url: string) {
  try {
    const u = new URL(url);
    if (/(^|\.)instagram\.com$/.test(u.hostname)) {
      const parts = u.pathname.split("/").filter(Boolean);
      // /{user}/p/{code}/ や /reel/{code}/ → /p|reel/{code}/
      const idx = parts.findIndex((p) => ["p", "reel", "reels", "tv"].includes(p));
      if (idx >= 0 && parts[idx + 1]) {
        const kind = parts[idx] === "reels" ? "reel" : parts[idx];
        return `https://www.instagram.com/${kind}/${parts[idx + 1]}/`;
      }
      return `https://www.instagram.com/${parts.join("/")}${parts.length ? "/" : ""}`;
    }
    return u.toString();
  } catch {
    return url;
  }
}
