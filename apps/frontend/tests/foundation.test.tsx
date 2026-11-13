import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import { getGreeting } from "@/lib/backend";
import { GET } from "@/app/api/health/route";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("backend integration boundary", () => {
  it("renders the database greeting", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ message: "Hello database" })),
    );
    render(await Home());
    expect(screen.getByText("Hello database")).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(
      "http://localhost:8080/api/hello",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it("uses the private backend URL", async () => {
    vi.stubEnv("BACKEND_URL", "http://backend:8080");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json({ message: "hello" })),
    );
    expect(await getGreeting()).toBe("hello");
    expect(fetch).toHaveBeenCalledWith(
      "http://backend:8080/api/hello",
      expect.anything(),
    );
  });

  it("shows an honest fallback on HTTP failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );
    render(await Home());
    expect(screen.getByText(/temporarily unavailable/)).toBeInTheDocument();
  });

  it.each([null, "bad", {}, { message: 1 }])(
    "rejects malformed JSON: %j",
    async (data) => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(data)));

      await expect(getGreeting()).rejects.toThrow("Invalid backend response");
    },
  );

  it("propagates network failures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("timeout")));

    await expect(getGreeting()).rejects.toThrow("timeout");
  });

  it("exposes a process health probe", async () => {
    expect(await GET().json()).toEqual({ status: "ok" });
  });
});
