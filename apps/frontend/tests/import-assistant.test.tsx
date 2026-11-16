import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createUIMessageStream, createUIMessageStreamResponse } from "ai";
import { ImportAssistant } from "@/components/import-assistant";
import { importId, unitId } from "./import-fixtures";

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async () =>
    createUIMessageStreamResponse({
      stream: createUIMessageStream({
        execute: ({ writer }) => {
          writer.write({ type: "text-start", id: "answer" });
          writer.write({
            type: "text-delta",
            id: "answer",
            delta: "I found invoice 001. What year is the due date?",
          });
          writer.write({ type: "text-end", id: "answer" });
        },
      }),
    }),
  );
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function open(onImported?: () => void) {
  render(
    <>
      <button>Page action</button>
      <ImportAssistant onImported={onImported} />
    </>,
  );
  fireEvent.click(screen.getByRole("button", { name: "Import assistant" }));
}

function type(text: string) {
  fireEvent.change(screen.getByLabelText("Message Vantara"), {
    target: { value: text },
  });
}

function file(text = "NF 001") {
  const result = new File([text], "invoice.txt", { type: "text/plain" });
  Object.defineProperty(result, "arrayBuffer", {
    value: async () => new TextEncoder().encode(text).buffer,
  });
  return result;
}

it("opens a nonmodal chat with one composer and keeps the imports page interactive", async () => {
  open();
  expect(screen.getByRole("dialog", { name: "Vantara" })).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "Page action" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
  type("NF 001");
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("I found invoice 001. What year is the due date?");
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toMatchObject({
    messages: [{ role: "user", parts: [{ type: "text", text: "NF 001" }] }],
  });
  fireEvent.click(screen.getByRole("button", { name: "Close assistant" }));
  fireEvent.click(screen.getByRole("button", { name: "Import assistant" }));
  expect(screen.getByText("NF 001")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "New chat" }));
  expect(screen.queryByText("NF 001")).not.toBeInTheDocument();
});

it("sends a conversation starter without a separate mode", async () => {
  open();
  fireEvent.click(screen.getByRole("button", { name: "What can I upload?" }));
  await screen.findByText("I found invoice 001. What year is the due date?");
  const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
  expect(body.messages[0].parts[0].text).toBe("What can I upload?");
  expect(body.analyze).toBeUndefined();
});

it("sends on Enter and preserves Shift+Enter and IME composition", async () => {
  open();
  type("Hello");
  fireEvent.keyDown(screen.getByLabelText("Message Vantara"), {
    key: "Enter",
    shiftKey: true,
  });
  fireEvent.keyDown(screen.getByLabelText("Message Vantara"), {
    key: "Enter",
    isComposing: true,
  });
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.keyDown(screen.getByLabelText("Message Vantara"), { key: "Enter" });
  await screen.findByText("I found invoice 001. What year is the due date?");
});

it("attaches a text file without replacing the message, and supports removal", async () => {
  open();
  type("Please check this");
  fireEvent.change(screen.getByLabelText("Source file"), {
    target: { files: [file()] },
  });
  await screen.findByText("invoice.txt");
  expect(screen.getByLabelText("Message Vantara")).toHaveValue(
    "Please check this",
  );
  expect(fetchMock).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Remove attachment" }));
  expect(screen.queryByText("invoice.txt")).not.toBeInTheDocument();
  fireEvent.change(screen.getByLabelText("Source file"), {
    target: { files: [file()] },
  });
  await screen.findByText("invoice.txt");
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("I found invoice 001. What year is the due date?");
  expect(
    JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).messages[0].parts[0]
      .text,
  ).toBe("Please check this\n\nNF 001");
});

it("sends an attachment without requiring a typed message", async () => {
  open();
  fireEvent.change(screen.getByLabelText("Source file"), {
    target: { files: [file()] },
  });
  await screen.findByText("invoice.txt");
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await screen.findByText("I found invoice 001. What year is the due date?");
  expect(
    JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).messages[0].parts[0]
      .text,
  ).toContain("NF 001");
});

it.each([
  new File(["PDF"], "invoice.pdf"),
  new File([], "empty.txt"),
  new File(["a".repeat(64001)], "large.txt"),
])("rejects unsupported, empty and oversized files", async (source) => {
  open();
  fireEvent.change(screen.getByLabelText("Source file"), {
    target: { files: [source] },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Choose a nonempty",
  );
  expect(fetchMock).not.toHaveBeenCalled();
});

it("reports unreadable text without losing the draft", async () => {
  open();
  type("draft");
  const source = new File(["bad"], "bad.txt");
  Object.defineProperty(source, "arrayBuffer", {
    value: async () => new Uint8Array([255]).buffer,
  });
  fireEvent.change(screen.getByLabelText("Source file"), {
    target: { files: [source] },
  });
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "could not be read",
  );
  expect(screen.getByLabelText("Message Vantara")).toHaveValue("draft");
});

it("rejects a combined attachment and message beyond the request limit", async () => {
  open();
  type("a".repeat(64000));
  fireEvent.change(screen.getByLabelText("Source file"), {
    target: { files: [file()] },
  });
  await screen.findByText("invoice.txt");
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("too long");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("retries a failed message without making the user retype it", async () => {
  fetchMock.mockRejectedValue(new Error("offline"));
  open();
  type("NF 001");
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "couldn’t complete",
  );
  expect(screen.getByText("NF 001")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Retry message" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
  await screen.findByRole("alert");
});

it("stops an in-flight response and enables the composer again", async () => {
  fetchMock.mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options?.signal?.addEventListener("abort", () =>
          reject(new DOMException("Stopped", "AbortError")),
        );
      }),
  );
  open();
  type("NF 001");
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  expect(await screen.findByRole("status")).toHaveTextContent("Thinking");
  fireEvent.click(screen.getByRole("button", { name: "Stop response" }));
  await waitFor(() =>
    expect(screen.getByLabelText("Message Vantara")).toBeEnabled(),
  );
  expect(fetchMock.mock.calls[0][1]?.signal?.aborted).toBe(true);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});

function approvalResponse() {
  return createUIMessageStreamResponse({
    stream: createUIMessageStream({
      execute: ({ writer }) => {
        writer.write({ type: "start", messageId: "proposal" });
        writer.write({
          type: "tool-input-available",
          toolCallId: "units",
          toolName: "listBusinessUnits",
          input: {},
        });
        writer.write({
          type: "tool-output-available",
          toolCallId: "units",
          output: [{ id: unitId, name: "Main" }],
        });
        writer.write({
          type: "tool-input-available",
          toolCallId: "save",
          toolName: "createImport",
          input: {
            unitId,
            currency: "BRL",
            rows: [
              {
                sourceMessageNumber: 1,
                party_name: "Supplier",
                document_ref: "0001",
                amount: "12.00",
                due_on: "2026-12-01",
              },
            ],
          },
        });
        writer.write({
          type: "tool-approval-request",
          toolCallId: "save",
          approvalId: "approval",
          signature: "signed",
        });
      },
    }),
  });
}

it.each([true, false])(
  "shows a record review and resumes only after explicit confirmation (%s)",
  async (approved) => {
    fetchMock
      .mockImplementationOnce(async () => approvalResponse())
      .mockImplementationOnce(async () =>
        createUIMessageStreamResponse({
          stream: createUIMessageStream({
            execute: ({ writer }) => {
              writer.write({ type: "start", messageId: "proposal" });
              if (approved)
                writer.write({
                  type: "tool-output-available",
                  toolCallId: "save",
                  output: {
                    id: importId,
                    state: "completed",
                    total: 1,
                    processed: 1,
                    rejected: 0,
                  },
                });
              else
                writer.write({
                  type: "tool-output-denied",
                  toolCallId: "save",
                });
            },
          }),
        }),
      );
    const onImported = vi.fn();
    open(onImported);
    type("Import invoice 0001");
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Confirm import" }),
      ).toBeEnabled(),
    );
    expect(screen.getByRole("listitem")).toHaveTextContent(
      "Supplier · 0001BRL 12.00 · Due 2026-12-01",
    );
    expect(screen.getByText("Destination: Main")).toBeInTheDocument();
    expect(screen.getByLabelText("Message Vantara")).toBeDisabled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    fireEvent.click(
      screen.getByRole("button", {
        name: approved ? "Confirm import" : "Cancel import",
      }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const body = JSON.parse(String(fetchMock.mock.calls[1][1]?.body));
    expect(body.messages.at(-1).parts).toContainEqual(
      expect.objectContaining({
        state: "approval-responded",
        approval: { id: "approval", signature: "signed", approved },
      }),
    );
    if (approved)
      expect(
        await screen.findByRole("link", { name: "Review import" }),
      ).toHaveAttribute("href", `/imports/${importId}`);
    else
      expect(
        await screen.findByText("Import cancelled. Nothing was saved."),
      ).toBeInTheDocument();
    expect(onImported).toHaveBeenCalledTimes(approved ? 1 : 0);
    if (approved) {
      expect(screen.getByText("Confirmed by you")).toBeInTheDocument();
      expect(screen.getByText("Import result")).toBeInTheDocument();
      expect(
        screen.queryByText("Import 1 payable record(s)?"),
      ).not.toBeInTheDocument();
    }
  },
);

it("offers a retry of the same approved call after a save error", async () => {
  fetchMock
    .mockImplementationOnce(async () => approvalResponse())
    .mockImplementationOnce(async () =>
      createUIMessageStreamResponse({
        stream: createUIMessageStream({
          execute: ({ writer }) => {
            writer.write({ type: "start", messageId: "proposal" });
            writer.write({
              type: "tool-output-error",
              toolCallId: "save",
              errorText: "Unavailable",
            });
          },
        }),
      }),
    );
  open();
  type("Import invoice 0001");
  fireEvent.click(screen.getByRole("button", { name: "Send message" }));
  await waitFor(() =>
    expect(
      screen.getByRole("button", { name: "Confirm import" }),
    ).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm import" }));
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "Retry import" })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Retry import" }));
  expect(screen.getByRole("button", { name: "Confirm import" })).toBeEnabled();
  expect(fetchMock).toHaveBeenCalledTimes(2);
});
