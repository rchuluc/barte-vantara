export async function getGreeting(): Promise<string> {
  const response = await fetch(
    `${process.env.BACKEND_URL ?? "http://localhost:8080"}/api/hello`,
    {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    },
  );

  if (!response.ok) throw new Error("Backend unavailable");

  const data: unknown = await response.json();

  if (
    typeof data !== "object" ||
    data === null ||
    !("message" in data) ||
    typeof data.message !== "string"
  ) {
    throw new Error("Invalid backend response");
  }

  return data.message;
}
