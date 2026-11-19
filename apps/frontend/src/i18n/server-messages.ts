"use client";

import { useTranslations } from "next-intl";

// These legacy API responses contain text rather than stable message codes.
// Translate only known application messages; preserve original source/user text.
const messages: Record<string, string> = {
  "Check the entered values and try again.": "invalidValues",
  "Sign in again or check your email and password.": "signIn",
  "You do not have access to this workspace or action.": "forbidden",
  "The requested resource could not be found.": "notFound",
  "This change conflicts with the current state or access scope. Refresh and try again.":
    "conflict",
  "The file is too large. Choose a file up to 100 MiB.": "tooLarge",
  "Too many requests. Wait a moment and try again.": "rateLimit",
  "The service is temporarily unavailable. Please try again.": "unavailable",
  "Unable to connect. Check your connection and try again.": "connection",
  "Invalid response. Please try again.": "invalidResponse",
  "Processing made no progress. Retry to resume this import.": "noProgress",
  "Row column count differs from header": "columnCount",
  "Invalid amount format or precision": "amountFormat",
  "Amount exceeds supported range": "amountRange",
  "Amount must be positive": "amountPositive",
  "Business unit mapping required": "unitRequired",
  "Invalid bank direction": "bankDirection",
  "Paid flags require settlement evidence; no settlement inferred":
    "paidEvidence",
  "Unsupported title status": "titleStatus",
  "Invalid tax identifier": "taxId",
  "Valor coincidente": "matchingAmount",
  "Crédito na data de vencimento": "matchingDate",
  "Proposta por agente; aguardando aprovação humana": "agentProposal",
  "Alocação proposta na bancada": "workbenchProposal",
  "Mantido pendente pelo operador": "operatorPending",
  "Sugestão rejeitada pelo operador": "operatorRejected",
  "Alocações verificadas; registro somente nesta aplicação":
    "verifiedAllocations",
};

export function useServerMessage() {
  const t = useTranslations("serverMessages");
  const fields = useTranslations("imports.fields");

  return (message: string): string => {
    const key = messages[message];
    if (key) return t(key);

    const fieldMatch = /^(?:Missing (\w+)|Invalid (\w+) date)$/.exec(message);
    if (fieldMatch) {
      const field = fieldMatch[1] ?? fieldMatch[2];
      return t(fieldMatch[1] ? "missingField" : "invalidDate", {
        field: fields.has(field) ? fields(field) : field,
      });
    }

    for (const [prefix, key] of [
      ["Referência coincidente: ", "matchingReference"],
      ["CNPJ identificado: ", "identifiedTaxId"],
      ["Nome no histórico: ", "nameInDescription"],
    ]) {
      if (message.startsWith(prefix))
        return t(key, { value: message.slice(prefix.length) });
    }

    return message;
  };
}
