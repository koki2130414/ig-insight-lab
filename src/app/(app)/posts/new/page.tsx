import { getContext } from "@/lib/context";
import { targetsFor } from "@/lib/queries";
import { Card, Flash, PageHeader } from "@/components/ui";
import { PostForm } from "@/components/post-form";

export default async function NewPost({ searchParams }: { searchParams: Promise<{ ok?: string; err?: string; initiative?: string }> }) {
  const sp = await searchParams;
  const ctx = await getContext();
  const targets = await targetsFor(ctx, ctx.current.id);
  return (
    <>
      <PageHeader title={`投稿を登録｜${ctx.current.display_name}`} sub="登録後、投稿の詳細から24時間・72時間・7日の実績を入力できます。" />
      <Flash sp={sp} />
      <Card><PostForm acc={ctx.current} targets={targets} initiativeId={sp.initiative} /></Card>
    </>
  );
}
