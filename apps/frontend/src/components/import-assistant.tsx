"use client";

import { useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { useChat } from "@ai-sdk/react";
import {
  DefaultChatTransport,
  isToolUIPart,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from "ai";
import { Dialog } from "radix-ui";
import {
  ArrowUp,
  ArrowUpRight,
  FileText,
  LoaderCircle,
  Paperclip,
  Plus,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  assistantImportSchema,
  assistantImportResultSchema,
} from "@/lib/assistant-import";
import { unitsSchema } from "@/lib/import-contracts";

const transport = new DefaultChatTransport({ api: "/api/imports/assistant" });

export function ImportAssistant({ onImported }: { onImported?: () => void }) {
  const t = useTranslations("assistant");
  const format = useFormatter();
  const suggestions = [t("uploadSuggestion"), t("prepareSuggestion")];
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [fileError, setFileError] = useState("");
  const [attachment, setAttachment] = useState<{
    name: string;
    text: string;
  }>();
  const [reading, setReading] = useState(false);
  const scroll = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const followScroll = useRef(true);
  const {
    messages,
    sendMessage,
    regenerate,
    status,
    error,
    stop,
    clearError,
    setMessages,
    addToolApprovalResponse,
  } = useChat({
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
  });
  const busy = status === "submitted" || status === "streaming";
  const pendingApproval = messages.some((message) =>
    message.parts.some(
      (part) => isToolUIPart(part) && part.state === "approval-requested",
    ),
  );
  const units = messages.flatMap((message) =>
    message.parts.flatMap((part) => {
      if (
        part.type !== "tool-listBusinessUnits" ||
        part.state !== "output-available"
      )
        return [];
      return unitsSchema.safeParse(part.output).data ?? [];
    }),
  );
  const imported = messages
    .flatMap((message) => message.parts)
    .filter(
      (part) =>
        part.type === "tool-createImport" && part.state === "output-available",
    ).length;
  const notified = useRef(0);
  const full = messages.length >= 40;

  useEffect(() => {
    if (imported > notified.current) onImported?.();
    notified.current = imported;
  }, [imported, onImported]);

  useEffect(() => {
    const element = scroll.current;
    if (element && followScroll.current)
      element.scrollTop = element.scrollHeight;
  }, [messages, status, open]);

  useEffect(
    () => () => {
      void stop();
    },
    [stop],
  );

  function send(text: string) {
    if (!text.trim() || busy || reading || full || pendingApproval) return;
    if (text.length > 64000) {
      setFileError("tooLong");
      return;
    }
    followScroll.current = true;
    clearError();
    setFileError("");
    void sendMessage({ text });
    setInput("");
    setAttachment(undefined);
    composer.current?.focus();
  }

  return (
    <Dialog.Root open={open} onOpenChange={setOpen} modal={false}>
      <Dialog.Trigger asChild>
        <Button
          className="fixed right-4 bottom-[max(1rem,env(safe-area-inset-bottom))] z-40 h-14 gap-3 rounded-full px-5 shadow-lg transition-shadow hover:shadow-xl sm:right-6"
          aria-label={t("label")}
        >
          <Sparkles className="size-5" aria-hidden="true" />
          <span>{t("ask")}</span>
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Content
          onInteractOutside={(event) => event.preventDefault()}
          onOpenAutoFocus={(event) => {
            event.preventDefault();
            composer.current?.focus();
          }}
          className="import-workspace fixed right-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-50 flex h-[min(42rem,calc(100dvh-1.5rem))] w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card text-card-foreground shadow-2xl outline-none sm:right-6 sm:bottom-6 sm:h-[min(42rem,calc(100dvh-3rem))] sm:w-[27rem]"
        >
          <header className="flex shrink-0 items-center gap-3 border-b border-border/70 px-5 py-3">
            <div className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
              <Sparkles className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <Dialog.Title className="text-sm font-semibold tracking-tight">
                Vantara
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-xs text-muted-foreground">
                {t("description")}
              </Dialog.Description>
            </div>
            {messages.length > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label={t("newChat")}
                title={t("newChat")}
                disabled={busy || reading}
                onClick={() => {
                  setMessages([]);
                  clearError();
                  setFileError("");
                }}
              >
                <Plus className="size-4" />
              </Button>
            )}
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label={t("close")}
              >
                <X className="size-4" />
              </Button>
            </Dialog.Close>
          </header>

          <div
            ref={scroll}
            role="log"
            aria-label={t("conversation")}
            aria-live="polite"
            aria-busy={busy}
            onScroll={(event) => {
              const element = event.currentTarget;
              followScroll.current =
                element.scrollHeight -
                  element.scrollTop -
                  element.clientHeight <
                64;
            }}
            className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-6"
          >
            {!messages.length && (
              <div className="flex min-h-full flex-col justify-center py-4">
                <div className="mb-6 flex size-12 items-center justify-center rounded-2xl border border-primary/10 bg-secondary text-primary">
                  <Sparkles className="size-6" aria-hidden="true" />
                </div>
                <h2 className="max-w-64 text-2xl leading-tight font-semibold tracking-tight">
                  {t("welcome")}
                </h2>
                <p className="mt-3 max-w-80 text-sm leading-6 text-muted-foreground">
                  {t("welcomeDescription")}
                </p>
                <div className="mt-7 flex flex-col items-start gap-2">
                  {suggestions.map((text) => (
                    <button
                      key={text}
                      type="button"
                      onClick={() => send(text)}
                      disabled={busy || reading}
                      className="group flex min-h-11 w-full items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-2.5 text-left text-sm transition-colors hover:border-primary/30 hover:bg-secondary/50 disabled:opacity-50"
                    >
                      {text}
                      <ArrowUpRight
                        aria-hidden="true"
                        className="size-4 shrink-0 text-muted-foreground group-hover:text-primary"
                      />
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div className="space-y-6">
              {messages.map((message) => (
                <div
                  key={message.id}
                  className={
                    message.role === "user"
                      ? "ml-9 flex justify-end"
                      : "flex gap-2.5"
                  }
                >
                  {message.role === "assistant" && (
                    <Sparkles
                      aria-hidden="true"
                      className="mt-1 size-4 shrink-0 text-primary"
                    />
                  )}
                  <div
                    className={
                      message.role === "user"
                        ? "min-w-0 max-w-full rounded-2xl rounded-br-md bg-secondary px-4 py-3"
                        : "min-w-0 flex-1 pt-0.5"
                    }
                  >
                    <span className="sr-only">
                      {message.role === "user" ? t("you") : "Vantara"}
                    </span>
                    {message.parts.map((part, index) => {
                      if (part.type === "tool-createImport") {
                        const proposal = assistantImportSchema.safeParse(
                          part.input,
                        );
                        const result = assistantImportResultSchema.safeParse(
                          part.state === "output-available"
                            ? part.output
                            : null,
                        );
                        return (
                          <div
                            key={index}
                            className="mt-3 space-y-3 rounded-xl border border-border p-3 text-sm"
                          >
                            {proposal.success && (
                              <>
                                <p className="font-medium">
                                  {part.state === "output-available"
                                    ? t("result")
                                    : t("proposal", {
                                        count: proposal.data.rows.length,
                                      })}
                                </p>
                                <p>
                                  {t("destination", {
                                    name:
                                      units.find(
                                        (unit) =>
                                          unit.id === proposal.data.unitId,
                                      )?.name ?? proposal.data.unitId,
                                  })}
                                </p>
                                <ul className="space-y-2">
                                  {proposal.data.rows.map((row, rowIndex) => (
                                    <li key={rowIndex} className="break-words">
                                      {row.party_name} · {row.document_ref}
                                      <br />
                                      {format.number(Number(row.amount), {
                                        style: "currency",
                                        currency: proposal.data.currency,
                                      })}{" "}
                                      ·{" "}
                                      {t("due", {
                                        date: format.dateTime(
                                          new Date(`${row.due_on}T00:00:00Z`),
                                          {
                                            dateStyle: "short",
                                            timeZone: "UTC",
                                          },
                                        ),
                                      })}
                                    </li>
                                  ))}
                                </ul>
                                <p className="text-xs text-muted-foreground">
                                  {t("proposalHint")}
                                </p>
                              </>
                            )}
                            {part.state === "approval-requested" && (
                              <div className="flex gap-2">
                                <Button
                                  type="button"
                                  disabled={busy || !proposal.success}
                                  onClick={() =>
                                    void addToolApprovalResponse({
                                      id: part.approval.id,
                                      approved: true,
                                    })
                                  }
                                >
                                  {t("confirm")}
                                </Button>
                                <Button
                                  type="button"
                                  variant="outline"
                                  disabled={busy}
                                  onClick={() =>
                                    void addToolApprovalResponse({
                                      id: part.approval.id,
                                      approved: false,
                                    })
                                  }
                                >
                                  {t("cancel")}
                                </Button>
                              </div>
                            )}
                            {part.state === "approval-responded" && (
                              <p role="status">
                                {part.approval.approved
                                  ? t("confirmedSaving")
                                  : t("cancelled")}
                              </p>
                            )}
                            {part.state === "output-denied" && (
                              <p>{t("denied")}</p>
                            )}
                            {part.state === "output-error" && (
                              <>
                                <p role="alert">{t("importError")}</p>
                                {part.approval && (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    disabled={busy}
                                    onClick={() =>
                                      setMessages((current) =>
                                        current.map((item) => ({
                                          ...item,
                                          parts: item.parts.map((candidate) =>
                                            candidate === part
                                              ? {
                                                  ...part,
                                                  state: "approval-requested",
                                                  errorText: undefined,
                                                  approval: {
                                                    ...part.approval!,
                                                    approved: undefined,
                                                    reason: undefined,
                                                  },
                                                }
                                              : candidate,
                                          ),
                                        })),
                                      )
                                    }
                                  >
                                    {t("retryImport")}
                                  </Button>
                                )}
                              </>
                            )}
                            {result.success && (
                              <div role="status">
                                {part.approval?.approved && (
                                  <p className="mb-1 font-medium">
                                    {t("confirmedByYou")}
                                  </p>
                                )}
                                <p>
                                  {t("counts", {
                                    imported:
                                      result.data.processed -
                                      result.data.rejected,
                                    rejected: result.data.rejected,
                                  })}{" "}
                                  <a
                                    className="underline"
                                    href={`/imports/${result.data.id}`}
                                  >
                                    {t("reviewImport")}
                                  </a>
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      }
                      return part.type === "text" ? (
                        <p
                          key={index}
                          className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm leading-6"
                        >
                          {part.text}
                        </p>
                      ) : null;
                    })}
                  </div>
                </div>
              ))}
              {busy && (
                <div
                  role="status"
                  className="flex items-center gap-2.5 text-sm text-muted-foreground"
                >
                  <LoaderCircle
                    aria-hidden="true"
                    className="size-4 animate-spin text-primary motion-reduce:animate-none"
                  />
                  {status === "submitted" ? t("thinking") : t("working")}
                </div>
              )}
            </div>
          </div>

          <form
            className="max-h-[60%] shrink-0 overflow-y-auto px-4 pt-2 pb-3"
            onSubmit={(event) => {
              event.preventDefault();
              send(
                attachment
                  ? [input.trim(), attachment.text].filter(Boolean).join("\n\n")
                  : input,
              );
            }}
          >
            {error && (
              <div className="mb-3 flex items-center justify-between gap-2 rounded-xl bg-destructive/5 p-3">
                <p role="alert" className="text-sm text-destructive">
                  {t("messageError")}
                </p>
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    void regenerate();
                  }}
                >
                  {t("retryMessage")}
                </Button>
              </div>
            )}
            {full && (
              <p role="status" className="mb-3 text-sm text-muted-foreground">
                {t("full")}
              </p>
            )}
            <div className="assistant-composer rounded-2xl border border-input/60 bg-background p-2 transition-shadow focus-within:border-ring focus-within:ring-2 focus-within:ring-ring/15">
              {attachment && (
                <div className="mx-1 mb-1 flex items-center gap-2 rounded-lg bg-secondary px-3 py-1.5">
                  <FileText
                    aria-hidden="true"
                    className="size-4 shrink-0 text-primary"
                  />
                  <span
                    className="min-w-0 flex-1 truncate text-sm"
                    title={attachment.name}
                  >
                    {attachment.name}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-11"
                    aria-label={t("removeAttachment")}
                    disabled={busy || reading}
                    onClick={() => setAttachment(undefined)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              )}
              <label htmlFor="assistant-input" className="sr-only">
                {t("messageLabel")}
              </label>
              <textarea
                ref={composer}
                id="assistant-input"
                value={input}
                maxLength={64000}
                disabled={busy || reading || full || pendingApproval}
                rows={2}
                placeholder={t("placeholder")}
                className="max-h-36 min-h-16 w-full resize-none border-0 bg-transparent px-3 py-2 text-base leading-6 outline-none focus-visible:outline-none disabled:opacity-50 sm:text-sm"
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (
                    event.key === "Enter" &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing
                  ) {
                    event.preventDefault();
                    event.currentTarget.form?.requestSubmit();
                  }
                }}
              />
              <div className="flex items-center justify-between gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-11"
                  aria-label={t("attach")}
                  title={t("attachHint")}
                  disabled={busy || reading || full}
                  onClick={() => fileInput.current?.click()}
                >
                  <Paperclip className="size-5" />
                </Button>
                <span className="flex-1 text-xs text-muted-foreground">
                  {reading ? t("reading") : t("fileTypes")}
                </span>
                {busy ? (
                  <Button
                    type="button"
                    size="icon"
                    variant="secondary"
                    className="size-11 rounded-xl"
                    aria-label={t("stop")}
                    onClick={() => {
                      void stop();
                    }}
                  >
                    <Square className="size-4" />
                  </Button>
                ) : (
                  <Button
                    size="icon"
                    className="size-11 rounded-xl"
                    aria-label={t("send")}
                    disabled={
                      (!input.trim() && !attachment) ||
                      reading ||
                      full ||
                      pendingApproval
                    }
                  >
                    <ArrowUp className="size-5" />
                  </Button>
                )}
              </div>
            </div>
            <input
              ref={fileInput}
              aria-label={t("sourceFile")}
              type="file"
              accept=".txt,.eml,.md"
              className="hidden"
              disabled={busy || reading || full}
              onChange={async (event) => {
                const file = event.target.files?.[0];
                event.target.value = "";
                setFileError("");
                if (!file) return;
                if (
                  !/\.(txt|eml|md)$/i.test(file.name) ||
                  !file.size ||
                  file.size > 64000
                ) {
                  setFileError("invalidFile");
                  return;
                }
                setReading(true);
                try {
                  const text = new TextDecoder("utf-8", { fatal: true }).decode(
                    await file.arrayBuffer(),
                  );
                  if (!text.trim() || text.includes("\0"))
                    throw new Error("Invalid text");
                  setAttachment({ name: file.name, text });
                } catch {
                  setFileError("unreadableFile");
                } finally {
                  setReading(false);
                }
              }}
            />
            {fileError && (
              <p role="alert" className="mt-2 text-sm text-destructive">
                {t(fileError)}
              </p>
            )}
            <p className="mt-2.5 text-center text-xs text-muted-foreground">
              {t("footer")}
            </p>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
