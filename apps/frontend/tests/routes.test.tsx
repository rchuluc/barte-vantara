import { render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import TenantLayout, { generateMetadata } from "@/app/[tenant]/layout";
import TenantHome from "@/app/[tenant]/page";
import { useTenant } from "@/components/workspace-provider";
import { other } from "./fixtures";
import { tenantBackend } from "./setup";
import { createTranslator } from "next-intl";
import messages from "../messages/en.json";

vi.mock("next-intl/server", () => ({
  getTranslations: async (namespace: "login") =>
    createTranslator({ locale: "en", messages, namespace }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("not found");
  },
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
}));
afterEach(() => vi.unstubAllEnvs());

it("resolves tenant branding and makes only public display data available to components", async () => {
  tenantBackend.mockResolvedValue([
    {
      id: other.id,
      slug: "acme",
      name: "Acme",
      primary: "#FFFF00",
      domains: ["acme.test"],
    },
  ]);
  function Content() {
    const tenant = useTenant();
    return <p>{tenant.name}</p>;
  }
  const { container } = render(
    await TenantLayout({
      params: Promise.resolve({ tenant: "acme" }),
      children: <Content />,
    }),
  );
  expect(screen.getByText("Acme")).toBeInTheDocument();
  expect(
    await generateMetadata({ params: Promise.resolve({ tenant: "acme" }) }),
  ).toEqual({ title: "Acme", description: "Acme workspace" });
  expect(container.firstElementChild).toHaveStyle({
    "--primary": "#FFFF00",
    "--primary-foreground": "#000000",
  });
});

it.each(["development", "production"])(
  "returns not found without a redirect URL in %s",
  async (environment) => {
    vi.stubEnv("NODE_ENV", environment);
    vi.stubEnv("TENANT_NOT_FOUND_REDIRECT_URL", "");
    await expect(
      generateMetadata({ params: Promise.resolve({ tenant: "missing" }) }),
    ).rejects.toThrow("not found");
    await expect(
      TenantLayout({
        params: Promise.resolve({ tenant: "missing" }),
        children: null,
      }),
    ).rejects.toThrow("not found");
  },
);

it("redirects unknown workspace pages and metadata to the configured owner URL", async () => {
  vi.stubEnv("TENANT_NOT_FOUND_REDIRECT_URL", "https://owner.example/about");
  await expect(
    generateMetadata({ params: Promise.resolve({ tenant: "missing" }) }),
  ).rejects.toThrow("redirect:https://owner.example/about");
  await expect(
    TenantLayout({
      params: Promise.resolve({ tenant: "missing" }),
      children: null,
    }),
  ).rejects.toThrow("redirect:https://owner.example/about");
  expect(
    await generateMetadata({ params: Promise.resolve({ tenant: "vantara" }) }),
  ).toMatchObject({ title: "Vantara" });
});

it("redirects tenant roots into the dashboard", async () => {
  await expect(TenantHome()).rejects.toThrow("redirect:/dashboard");
});
