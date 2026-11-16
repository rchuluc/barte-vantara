import { mkdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  prepareExtraction,
  runExtraction,
} from "../src/services/unstructured-extraction.ts";

const sourceUrl = new URL(
  "../../../data_pack/04_caixa_de_entrada_contas_a_pagar.txt",
  import.meta.url,
);
const source = await readFile(sourceUrl, "utf8");
const sections = source.split(/(?=^--- .+ ---+\s*$)/m).slice(1);

if (sections.length !== 4) throw new Error("Expected four benchmark sections");

const directory = new URL(
  `../../../artifacts/unstructured/${Date.now()}/`,
  import.meta.url,
);
await mkdir(directory, { recursive: true, mode: 0o700 });
await writeFile(new URL("original.txt", directory), source, {
  flag: "wx",
  mode: 0o600,
});

const expected = [
  "invoice",
  "payment_follow_up",
  "freight_summary",
  "approval_conversation",
];
const summary = [];

for (const [index, text] of sections.entries()) {
  const attempt = prepareExtraction(text);
  const save = (name, value) =>
    writeFile(
      new URL(`${index + 1}-${name}.json`, directory),
      JSON.stringify(value, null, 2),
      { flag: "wx", mode: 0o600 },
    );
  await save("started", attempt);

  const result = await runExtraction(attempt);
  await save("result", result);

  const parsed = result.parsed;
  const hasAmount = (value, kind) =>
    parsed?.amounts.some((item) => item.value === value && item.kind === kind);
  const checks = {
    extraction: result.status === "succeeded",
    classification: parsed?.classification === expected[index],
    issues: (parsed?.issues.length ?? 0) > 0,
  };

  if (index === 0) {
    checks.originalAmount = hasAmount("18900.00", "original");
    checks.unknownDueYear = parsed?.dates.some(
      (date) =>
        date.kind === "due" && date.raw.includes("20/07") && date.iso === null,
    );
    checks.invoice = parsed?.documents.some(
      (document) => document.value === "88231",
    );
  } else if (index === 1) {
    checks.originalAmount = hasAmount("18900.00", "original");
    checks.updatedAmount = hasAmount("19278.00", "updated");
    checks.leadingZero = parsed?.documents.some(
      (document) => document.value === "088231",
    );
    checks.updatedDue = parsed?.dates.some(
      (date) => date.kind === "due" && date.iso === "2026-07-25",
    );
    checks.partialDelivery = parsed?.claims.some(
      (claim) => claim.kind === "delivery" && claim.quote.includes("12 de 15"),
    );
  } else if (index === 2) {
    checks.aggregate = hasAmount("34117.82", "total");
    checks.relativeDue = parsed?.dates.some(
      (date) => date.kind === "due" && date.iso === null,
    );
    checks.noInventedInvoices = parsed?.documents.length === 0;
  } else {
    checks.approvalClaim = parsed?.claims.some(
      (claim) => claim.kind === "approval",
    );
    checks.paymentClaim = parsed?.claims.some(
      (claim) => claim.kind === "payment",
    );
    checks.noInferredDates = parsed?.dates.every((date) => date.iso === null);
  }

  if (index < 3) checks.attachmentReference = parsed?.attachments.length === 1;

  const passed = Object.values(checks).every((value) => value === true);
  summary.push({ case: index + 1, passed, checks, error: result.error });
  console.log(`Case ${index + 1}: ${passed ? "PASS" : "FAIL"}`, checks);
}

await writeFile(
  new URL("summary.json", directory),
  JSON.stringify(summary, null, 2),
  { flag: "wx", mode: 0o600 },
);
console.log(`Evidence: ${fileURLToPath(directory)}`);
if (summary.some((item) => !item.passed)) process.exitCode = 1;
