import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export function RequestError({
  error,
  retry,
}: {
  error: Error;
  retry?: () => void;
}) {
  return (
    <Alert variant="destructive">
      <AlertTitle>Something needs your attention</AlertTitle>
      <AlertDescription>
        {error.message}
        {retry && (
          <Button variant="outline" onClick={retry}>
            Try again
          </Button>
        )}
      </AlertDescription>
    </Alert>
  );
}

export function Loading() {
  return (
    <p role="status" className="p-8 text-muted-foreground">
      Loading your workspace…
    </p>
  );
}
