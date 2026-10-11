import "server-only";
import crypto from "node:crypto";

/** アクセストークンを AES-256-GCM で暗号化して保存する。鍵は TOKEN_ENCRYPTION_KEY（base64, 32バイト） */
function key(): Buffer | null {
  const raw = process.env.TOKEN_ENCRYPTION_KEY;
  if (!raw) return null;
  const k = Buffer.from(raw, "base64");
  return k.length === 32 ? k : null;
}

export function encryptionReady() {
  return key() !== null;
}

export function encryptSecret(plain: string): string {
  const k = key();
  if (!k) throw new Error("TOKEN_ENCRYPTION_KEY が未設定または32バイトではありません");
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", k, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), enc.toString("base64")].join(".");
}

export function decryptSecret(blob: string): string {
  const k = key();
  if (!k) throw new Error("TOKEN_ENCRYPTION_KEY が未設定です");
  const [v, iv, tag, data] = blob.split(".");
  if (v !== "v1") throw new Error("未知の暗号形式");
  const d = crypto.createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}

/** ログ・エラーメッセージからトークンらしき文字列を除去 */
export function redact(s: string) {
  return s.replace(/(access_token=)[^&\s"]+/gi, "$1[REDACTED]").replace(/\b(IG|EA)[A-Za-z0-9]{40,}\b/g, "[REDACTED]");
}
