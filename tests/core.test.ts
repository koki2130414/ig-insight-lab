import { describe, it, expect, beforeAll } from "vitest";
import { createTestDb, type Db } from "@/lib/db";
import { safeRate, summarize, ratesFor, selectPeers, compareStats, suggestDecision, feasibleCount, buildUtmUrl, checkpointDrift, type MetricRow, type PeerPost } from "@/lib/analytics";
import { parseNumber, normalizeIgUrl } from "@/lib/parse";
import { validateRows, commitRows, autoMap } from "@/lib/importer";
import { LOCAL_USER } from "@/lib/seed";

let db: Db;
let realPersonal: string, realFarm: string, demoFarm: string;

beforeAll(async () => {
  db = await createTestDb();
  const accs = await db.query<{ id: string; dataset: string; kind: string }>(`SELECT id,dataset,kind FROM accounts WHERE user_id=$1`, [LOCAL_USER]);
  realPersonal = accs.find((a) => a.dataset === "real" && a.kind === "personal")!.id;
  realFarm = accs.find((a) => a.dataset === "real" && a.kind === "farm")!.id;
  demoFarm = accs.find((a) => a.dataset === "demo" && a.kind === "farm")!.id;
});

describe("指標計算", () => {
  it("分母が0・欠損なら算出しない（ゼロ除算しない）", () => {
    expect(safeRate(5, 0)).toBeNull();
    expect(safeRate(5, null)).toBeNull();
    expect(safeRate(null, 100)).toBeNull();
    expect(safeRate(5, 100)).toBe(0.05);
    expect(ratesFor({ saves: 3, reach: 0 }).save_rate).toBeNull();
  });

  it("欠損をゼロとして集計しない", () => {
    const s = summarize([10, null, 20, undefined]);
    expect(s.n).toBe(2);
    expect(s.missing).toBe(2);
    expect(s.mean).toBe(15);
    expect(s.median).toBe(15);
  });

  it("空欄・未取得は null、0 は 0", () => {
    expect(parseNumber("")).toEqual({ ok: true, value: null });
    expect(parseNumber("未取得")).toEqual({ ok: true, value: null });
    expect(parseNumber("0")).toEqual({ ok: true, value: 0 });
    expect(parseNumber("1,234")).toEqual({ ok: true, value: 1234 });
    expect(parseNumber("abc").ok).toBe(false);
  });
});

describe("比較条件", () => {
  const mk = (id: string, format: string, acc = "A", extra: Partial<PeerPost> = {}): PeerPost => ({ id, account_id: acc, format, purpose: "trust", is_ad: false, is_giveaway: false, posted_at: new Date(), ...extra });
  const m = (post_id: string, checkpoint: MetricRow["checkpoint"], reach: number | null, saves: number | null, hours: number | null = null): MetricRow => ({
    post_id, checkpoint, hours_since_post: hours ?? ({ "24h": 24, "72h": 72, "7d": 168, other: 30 } as const)[checkpoint], reach, views: null, likes: null, comments: null, saves, shares: null, profile_visits: null, follows: null, non_follower_reach: null, avg_watch_sec: null,
  });

  it("同じアカウント・同じ形式・同じ時点のみを比較", () => {
    const target = mk("t", "reel");
    const posts = [target, mk("a", "reel"), mk("b", "feed"), mk("c", "reel", "B"), mk("d", "reel"), mk("e", "reel", "A", { is_ad: true })];
    const metrics = [m("t", "72h", 1000, 30), m("a", "72h", 1000, 10), m("b", "72h", 1000, 50), m("c", "72h", 1000, 50), m("d", "24h", 1000, 50), m("e", "72h", 1000, 90)];
    const { peers } = selectPeers(target, posts, metrics, { checkpoint: "72h", samePurpose: false, excludeAds: true, excludeDrift: false });
    expect(peers.map((p) => p.id)).toEqual(["a"]);
    const stats = compareStats(metrics[0], selectPeers(target, posts, metrics, { checkpoint: "72h", samePurpose: false, excludeAds: false, excludeDrift: false }).peerMetrics);
    const sr = stats.find((s) => s.key === "save_rate")!;
    expect(sr.n).toBe(2); // a と e
    expect(sr.median).toBeCloseTo(0.05);
  });

  it("経過時間のずれを検出し除外できる", () => {
    expect(checkpointDrift("24h", 40)).toBe("drift");
    expect(checkpointDrift("72h", 70)).toBe("ok");
    const target = mk("t", "reel");
    const { peers } = selectPeers(target, [target, mk("a", "reel")], [m("a", "24h", 100, 1, 47)], { checkpoint: "24h", samePurpose: false, excludeAds: false, excludeDrift: true });
    expect(peers).toHaveLength(0);
  });

  it("other 時点は比較しない", () => {
    const target = mk("t", "reel");
    expect(selectPeers(target, [target, mk("a", "reel")], [m("a", "other", 100, 1)], { checkpoint: "other", samePurpose: false, excludeAds: false, excludeDrift: false }).peers).toHaveLength(0);
  });
});

describe("判定・計画", () => {
  it("単発の結果では勝ちパターンを断定しない", () => {
    expect(suggestDecision([{ vsMedian: 3 }]).decision).toBe("retest");
    expect(suggestDecision([{ vsMedian: 1.5 }, { vsMedian: 1.3 }, { vsMedian: 1.2 }]).decision).toBe("continue");
    expect(suggestDecision([]).decision).toBe("retest");
  });
  it("実行可能件数は制作時間に応じ上限あり", () => {
    expect(feasibleCount(null, []).count).toBe(0);
    expect(feasibleCount(10000, [60]).count).toBe(3);
    expect(feasibleCount(120, [90]).count).toBe(1);
  });
  it("UTM URL", () => {
    expect(buildUtmUrl("https://213nouen.example/shop?x=1", { source: "instagram", medium: "social", campaign: "shinmai" })).toBe("https://213nouen.example/shop?x=1&utm_source=instagram&utm_medium=social&utm_campaign=shinmai");
    expect(buildUtmUrl("javascript:alert(1)", { source: "a", medium: "b", campaign: "c" })).toBeNull();
  });
  it("Instagram URL の正規化", () => {
    expect(normalizeIgUrl("https://instagram.com/213nouen/reel/ABC123/?igsh=xyz")).toBe("https://www.instagram.com/reel/ABC123/");
  });
});

describe("取り込みと分離", () => {
  const postsCsv = [
    { URL: "https://www.instagram.com/p/AAA/", 投稿日時: "2026-10-01 18:00", 形式: "リール", テーマ: "米づくりの裏側" },
    { URL: "https://www.instagram.com/p/BBB/?utm=1", 投稿日時: "2026-10-02 18:00", 形式: "feed", テーマ: "" },
    { URL: "https://www.instagram.com/p/AAA/", 投稿日時: "2026-10-01 18:00", 形式: "reel", テーマ: "重複行" },
    { URL: "not a url", 投稿日時: "bad", 形式: "xxx" },
  ];

  function mapRows(rows: Record<string, string>[], map: Record<string, string>) {
    return rows.map((r) => Object.fromEntries(Object.entries(map).map(([k, h]) => [k, r[h]])));
  }

  it("自動マッピング・検証エラー", () => {
    const map = autoMap("posts", Object.keys(postsCsv[0]).concat(["形式"]));
    expect(map.url).toBe("URL");
    expect(map.posted_at).toBe("投稿日時");
    const v = validateRows("posts", mapRows(postsCsv as Record<string, string>[], { url: "URL", posted_at: "投稿日時", format: "形式", theme: "テーマ" }));
    expect(v.filter((r) => r.ok)).toHaveLength(3);
    expect(v[3].ok).toBe(false);
    expect(v[3].errors.length).toBeGreaterThanOrEqual(3);
  });

  it("同じCSVを2回取り込んでも重複登録しない", async () => {
    const v = validateRows("posts", mapRows(postsCsv as Record<string, string>[], { url: "URL", posted_at: "投稿日時", format: "形式", theme: "テーマ" }));
    const r1 = await commitRows(db, realFarm, "posts", v, "csv", "manual");
    expect(r1.inserted).toBe(2);
    expect(r1.duplicates).toBe(1); // ファイル内の重複
    const r2 = await commitRows(db, realFarm, "posts", v, "csv", "manual");
    expect(r2.inserted).toBe(0);
    expect(r2.duplicates).toBe(3);
    const [{ n }] = await db.query<{ n: number }>(`SELECT count(*)::int n FROM posts WHERE account_id=$1`, [realFarm]);
    expect(n).toBe(2);
  });

  it("投稿実績: 欠損は null で保存し、重複時点は登録しない", async () => {
    const rows = [
      { post_url: "https://www.instagram.com/p/AAA/", checkpoint: "24h", captured_at: "2026-10-02 18:00", reach: "500", saves: "", shares: "0" },
      { post_url: "https://www.instagram.com/p/AAA/", checkpoint: "24h", captured_at: "2026-10-02 19:00", reach: "520" },
      { post_url: "https://www.instagram.com/p/ZZZ/", checkpoint: "24h", captured_at: "2026-10-02 19:00", reach: "1" },
    ];
    const v = validateRows("post_metrics", rows);
    const r = await commitRows(db, realFarm, "post_metrics", v, "csv", "manual");
    expect(r.inserted).toBe(1);
    expect(r.duplicates).toBe(1);
    expect(r.errors.some((e) => e.errors[0].includes("未登録"))).toBe(true);
    const [pm] = await db.query<{ saves: number | null; shares: number | null; reach: number }>(`SELECT saves, shares, reach FROM post_metrics WHERE account_id=$1`, [realFarm]);
    expect(pm.saves).toBeNull();
    expect(pm.shares).toBe(0);
    expect(pm.reach).toBe(500);
  });

  it("2アカウントのデータが混ざらない／デモが実データに混ざらない", async () => {
    // 個人アカウントでは農園のURLの投稿は見つからない
    const v = validateRows("post_metrics", [{ post_url: "https://www.instagram.com/p/AAA/", checkpoint: "72h", captured_at: "2026-10-04 18:00", reach: "900" }]);
    const r = await commitRows(db, realPersonal, "post_metrics", v, "csv", "manual");
    expect(r.inserted).toBe(0);
    const [{ n: personalPosts }] = await db.query<{ n: number }>(`SELECT count(*)::int n FROM posts WHERE account_id=$1`, [realPersonal]);
    expect(personalPosts).toBe(0);
    const [{ n: demoInReal }] = await db.query<{ n: number }>(
      `SELECT count(*)::int n FROM posts p JOIN accounts a ON a.id=p.account_id WHERE a.dataset='real' AND p.source='demo'`,
    );
    expect(demoInReal).toBe(0);
    const [{ n: demoPosts }] = await db.query<{ n: number }>(`SELECT count(*)::int n FROM posts WHERE account_id=$1`, [demoFarm]);
    expect(demoPosts).toBeGreaterThan(10);
  });

  it("問い合わせ・購入: 注文番号が無くても再取り込みで重複しない", async () => {
    const rows = [{ occurred_at: "2026-10-05 10:00", kind: "purchase", attribution: "self_reported", revenue: "4900", quantity: "1" }];
    const v = validateRows("conversions", rows);
    expect((await commitRows(db, realFarm, "conversions", v, "csv", "manual")).inserted).toBe(1);
    expect((await commitRows(db, realFarm, "conversions", v, "csv", "manual")).duplicates).toBe(1);
  });

  it("アカウント指標: 空欄は未入力(null)として保存", async () => {
    const v = validateRows("account_metrics", [{ metric: "reach", period_start: "2026-09-29", period_end: "2026-10-05", value: "" }, { metric: "unknown_metric", period_start: "2026-09-29", period_end: "2026-10-05", value: "1" }]);
    expect(v[1].ok).toBe(false);
    await commitRows(db, realFarm, "account_metrics", v, "csv", "manual");
    const [row] = await db.query<{ value: number | null; status: string }>(`SELECT value,status FROM account_metrics WHERE account_id=$1 AND metric='reach'`, [realFarm]);
    expect(row.value).toBeNull();
    expect(row.status).toBe("not_entered");
  });
});

import { zipSync, strToU8 } from "fflate";
import { parseFollowersUpload, diffFollowers, parseFollowersJson } from "@/lib/followers";

describe("フォロワー一覧（Instagramの書き出し）", () => {
  const json = JSON.stringify([
    { title: "", media_list_data: [], string_list_data: [{ href: "https://www.instagram.com/alice_1", value: "alice_1", timestamp: 1760000000 }] },
    { title: "bob.b", string_list_data: [{ href: "https://www.instagram.com/_u/bob.b", timestamp: 1760100000 }] },
    { title: "", string_list_data: [{ href: "https://www.instagram.com/carol/" }] },
    { title: "", string_list_data: [{ value: "<script>" }] },
  ]);
  it("値・タイトル・URLのどれからでもユーザーネームを読み、不正な名前は捨てる", () => {
    const r = parseFollowersJson(json);
    expect(r.map((e) => e.username)).toEqual(["alice_1", "bob.b", "carol"]);
    expect(r[0].followedAt?.toISOString()).toBe(new Date(1760000000 * 1000).toISOString());
    expect(r[2].followedAt).toBeNull();
  });
  it("zipの中の followers_*.json だけを読み、フォロー中の一覧は無視する", () => {
    const zip = zipSync({
      "connections/followers_and_following/followers_1.json": strToU8(json),
      "connections/followers_and_following/following.json": strToU8(JSON.stringify({ relationships_following: [{ title: "zed", string_list_data: [{ href: "https://www.instagram.com/_u/zed" }] }] })),
    });
    const r = parseFollowersUpload("instagram-export.zip", zip);
    expect(r.entries.map((e) => e.username)).toEqual(["alice_1", "bob.b", "carol"]);
  });
  it("差分でフォローした人・外した人を出す", () => {
    expect(diffFollowers(["a", "b", "c"], ["b", "c", "d"])).toEqual({ gained: ["d"], lost: ["a"] });
  });
});
