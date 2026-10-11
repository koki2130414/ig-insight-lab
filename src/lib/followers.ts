import { unzipSync, strFromU8 } from "fflate";

/**
 * Instagram「情報をダウンロード」（アカウントセンター）で書き出したフォロワー一覧の読み取り。
 * 公式APIはフォロワーの数しか返さず「誰が」は取得できないため、本人が書き出した公式ファイルを使う。
 * スクレイピングはしない。
 */
export type FollowerEntry = { username: string; followedAt: Date | null };
export type ParsedFollowers = { entries: FollowerEntry[]; files: string[]; warnings: string[] };

const USERNAME = /^[a-z0-9._]{1,30}$/;

function usernameFromHref(href: unknown): string | null {
  if (typeof href !== "string") return null;
  try {
    const u = new URL(href);
    if (!/(^|\.)instagram\.com$/.test(u.hostname)) return null;
    const parts = u.pathname.split("/").filter(Boolean).filter((p) => p !== "_u");
    return parts[0] ?? null;
  } catch {
    return null;
  }
}

function clean(name: unknown): string | null {
  if (typeof name !== "string") return null;
  const n = name.trim().replace(/^@/, "").toLowerCase();
  return USERNAME.test(n) ? n : null;
}

type Item = { title?: unknown; string_list_data?: { href?: unknown; value?: unknown; timestamp?: unknown }[] };

/** JSON形式（followers_1.json など）。配列そのもの、または relationships_* キーで包まれた形の両方に対応 */
export function parseFollowersJson(text: string): FollowerEntry[] {
  const data = JSON.parse(text) as unknown;
  let items: Item[] = [];
  if (Array.isArray(data)) items = data as Item[];
  else if (data && typeof data === "object") {
    const key = Object.keys(data).find((k) => k.startsWith("relationships_followers")) ?? Object.keys(data).find((k) => k.startsWith("relationships_"));
    if (key && Array.isArray((data as Record<string, unknown>)[key])) items = (data as Record<string, Item[]>)[key];
  }
  const out: FollowerEntry[] = [];
  for (const it of items) {
    const s = it?.string_list_data?.[0];
    const name = clean(s?.value) ?? clean(it?.title) ?? clean(usernameFromHref(s?.href));
    if (!name) continue;
    const ts = typeof s?.timestamp === "number" && s.timestamp > 0 ? new Date(s.timestamp * 1000) : null;
    out.push({ username: name, followedAt: ts });
  }
  return out;
}

/** HTML形式（followers_1.html）。プロフィールへのリンクと、その後ろの日付（あれば）を読む */
export function parseFollowersHtml(html: string): FollowerEntry[] {
  const out: FollowerEntry[] = [];
  const re = /<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    const name = clean(m[2]) ?? clean(usernameFromHref(m[1]));
    if (name && usernameFromHref(m[1])) out.push({ username: name, followedAt: null });
  }
  return out;
}

/** フォロワーの一覧ファイルか（フォロー中・リクエスト等の別ファイルは除外） */
export function isFollowersFile(path: string) {
  const base = path.split("/").pop()!.toLowerCase();
  return /^followers(_\d+)?\.(json|html)$/.test(base);
}

function dedupe(entries: FollowerEntry[]) {
  const map = new Map<string, FollowerEntry>();
  for (const e of entries) if (!map.has(e.username)) map.set(e.username, e);
  return [...map.values()];
}

/** アップロードされたファイル（zip / json / html）からフォロワー一覧を取り出す */
export function parseFollowersUpload(filename: string, bytes: Uint8Array): ParsedFollowers {
  const lower = filename.toLowerCase();
  const warnings: string[] = [];
  const files: string[] = [];
  let entries: FollowerEntry[] = [];
  const read = (path: string, text: string) => {
    files.push(path);
    entries.push(...(path.toLowerCase().endsWith(".html") ? parseFollowersHtml(text) : parseFollowersJson(text)));
  };
  if (lower.endsWith(".zip")) {
    const unzipped = unzipSync(bytes, { filter: (f) => isFollowersFile(f.name) });
    for (const [path, data] of Object.entries(unzipped)) read(path, strFromU8(data));
    if (!files.length) throw new Error("zipの中に followers_1.json（または followers_1.html）が見つかりません。「フォロワーとフォロー中」を含めて書き出してください");
  } else if (lower.endsWith(".json") || lower.endsWith(".html")) {
    if (!isFollowersFile(lower)) warnings.push(`ファイル名が followers_1.json の形式ではありません（${filename}）。フォロー中の一覧を選んでいないか確認してください`);
    read(filename, strFromU8(bytes));
  } else {
    throw new Error("zip・json・html のいずれかを選んでください");
  }
  entries = dedupe(entries);
  if (!entries.length) throw new Error("フォロワーを1人も読み取れませんでした。ファイルの種類を確認してください");
  return { entries, files, warnings };
}

/** 2つの一覧の差分（新しくフォローした人／フォローを外した人） */
export function diffFollowers(prev: Iterable<string>, cur: Iterable<string>) {
  const p = new Set(prev);
  const c = new Set(cur);
  return {
    gained: [...c].filter((u) => !p.has(u)).sort(),
    lost: [...p].filter((u) => !c.has(u)).sort(),
  };
}
