import { afterEach, describe, expect, it, vi } from "vitest";

const init = vi.fn();

vi.mock("@datadog/browser-rum", () => ({ datadogRum: { init } }));

describe("DatadogRum", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
    init.mockClear();
  });

  it("initializes RUM when credentials are configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_DD_APPLICATION_ID", "app-id");
    vi.stubEnv("NEXT_PUBLIC_DD_CLIENT_TOKEN", "pub-token");

    const { DatadogRum } = await import("@/components/datadog-rum");

    expect(DatadogRum()).toBeNull();
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: "app-id",
        clientToken: "pub-token",
        service: "vantara-frontend",
      }),
    );
  });

  it("does not initialize RUM without credentials", async () => {
    vi.stubEnv("NEXT_PUBLIC_DD_APPLICATION_ID", "");
    vi.stubEnv("NEXT_PUBLIC_DD_CLIENT_TOKEN", "");

    await import("@/components/datadog-rum");

    expect(init).not.toHaveBeenCalled();
  });
});
