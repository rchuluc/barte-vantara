import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";
import { tenantId } from "./fixtures";

const mocks = vi.hoisted(() => ({ tenants: vi.fn() }));
export const tenantBackend = mocks.tenants;

vi.mock("@/services/backend", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/services/backend")>();
  return {
    ...actual,
    backend: (...args: Parameters<typeof actual.backend>) =>
      args[0] === "tenants" ? mocks.tenants() : actual.backend(...args),
  };
});

beforeEach(() => {
  tenantBackend.mockReset().mockResolvedValue([
    {
      id: tenantId,
      slug: "vantara",
      name: "Vantara",
      primary: "#175C4C",
      domains: ["vantara.localhost", "vantara.com.br"],
    },
  ]);
});
vi.mock("server-only", () => ({}));
afterEach(cleanup);
