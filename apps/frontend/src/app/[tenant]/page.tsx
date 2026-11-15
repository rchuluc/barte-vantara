import { redirect } from "next/navigation";

export default async function TenantHome({
  params,
}: {
  params: Promise<{ tenant: string }>;
}) {
  redirect(`/${(await params).tenant}/dashboard`);
}
