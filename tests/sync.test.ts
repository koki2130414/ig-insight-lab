import { describe, it, expect } from "vitest";
import { createTestDb } from "@/lib/db";
import { syncAccount, checkpointFor } from "@/lib/instagram/sync";
import type { InsightsAdapter, BreakdownValue } from "@/lib/instagram/adapter";
import { encryptSecret, decryptSecret, redact } from "@/lib/secrets";

describe("API同期（モックアダプター）", () => {
  it("経過時間からチェックポイントを決め、復元できない時点は other", () => {
    expect(checkpointFor(26)).toBe("24h");
    expect(checkpointFor(70)).toBe("72h");
    expect(checkpointFor(150)).toBe("7d");
    expect(checkpointFor(40)).toBe("other");
  });

  it("空の結果・エラーは null（0 にしない）として保存し、理由を残す", async () => {
    const db = await createTestDb();
    const [acc] = await db.query<{ id: string }>(`SELECT id FROM accounts WHERE dataset='real' AND kind='farm'`);
    const posted = new Date(Date.now() - 25 * 3600000).toISOString();
    const fake: InsightsAdapter = {
      profile: async () => ({ id: "1", username: "213nouen", followers_count: 1900 }),
      recentMedia: async () => [{ id: "m1", media_type: "VIDEO", media_product_type: "REELS", permalink: "https://www.instagram.com/reel/ABC/", timestamp: posted }],
      mediaInsights: async (_id, metrics) => metrics.map((m) => (m === "reach" ? { name: m, value: 500 } : m === "shares" ? { name: m, value: 0 } : { name: m, value: null, error: "空の結果（データ無し）" })),
      accountTotals: async (metrics) => metrics.map((m) => ({ name: m, value: m === "reach" ? 3000 : null, error: m === "reach" ? undefined : "Not enough data" })),
      accountBreakdown: async (metric): Promise<BreakdownValue> => (metric === "reach" ? { name: metric, total: 3000, breakdown: { FOLLOWER: 1000, NON_FOLLOWER: 2000 } } : { name: metric, total: null, breakdown: {}, error: "フォロワー100人未満" }),
      demographics: async (metric) => ({ name: metric, total: null, breakdown: {}, error: "未対応" }),
    };
    const r = await syncAccount(db, acc.id, fake);
    expect(r.snapshots).toBe(1);
    const [pm] = await db.query<{ checkpoint: string; reach: number; shares: number; saves: number | null; source: string }>(`SELECT checkpoint, reach, shares, saves, source FROM post_metrics WHERE account_id=$1`, [acc.id]);
    expect(pm).toMatchObject({ checkpoint: "24h", reach: 500, shares: 0, saves: null, source: "api" });
    const rows = await db.query<{ metric: string; value: number | null; status: string }>(`SELECT metric, value, status FROM account_metrics WHERE account_id=$1`, [acc.id]);
    expect(rows.find((x) => x.metric === "reach")?.value).toBe(3000);
    expect(rows.find((x) => x.metric === "reach_non_follower")?.value).toBe(2000);
    expect(rows.find((x) => x.metric === "follower_net")).toMatchObject({ value: null, status: "unavailable" });
    expect(rows.find((x) => x.metric === "followers")?.value).toBe(1900);
  });

  it("トークンは暗号化して保存でき、ログ用文字列から除去される", () => {
    process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    const c = encryptSecret("IGAAtoken123");
    expect(c).not.toContain("IGAAtoken123");
    expect(decryptSecret(c)).toBe("IGAAtoken123");
    expect(redact("https://x?access_token=abc&y=1")).toBe("https://x?access_token=[REDACTED]&y=1");
  });
});
