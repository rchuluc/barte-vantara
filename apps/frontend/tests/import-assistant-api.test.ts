// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { POST } from "@/app/api/[...resource]/route";
import { importer } from "./import-fixtures";

const mocks = vi.hoisted(() => ({ extract: vi.fn(), model: vi.fn() }));
vi.mock("@/services/unstructured-extraction", () => ({
  extractUnstructured: mocks.extract,
}));
vi.mock("@openrouter/ai-sdk-provider", () => ({
  createOpenRouter: () => mocks.model,
}));

const fetchMock = vi.fn<typeof fetch>();
const message = {
  id: "user-1",
  role: "user",
  parts: [{ type: "text", text: "NF 001: R$ 12,00" }],
};

function call(
  body: unknown = { messages: [message] },
  headers: Record<string, string> = {},
) {
  return POST(
    new NextRequest("http://vantara.localhost:3000/api/imports/assistant", {
      method: "POST",
      headers: {
        host: "vantara.localhost:3000",
        origin: "http://vantara.localhost:3000",
        cookie: "vantara-vantara=token",
        ...headers,
      },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ resource: ["imports", "assistant"] }) },
  );
}

const usage = {
  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 10, text: 10, reasoning: 0 },
};

function response(parts: LanguageModelV4StreamPart[]) {
  return {
    stream: new ReadableStream<LanguageModelV4StreamPart>({
      start(controller) {
        for (const part of parts) controller.enqueue(part);
        controller.close();
      },
    }),
  };
}

function agentModel(messageNumber = 1, duplicate = false) {
  const model = new MockLanguageModelV4({
    doStream: [
      response([
        {
          type: "tool-call",
          toolCallId: "extract-1",
          toolName: "extractEvidence",
          input: JSON.stringify({ messageNumber }),
        },
        ...(duplicate
          ? [
              {
                type: "tool-call" as const,
                toolCallId: "extract-2",
                toolName: "extractEvidence",
                input: JSON.stringify({ messageNumber }),
              },
            ]
          : []),
        {
          type: "finish",
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
          usage,
        },
      ]),
      response([
        { type: "text-start", id: "reply" },
        {
          type: "text-delta",
          id: "reply",
          delta: "I found invoice 001 for R$ 12,00. What year is the due date?",
        },
        { type: "text-end", id: "reply" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage,
        },
      ]),
    ],
  });
  mocks.model.mockReturnValue(model);
  return model;
}

beforeEach(() => {
  vi.stubEnv("OPENROUTER_MODEL", "test/model");
  vi.stubEnv("OPENROUTER_API_KEY", "private-key");
  fetchMock.mockReset().mockResolvedValue(Response.json(importer));
  vi.stubGlobal("fetch", fetchMock);
  mocks.extract.mockReset().mockResolvedValue({
    status: "succeeded",
    attemptId: "attempt-1",
    parsed: {
      classification: "invoice",
      documents: [{ value: "001", quote: "NF 001" }],
      amounts: [
        {
          kind: "original",
          value: "12.00",
          currency: "BRL",
          quote: "R$ 12,00",
        },
        { kind: "mentioned", value: "10.00", currency: null, quote: "10" },
      ],
      dates: [
        { kind: "due", iso: null, raw: "tomorrow", quote: "tomorrow" },
        {
          kind: "issued",
          iso: "2026-11-16",
          raw: "16/11/2026",
          quote: "16/11/2026",
        },
      ],
      attachments: [{ value: "invoice.pdf", quote: "invoice.pdf" }],
      claims: [{ kind: "payment", description: "Paid", quote: "paid" }],
      issues: ["Missing due date"],
    },
  });
  agentModel();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("automatically extracts original source through a tool and streams a conversational reply", async () => {
  const model = agentModel();
  const response = await call();
  expect(response.status).toBe(200);
  expect(response.headers.get("x-vercel-ai-ui-message-stream")).toBe("v1");
  const text = await response.text();
  expect(text).toContain("I found invoice 001");
  expect(text).not.toContain("tool-call");
  expect(model.doStreamCalls).toHaveLength(2);
  expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain(
    '"saved":false',
  );
  expect(text).not.toContain("private-key");
  expect(mocks.extract).toHaveBeenCalledWith(
    message.parts[0].text,
    expect.any(AbortSignal),
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it.each([
  [{}, 400],
  [{ messages: [] }, 400],
  [{ messages: [{ ...message, role: "system" }] }, 400],
  [{ messages: [{ ...message, role: "assistant" }] }, 400],
  [
    {
      messages: [
        {
          ...message,
          parts: [{ type: "file", url: "https://example.com/private" }],
        },
      ],
    },
    400,
  ],
  [{ messages: [{ ...message, parts: [{ type: "text", text: " " }] }] }, 400],
  [
    {
      messages: [
        { ...message, parts: [{ type: "text", text: "a".repeat(64001) }] },
      ],
    },
    400,
  ],
  [{ messages: Array.from({ length: 41 }, () => message) }, 400],
  [{ oversized: "a".repeat(262145) }, 400],
])(
  "rejects invalid or unbounded input before inference",
  async (body, status) => {
    expect((await call(body)).status).toBe(status);
    expect(mocks.extract).not.toHaveBeenCalled();
  },
);

it.each([
  [{ cookie: "" }, 401],
  [{ origin: "https://other.example" }, 403],
  [{ host: "unknown.example" }, 404],
])(
  "requires tenant authentication and same-origin requests",
  async (headers, status) => {
    expect((await call(undefined, headers)).status).toBe(status);
    expect(mocks.extract).not.toHaveBeenCalled();
  },
);

it.each([
  { permissions: [] },
  { active: false },
  { tenant_id: "11111111-1111-4111-8111-111111111111" },
])(
  "requires an active tenant member with payable permission",
  async (overrides) => {
    fetchMock
      .mockReset()
      .mockResolvedValue(Response.json({ ...importer, ...overrides }));
    expect((await call()).status).toBe(403);
    expect(mocks.extract).not.toHaveBeenCalled();
  },
);

it.each(["OPENROUTER_MODEL", "OPENROUTER_API_KEY"])(
  "requires %s server configuration",
  async (name) => {
    vi.stubEnv(name, "");
    expect((await call()).status).toBe(503);
  },
);

it("lets the agent explain an extraction failure without returning fabricated facts", async () => {
  const model = agentModel();
  mocks.extract.mockResolvedValue({ status: "failed", parsed: null });
  await (await call()).text();
  expect(JSON.stringify(model.doStreamCalls[1].prompt)).toContain(
    "Could not reliably extract facts",
  );
});

it("streams follow-up answers without repeating extraction", async () => {
  mocks.model.mockReturnValue(
    new MockLanguageModelV4({
      doStream: async () => ({
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: "text-start", id: "text-1" });
            controller.enqueue({
              type: "text-delta",
              id: "text-1",
              delta: "Review the due date.",
            });
            controller.enqueue({ type: "text-end", id: "text-1" });
            controller.close();
          },
        }),
      }),
    }),
  );
  const response = await call({
    messages: [
      message,
      {
        id: "assistant-1",
        role: "assistant",
        parts: [{ type: "text", text: "Missing date" }],
      },
      { ...message, id: "user-2" },
    ],
  });
  expect(await response.text()).toContain("Review the due date.");
  expect(mocks.extract).not.toHaveBeenCalled();
});

it("bounds extraction to one original source per turn", async () => {
  agentModel(1, true);
  await (await call()).text();
  expect(mocks.extract).toHaveBeenCalledTimes(1);
});

it("rejects fabricated message references before running extraction", async () => {
  agentModel(99);
  await (await call()).text();
  expect(mocks.extract).not.toHaveBeenCalled();
});

it("reports an empty model response instead of silently succeeding", async () => {
  mocks.model.mockReturnValue(
    new MockLanguageModelV4({ doStream: async () => response([]) }),
  );
  expect(await (await call()).text()).toContain("assistant is unavailable");
});

it("does not expose provider errors in chat streams", async () => {
  mocks.model.mockReturnValue(
    new MockLanguageModelV4({
      doStream: async () => {
        throw new Error("private-key");
      },
    }),
  );
  const text = await (await call({ messages: [message] })).text();
  expect(text).toContain("assistant is unavailable");
  expect(text).not.toContain("private-key");
});
