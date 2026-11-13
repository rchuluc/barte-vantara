import { getGreeting } from "@/lib/backend";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export const dynamic = "force-dynamic";

export default async function Home() {
  let message: string;

  try {
    message = await getGreeting();
  } catch {
    message = "Backend temporarily unavailable. Please try again shortly.";
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center p-6">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>Vantara</CardTitle>
          <CardDescription>Project foundations</CardDescription>
        </CardHeader>
        <CardContent>
          <p>{message}</p>
        </CardContent>
      </Card>
    </main>
  );
}
