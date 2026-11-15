import { afterEach, expect, it, vi } from "vitest";
import { workspace } from "@/services/workspace";
import { statusMessage } from "@/lib/contracts";

afterEach(() => vi.unstubAllGlobals());

it("offers recoverable network failure feedback", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network")));
  await expect(workspace.me()).rejects.toThrow("Check your connection");
});

it("rejects malformed response shapes", async () => {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(Response.json({ email: "invalid" })),
  );
  await expect(workspace.me()).rejects.toThrow("Invalid response");
});

it("gives an actionable rate-limit message", () => {
  expect(statusMessage(429)).toContain("Wait a moment");
});

it("does not leak HTML or JSON parser errors to users", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue(new Response("<html>Internal gateway error</html>")),
  );
  await expect(workspace.me()).rejects.toThrow(
    "Invalid response. Please try again.",
  );
});
