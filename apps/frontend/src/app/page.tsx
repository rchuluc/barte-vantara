import Link from "next/link";
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
  const workspaces = await tenants();
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>
            <h1>Choose your workspace</h1>
          </CardTitle>
          <CardDescription>
            Sign in to your organization’s workspace.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <nav aria-label="Workspaces" className="flex flex-col gap-3">
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
