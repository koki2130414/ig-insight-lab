import "server-only";
import { redact } from "../secrets";

/**
 * Instagram 公式API（Instagram API with Instagram Login）用アダプター。
 * 交換可能にするため、アプリ側はこの interface だけに依存する。
 * 確認したドキュメント・バージョンは docs/meta-api-research.md を参照。
 */
export const GRAPH_VERSION = process.env.META_GRAPH_VERSION || "v25.0";
export const GRAPH_BASE = `https://graph.instagram.com/${GRAPH_VERSION}`;
export const OAUTH_AUTHORIZE = "https://www.instagram.com/oauth/authorize";
export const OAUTH_TOKEN = "https://api.instagram.com/oauth/access_token";
export const LONG_LIVED = "https://graph.instagram.com/access_token";
export const REFRESH = "https://graph.instagram.com/refresh_access_token";
export const SCOPES = ["instagram_business_basic", "instagram_business_manage_insights"];

export type IgProfile = { id: string; user_id?: string; username: string; followers_count?: number; media_count?: number };
export type IgMedia = { id: string; caption?: string; media_type: string; media_product_type?: string; permalink?: string; timestamp: string };
export type InsightValue = { name: string; value: number | null; error?: string };
export type BreakdownValue = { name: string; total: number | null; breakdown: Record<string, number>; error?: string };

export interface InsightsAdapter {
  profile(): Promise<IgProfile>;
  recentMedia(limit: number): Promise<IgMedia[]>;
  mediaInsights(mediaId: string, metrics: string[]): Promise<InsightValue[]>;
  accountTotals(metrics: string[], since: number, until: number): Promise<InsightValue[]>;
  accountBreakdown(metric: string, breakdown: string, since: number, until: number): Promise<BreakdownValue>;
  demographics(metric: string, breakdown: string, timeframe: string): Promise<BreakdownValue>;
}

export class ApiError extends Error {
  constructor(message: string, public code?: number, public status?: number) {
    super(redact(message));
  }
}

type FetchLike = typeof fetch;

/** レート制限（HTTP 429 / Graph エラーコード 4, 17, 32, 613）と一時的エラーは指数バックオフで再試行 */
async function getJson(url: string, fetchImpl: FetchLike, attempt = 0): Promise<unknown> {
  const res = await fetchImpl(url, { cache: "no-store" });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; code?: number } };
  if (res.ok && !body.error) return body;
  const code = body.error?.code;
  const retryable = res.status === 429 || res.status >= 500 || [4, 17, 32, 613].includes(code ?? -1);
  if (retryable && attempt < 3) {
    await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    return getJson(url, fetchImpl, attempt + 1);
  }
  throw new ApiError(body.error?.message || `HTTP ${res.status}`, code, res.status);
}

export function graphAdapter(accessToken: string, fetchImpl: FetchLike = fetch): InsightsAdapter {
  const u = (path: string, params: Record<string, string | number>) => {
    const url = new URL(GRAPH_BASE + path);
    for (const [k, v] of Object.entries(params)) url.searchParams.set(k, String(v));
    url.searchParams.set("access_token", accessToken);
    return url.toString();
  };
  return {
    async profile() {
      return (await getJson(u("/me", { fields: "user_id,username,followers_count,media_count" }), fetchImpl)) as IgProfile;
    },
    async recentMedia(limit) {
      const out: IgMedia[] = [];
      let next: string | undefined = u("/me/media", { fields: "id,caption,media_type,media_product_type,permalink,timestamp", limit: Math.min(limit, 50) });
      while (next && out.length < limit) {
        const page = (await getJson(next, fetchImpl)) as { data: IgMedia[]; paging?: { next?: string } };
        out.push(...page.data);
        next = page.paging?.next;
      }
      return out.slice(0, limit);
    },
    async mediaInsights(mediaId, metrics) {
      // 指標ごとに取得可否が異なるため1指標ずつ要求し、失敗理由を個別に残す
      const results: InsightValue[] = [];
      for (const m of metrics) {
        try {
          const r = (await getJson(u(`/${mediaId}/insights`, { metric: m }), fetchImpl)) as { data: { name: string; values?: { value: number }[]; total_value?: { value: number } }[] };
          const d = r.data?.[0];
          // 空の結果は「未取得」であって 0 ではない
          const v = d?.values?.[0]?.value ?? d?.total_value?.value;
          results.push({ name: m, value: typeof v === "number" ? v : null, error: d ? undefined : "空の結果（データ無し）" });
        } catch (e) {
          results.push({ name: m, value: null, error: (e as Error).message });
        }
      }
      return results;
    },
    async accountTotals(metrics, since, until) {
      const results: InsightValue[] = [];
      for (const m of metrics) {
        try {
          const r = (await getJson(u("/me/insights", { metric: m, period: "day", metric_type: "total_value", since, until }), fetchImpl)) as { data: { total_value?: { value: number } }[] };
          const v = r.data?.[0]?.total_value?.value;
          results.push({ name: m, value: typeof v === "number" ? v : null, error: r.data?.length ? undefined : "空の結果（データ無し）" });
        } catch (e) {
          results.push({ name: m, value: null, error: (e as Error).message });
        }
      }
      return results;
    },
    async accountBreakdown(metric, breakdown, since, until) {
      try {
        const r = (await getJson(u("/me/insights", { metric, period: "day", metric_type: "total_value", breakdown, since, until }), fetchImpl)) as BreakdownResponse;
        return parseBreakdown(metric, r);
      } catch (e) {
        return { name: metric, total: null, breakdown: {}, error: (e as Error).message };
      }
    },
    async demographics(metric, breakdown, timeframe) {
      try {
        const r = (await getJson(u("/me/insights", { metric, period: "lifetime", metric_type: "total_value", breakdown, timeframe }), fetchImpl)) as BreakdownResponse;
        return parseBreakdown(metric, r);
      } catch (e) {
        return { name: metric, total: null, breakdown: {}, error: (e as Error).message };
      }
    },
  };
}

type BreakdownResponse = { data: { total_value?: { value?: number; breakdowns?: { results?: { dimension_values: string[]; value: number }[] }[] } }[] };

function parseBreakdown(metric: string, r: BreakdownResponse): BreakdownValue {
  const tv = r.data?.[0]?.total_value;
  const breakdown: Record<string, number> = {};
  for (const res of tv?.breakdowns?.[0]?.results ?? []) breakdown[res.dimension_values.join(" / ")] = res.value;
  return { name: metric, total: typeof tv?.value === "number" ? tv.value : null, breakdown, error: tv ? undefined : "空の結果（データ無し）" };
}

/** OAuth: 認可コード → 短期トークン → 長期トークン（60日） */
export async function exchangeCode(code: string, fetchImpl: FetchLike = fetch) {
  const body = new URLSearchParams({
    client_id: process.env.META_APP_ID || "",
    client_secret: process.env.META_APP_SECRET || "",
    grant_type: "authorization_code",
    redirect_uri: process.env.META_REDIRECT_URI || "",
    code: code.replace(/#_$/, ""),
  });
  const res = await fetchImpl(OAUTH_TOKEN, { method: "POST", body, cache: "no-store" });
  const j = (await res.json().catch(() => ({}))) as { data?: { access_token: string; user_id: string; permissions: string | string[] }[]; access_token?: string; user_id?: string; permissions?: string | string[]; error_message?: string };
  const d = j.data?.[0] ?? j;
  if (!res.ok || !d.access_token) throw new ApiError(j.error_message || `トークン交換に失敗しました (HTTP ${res.status})`);
  const ll = new URL(LONG_LIVED);
  ll.searchParams.set("grant_type", "ig_exchange_token");
  ll.searchParams.set("client_secret", process.env.META_APP_SECRET || "");
  ll.searchParams.set("access_token", d.access_token);
  const long = (await getJson(ll.toString(), fetchImpl)) as { access_token: string; expires_in: number };
  const perms = Array.isArray(d.permissions) ? d.permissions : String(d.permissions || "").split(",").filter(Boolean);
  return { accessToken: long.access_token, expiresAt: new Date(Date.now() + long.expires_in * 1000), userId: String(d.user_id), permissions: perms };
}

export async function refreshToken(token: string, fetchImpl: FetchLike = fetch) {
  const url = new URL(REFRESH);
  url.searchParams.set("grant_type", "ig_refresh_token");
  url.searchParams.set("access_token", token);
  const r = (await getJson(url.toString(), fetchImpl)) as { access_token: string; expires_in: number };
  return { accessToken: r.access_token, expiresAt: new Date(Date.now() + r.expires_in * 1000) };
}

export function metaConfigured() {
  const missing = ["META_APP_ID", "META_APP_SECRET", "META_REDIRECT_URI", "TOKEN_ENCRYPTION_KEY"].filter((k) => !process.env[k]);
  return { ok: missing.length === 0, missing };
}
