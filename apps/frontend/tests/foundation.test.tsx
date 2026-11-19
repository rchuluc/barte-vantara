import { render, screen } from "./render";
import { createTranslator } from "next-intl";
import messages from "../messages/en.json";
import { afterEach, describe, expect, it, vi } from "vitest";
import Home from "@/app/page";
import { getGreeting } from "@/services/greeting";
import { GET } from "@/app/api/health/route";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "home") =>
    createTranslator({ locale: "en", messages, namespace }),
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("backend integration boundary", () => {
  it("offers workspaces returned by the backend", async () => {
    render(await Home());
    expect(screen.getByRole("link", { name: "Vantara" })).toHaveAttribute(
      "href",
      "https://vantara.localhost/login",
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
    await expect(getGreeting()).rejects.toThrow("Backend unavailable");
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
