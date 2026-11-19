import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LocaleSelector } from "@/components/locale-selector";
import { tenants } from "@/lib/tenants";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function Home() {
  const t = await getTranslations("home");
  const workspaces = await tenants();
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>
            <h1>{t("title")}</h1>
          </CardTitle>
          <CardDescription>{t("description")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-6">
          <LocaleSelector />
          <nav aria-label={t("workspaces")} className="flex flex-col gap-3">
            {workspaces.map((tenant) => (
              <Button key={tenant.slug} asChild variant="outline">
                <Link href={`https://${tenant.domains[0]}/login`}>
                  {tenant.name}
                </Link>
              </Button>
            ))}
          </nav>
        </CardContent>
      </Card>
    </main>
  );
}
