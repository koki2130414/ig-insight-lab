import { savePost } from "@/app/actions";
import { Field, Options } from "@/components/ui";
import { Submit } from "@/components/client";
import { FORMATS, PURPOSES } from "@/lib/catalog";
import type { Account } from "@/lib/context";
import type { PostRow } from "@/lib/queries";
import type { Target } from "@/lib/queries";
import { toJstLocalInput } from "@/lib/time";

const yn = (v: boolean | null | undefined) => (v === true ? "1" : v === false ? "0" : "");

export function PostForm({ acc, targets, post, initiativeId }: { acc: Account; targets: Target[]; post?: PostRow; initiativeId?: string }) {
  return (
    <form action={savePost} className="space-y-4">
      <input type="hidden" name="account_id" value={acc.id} />
      {post && <input type="hidden" name="id" value={post.id} />}
      {initiativeId && <input type="hidden" name="initiative_id" value={initiativeId} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="投稿URL" hint="同じURLは二重登録されません"><input name="url" type="url" defaultValue={post?.url ?? ""} className="field" placeholder="https://www.instagram.com/reel/..." /></Field>
        <Field label="投稿日時（日本時間）*"><input name="posted_at" type="datetime-local" required defaultValue={toJstLocalInput(post?.posted_at ?? null)} className="field" /></Field>
        <Field label="形式*">
          <select name="format" required defaultValue={post?.format ?? "reel"} className="field"><Options map={FORMATS} /></select>
        </Field>
        <Field label="目的">
          <select name="purpose" defaultValue={post?.purpose ?? ""} className="field"><Options map={PURPOSES} empty="未設定" /></select>
        </Field>
        <Field label="テーマ"><input name="theme" defaultValue={post?.theme ?? ""} className="field" placeholder="例: 米づくりの裏側" /></Field>
        <Field label="想定ターゲット">
          <select name="target_id" defaultValue={post?.target_id ?? ""} className="field">
            <option value="">未設定</option>
            {targets.map((t) => <option key={t.id} value={t.id}>{t.layer === "desired" ? "届けたい層: " : "現在の層: "}{t.name}</option>)}
          </select>
        </Field>
        <Field label="冒頭の言葉" className="sm:col-span-2"><input name="hook" defaultValue={post?.hook ?? ""} className="field" /></Field>
        <Field label="動画尺（秒）"><input name="duration_sec" inputMode="decimal" defaultValue={post?.duration_sec ?? ""} className="field num" /></Field>
        <Field label="CTA"><input name="cta" defaultValue={post?.cta ?? ""} className="field" placeholder="例: プロフィールのリンクから" /></Field>
        <Field label="構成" className="sm:col-span-2"><textarea name="structure" rows={2} defaultValue={post?.structure ?? ""} className="field" /></Field>
        <Field label="投稿文" className="sm:col-span-2"><textarea name="caption" rows={3} defaultValue={post?.caption ?? ""} className="field" /></Field>
        <Field label="コラボ相手"><input name="collaborator" defaultValue={post?.collaborator ?? ""} className="field" /></Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="広告利用">
            <select name="is_ad" defaultValue={yn(post?.is_ad)} className="field"><option value="">未入力</option><option value="0">なし</option><option value="1">あり</option></select>
          </Field>
          <Field label="プレゼント企画">
            <select name="is_giveaway" defaultValue={yn(post?.is_giveaway)} className="field"><option value="">未入力</option><option value="0">なし</option><option value="1">あり</option></select>
          </Field>
        </div>
        <Field label="制作時間（分）"><input name="production_minutes" inputMode="numeric" defaultValue={post?.production_minutes ?? ""} className="field num" /></Field>
        <Field label="制作費（円）"><input name="production_cost" inputMode="numeric" defaultValue={post?.production_cost ?? ""} className="field num" /></Field>
      </div>
      <Submit>{post ? "投稿情報を保存" : "投稿を登録"}</Submit>
    </form>
  );
}
