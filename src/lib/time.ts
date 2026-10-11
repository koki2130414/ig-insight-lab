// 日時はすべて Asia/Tokyo で表示・解釈する（日本は夏時間なし: +09:00 固定）
export const TZ = "Asia/Tokyo";
const OFFSET_MS = 9 * 60 * 60 * 1000;

export function fmtDateTime(d: Date | string | null | undefined) {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(date);
}

export function fmtDate(d: Date | string | null | undefined) {
  if (!d) return "—";
  if (typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d.replaceAll("-", "/");
  const date = typeof d === "string" ? new Date(d) : d;
  return new Intl.DateTimeFormat("ja-JP", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

/** JST の暦日 'YYYY-MM-DD' */
export function jstDay(d: Date = new Date()) {
  return new Date(d.getTime() + OFFSET_MS).toISOString().slice(0, 10);
}

/** 'YYYY-MM-DD' に日数を足す */
export function addDays(day: string, n: number) {
  const t = Date.parse(day + "T00:00:00Z") + n * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/** その日を含む週の月曜（JST） */
export function weekStart(day: string = jstDay()) {
  const dow = new Date(day + "T00:00:00Z").getUTCDay(); // 0=日
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

/** JST の日付の開始・終了を Date で */
export function jstDayStart(day: string) {
  return new Date(day + "T00:00:00+09:00");
}
export function jstDayEnd(day: string) {
  return new Date(addDays(day, 1) + "T00:00:00+09:00");
}

/** <input type="datetime-local"> の値（JSTとして解釈）→ Date。不正なら null */
export function parseJstLocal(v: string | null | undefined): Date | null {
  if (!v) return null;
  const s = v.trim();
  let iso: string;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) iso = s + "T00:00:00+09:00";
  else if (/^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(:\d{2})?$/.test(s)) iso = s.replace(" ", "T") + (s.length === 16 ? ":00" : "") + "+09:00";
  else iso = s.replaceAll("/", "-");
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/** Date → datetime-local 用 'YYYY-MM-DDTHH:mm'（JST） */
export function toJstLocalInput(d: Date | string | null | undefined) {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return new Date(date.getTime() + OFFSET_MS).toISOString().slice(0, 16);
}

export function isDay(s: unknown): s is string {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(Date.parse(s + "T00:00:00Z"));
}

/** 現在時刻（ミリ秒）。サーバー側の描画で使う */
export function nowMs() {
  return Date.now();
}
