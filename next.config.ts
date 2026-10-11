import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 単一ユーザーのローカル分析アプリのため、Cache Components は使わず
  // すべてのページをリクエスト時に描画する（cookies() を使うページは自動で動的になる）
  cacheComponents: false,
  serverExternalPackages: ["@electric-sql/pglite", "pg"],
  poweredByHeader: false,
  // 起動時に読むスキーマファイルをサーバーの配布物に含める（Vercel 用）
  outputFileTracingIncludes: { "/**": ["./db/schema.sql"] },
  experimental: {
    // 取り込みは画面側で2MB・5000行に制限。パース後のJSONが収まるよう余裕を持たせる
    serverActions: { bodySizeLimit: "4mb" },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
