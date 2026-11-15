import { redirect } from "next/navigation";

export default async function TenantHome() {
  redirect("/dashboard");
}
