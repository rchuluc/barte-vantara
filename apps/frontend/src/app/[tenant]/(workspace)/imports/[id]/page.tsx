import { notFound } from "next/navigation";
import { z } from "zod";
import { ImportDetail } from "@/components/import-detail";

export default async function ImportPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  if (!z.uuid().safeParse(id).success) notFound();

  return <ImportDetail id={id} />;
}
