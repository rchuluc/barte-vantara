// @vitest-environment node
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { MockLanguageModelV4 } from "ai/test";
import type { LanguageModelV4StreamPart } from "@ai-sdk/provider";
import { readUIMessageStream, type UIMessage, type UIMessageChunk } from "ai";
import { POST } from "@/app/api/[...resource]/route";
import { importer, job, unitId } from "./import-fixtures";

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

it.each(["pt-BR", "en", "es", "invalid"])(
  "uses the validated %s interface language in the assistant prompt",
  async (locale) => {
    const model = agentModel();
    const result = await call(undefined, {
      cookie: `vantara-vantara=token; vantara-locale=${locale}`,
    });
    await result.text();
    expect(JSON.stringify(model.doStreamCalls[0].prompt)).toContain(
      `selected interface language: ${locale === "invalid" ? "pt-BR" : locale}`,
    );
  },
);

beforeEach(() => {
  vi.stubEnv("OPENROUTER_MODEL", "test/model");
  vi.stubEnv("OPENROUTER_API_KEY", "private-key");
  fetchMock.mockReset().mockImplementation(async () => Response.json(importer));
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

const proposedImport = {
  unitId,
  currency: "BRL",
  rows: [
    {
      sourceMessageNumber: 1,
      party_name: "Supplier",
      document_ref: "001",
      due_on: "2026-12-01",
      amount: "12.00",
    },
  ],
};

async function proposeImport() {
  mocks.model.mockReturnValue(
    new MockLanguageModelV4({
      doStream: async () =>
        response([
          {
            type: "tool-call",
            toolCallId: "save-1",
            toolName: "createImport",
            input: JSON.stringify(proposedImport),
          },
          {
            type: "finish",
            finishReason: { unified: "tool-calls", raw: "tool_calls" },
            usage,
          },
        ]),
    }),
  );
  const text = await (await call()).text();
  const chunks: UIMessageChunk[] = text
    .split("\n")
    .filter((line) => line.startsWith("data: ") && !line.includes("[DONE]"))
    .map((line) => JSON.parse(line.slice(6)));
  let message: UIMessage | undefined;
  for await (const current of readUIMessageStream({
    stream: new ReadableStream({
      start(controller) {
        chunks.forEach((chunk) => controller.enqueue(chunk));
        controller.close();
      },
    }),
  }))
    message = current;
  if (!message) throw new Error("Missing proposal");
  expect(message.id, JSON.stringify(message)).not.toBe("");
  return message;
}

function respondToApproval(proposal: UIMessage, approved: boolean) {
  return {
    ...proposal,
    parts: proposal.parts.map((part) =>
      part.type === "tool-createImport" && part.state === "approval-requested"
        ? {
            ...part,
            state: "approval-responded",
            approval: { ...part.approval, approved },
          }
        : part,
    ),
  };
}

function saveModel() {
  const model = new MockLanguageModelV4({
    doStream: async () =>
      response([
        { type: "text-start", id: "done" },
        { type: "text-delta", id: "done", delta: "Import result reviewed." },
        { type: "text-end", id: "done" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage,
        },
      ]),
  });
  mocks.model.mockReturnValue(model);
  return model;
}

it("pauses the write tool for signed human approval, then saves structured records through the backend", async () => {
  const proposal = await proposeImport();
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(proposal.parts).toContainEqual(
    expect.objectContaining({
      type: "tool-createImport",
      state: "approval-requested",
      approval: expect.objectContaining({ signature: expect.any(String) }),
    }),
  );
  fetchMock.mockImplementation(async (url, options) => {
    const path = String(url);
    if (path.endsWith("/me")) return Response.json(importer);
    if (path.endsWith("/business-units"))
      return Response.json([{ id: unitId, name: "Main" }]);
    const id =
      new Headers(options?.headers).get("Idempotency-Key") ??
      path.split("/").at(-2);
    return Response.json({
      ...job,
      id,
      state: path.endsWith("/process")
        ? "completed"
        : path.endsWith("/confirm")
          ? "processing"
          : "mapping",
      processed: path.endsWith("/process") ? 1 : 0,
    });
  });
  const model = saveModel();
  const result = await (
    await call({ messages: [message, respondToApproval(proposal, true)] })
  ).text();
  expect(result).toContain('"state":"completed"');
  expect(result).toContain('"confirmation":"user_approved"');
  expect(JSON.stringify(model.doStreamCalls[0].prompt)).toContain(
    '"confirmation":"user_approved"',
  );
  const upload = fetchMock.mock.calls.find(([url]) =>
    String(url).includes("filename=assistant-import.csv"),
  );
  expect(upload).toBeDefined();
  expect(new TextDecoder().decode(upload![1]!.body as ArrayBuffer)).toContain(
    '"Supplier","001","2026-12-01","12.00"',
  );
  expect(new TextDecoder().decode(upload![1]!.body as ArrayBuffer)).toContain(
    "NF 001: R$ 12,00",
  );
  expect(new Headers(upload![1]!.headers).get("Authorization")).toBe(
    "Bearer token",
  );
});

it("cancelling an import never calls a backend write", async () => {
  const proposal = await proposeImport();
  saveModel();
  const result = await (
    await call({ messages: [message, respondToApproval(proposal, false)] })
  ).text();
  expect(result).toContain("tool-output-denied");
  expect(result).not.toContain('"confirmation":"user_approved"');
  expect(
    fetchMock.mock.calls.every(([url]) => String(url).endsWith("/me")),
  ).toBe(true);
});

it("rejects altered approved inputs before a backend write", async () => {
  const proposal = respondToApproval(await proposeImport(), true);
  proposal.parts = proposal.parts.map((part) =>
    part.type === "tool-createImport"
      ? { ...part, input: { ...proposedImport, currency: "USD" } }
      : part,
  );
  saveModel();
  await (await call({ messages: [message, proposal] })).text();
  expect(
    fetchMock.mock.calls.every(([url]) => String(url).endsWith("/me")),
  ).toBe(true);
});

it("lists authorized business units through a read-only agent tool", async () => {
  fetchMock.mockImplementation(async (url) =>
    Response.json(
      String(url).endsWith("/me") ? importer : [{ id: unitId, name: "Main" }],
    ),
  );
  const model = new MockLanguageModelV4({
    doStream: [
      response([
        {
          type: "tool-call",
          toolCallId: "units",
          toolName: "listBusinessUnits",
          input: "{}",
        },
        {
          type: "finish",
          finishReason: { unified: "tool-calls", raw: "tool_calls" },
          usage,
        },
      ]),
      response([
        { type: "text-start", id: "question" },
        {
          type: "text-delta",
          id: "question",
          delta: "Which business unit should receive this import?",
        },
        { type: "text-end", id: "question" },
        {
          type: "finish",
          finishReason: { unified: "stop", raw: "stop" },
          usage,
        },
      ]),
    ],
  });
  mocks.model.mockReturnValue(model);
  expect(await (await call()).text()).toContain('"name":"Main"');
  expect(
    new Headers(fetchMock.mock.calls[1][1]?.headers).get("Authorization"),
  ).toBe("Bearer token");
  expect(fetchMock.mock.calls[1][1]?.method).toBe("GET");
});

it("rejects malformed tool history before inference", async () => {
  const response = await call({
    messages: [
      message,
      {
        id: "invalid",
        role: "assistant",
        parts: [
          { type: "tool-createImport", state: "approval-responded", input: {} },
        ],
      },
    ],
  });
  expect(response.status).toBe(400);
});
