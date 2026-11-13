import { render, screen, fireEvent } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import RootLayout, { metadata } from "@/app/layout";
import { register } from "@/instrumentation";
import { registerOTel } from "@vercel/otel";
import { Card, CardAction, CardFooter } from "@/components/ui/card";

vi.mock("@vercel/otel", () => ({ registerOTel: vi.fn() }));

it("provides the document language, page content and metadata", () => {
  const document = new DOMParser().parseFromString(
    renderToStaticMarkup(
      <RootLayout>
        <main>Account overview</main>
      </RootLayout>,
    ),
    "text/html",
  );

  expect(document.documentElement.lang).toBe("en");
  expect(document.body.querySelector("main")?.textContent).toBe(
    "Account overview",
  );
  expect(metadata.title).toBe("Vantara");
  expect(metadata.description).toBe("Vantara foundations");
});

it("registers telemetry with the frontend service identity", () => {
  register();

  expect(registerOTel).toHaveBeenCalledExactlyOnceWith({
    serviceName: "vantara-frontend",
  });
});

it("supports interactive card actions and customizable footer content", () => {
  const onClick = vi.fn();

  render(
    <Card>
      <CardAction aria-label="Card actions" className="justify-self-start">
        <button onClick={onClick}>Refresh</button>
      </CardAction>
      <CardFooter role="status" className="px-8">
        Updated just now
      </CardFooter>
    </Card>,
  );

  fireEvent.click(screen.getByRole("button", { name: "Refresh" }));
  expect(onClick).toHaveBeenCalledOnce();
  expect(screen.getByLabelText("Card actions")).toHaveClass(
    "justify-self-start",
  );
  expect(screen.getByLabelText("Card actions")).not.toHaveClass(
    "justify-self-end",
  );
  expect(screen.getByRole("status")).toHaveTextContent("Updated just now");
  expect(screen.getByRole("status")).toHaveClass("px-8");
});
