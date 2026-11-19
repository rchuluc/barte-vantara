"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useImportAction } from "@/hooks/use-imports";
import {
  BusinessUnitCombobox,
  BankAccountCombobox,
} from "@/components/destination-picker";
import type { ImportJob, ImportMapping } from "@/lib/import-contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldDescription,
} from "@/components/ui/field";
import {
  NativeSelect,
  NativeSelectOption,
} from "@/components/ui/native-select";
import { RequestError } from "@/components/request-feedback";

export function ImportMappingForm({ job }: { job: ImportJob }) {
  const t = useTranslations("imports");
  const c = useTranslations("ui");
  const action = useImportAction(job.id);
  const [columns, setColumns] = useState<Record<string, string>>(
    job.suggestedColumns,
  );
  const [unitId, setUnitId] = useState("");
  const [statementUnits, setStatementUnits] = useState<string[]>([]);
  const [accountId, setAccountId] = useState("");
  const [dateFormat, setDateFormat] = useState<ImportMapping["dateFormat"]>(
    ["protheus", "itau"].includes(job.platform ?? "")
      ? "dd/MM/uuuu"
      : "uuuu-MM-dd",
  );
  const [decimal, setDecimal] = useState<ImportMapping["decimal"]>(
    ["protheus", "itau"].includes(job.platform ?? "") ? "," : ".",
  );
  const [currency, setCurrency] = useState<ImportMapping["currency"]>("BRL");
  const [unitMap, setUnitMap] = useState<Record<string, string>>({});
  const required =
    job.dataset_kind === "bank"
      ? ["amount", "booking_date", "description", "direction"]
      : ["amount", "party_name", "due_on"];
  const multiUnit = !!columns.unit;
  const automaticUnits = multiUnit && job.platform === "protheus";
  const sharedStatement = job.dataset_kind === "bank" && !multiUnit;
  const destinationSelected = sharedStatement
    ? statementUnits.length > 0
    : !!unitId;

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(event) => {
        event.preventDefault();
        action.mutate({
          action: "confirm",
          mapping: {
            columns: Object.fromEntries(
              Object.entries(columns).filter(([, value]) => value),
            ),
            ...(multiUnit
              ? { units: unitMap }
              : sharedStatement
                ? { unitIds: statementUnits }
                : { unitId }),
            ...(job.dataset_kind === "bank" ? { accountId } : {}),
            dateFormat,
            decimal,
            currency,
          },
        });
      }}
    >
      <div>
        <h2 className="text-xl font-semibold">{t("mappingTitle")}</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          {t("mappingDescription")}
        </p>
      </div>
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        {job.targetFields.map((field) => (
          <Field key={field}>
            <FieldLabel htmlFor={`map-${field}`}>
              {t.has(`fields.${field}`)
                ? t(`fields.${field}`)
                : field.replaceAll("_", " ")}
              {required.includes(field) ? " *" : ""}
            </FieldLabel>
            <NativeSelect
              id={`map-${field}`}
              value={columns[field] ?? ""}
              required={required.includes(field)}
              disabled={action.isPending}
              onChange={(event) =>
                setColumns({ ...columns, [field]: event.target.value })
              }
            >
              <NativeSelectOption value="">{t("notMapped")}</NativeSelectOption>
              {job.headers.map((header) => (
                <NativeSelectOption key={header} value={header}>
                  {header}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        ))}
      </FieldGroup>
      <h2 className="text-xl font-semibold">{t("destinationFormatting")}</h2>
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        {!multiUnit && (
          <Field>
            <FieldLabel htmlFor="destination">{c("businessUnit")} *</FieldLabel>
            <BusinessUnitCombobox
              id="destination"
              multiple={sharedStatement}
              value={sharedStatement ? statementUnits : unitId ? [unitId] : []}
              disabled={action.isPending}
              onChange={(value) => {
                setUnitId(value[0] ?? "");
                setStatementUnits(value);
                setAccountId("");
              }}
            />
            <FieldDescription>
              {sharedStatement
                ? t("sharedStatementHint")
                : t("visibleUnitsHint")}
            </FieldDescription>
          </Field>
        )}
        {automaticUnits && (
          <p className="text-sm text-muted-foreground">
            {t("automaticUnitsHint")}
          </p>
        )}
        {multiUnit && !automaticUnits && (
          <Field>
            <FieldLabel htmlFor="unit-names">
              {t("sourceUnitNames")} *
            </FieldLabel>
            <Input
              id="unit-names"
              required
              placeholder={t("unitNamesPlaceholder")}
              disabled={action.isPending}
              onChange={(event) =>
                setUnitMap(
                  Object.fromEntries(
                    event.target.value
                      .split(",")
                      .map((name) => [name.trim(), unitMap[name.trim()] ?? ""]),
                  ),
                )
              }
            />
            <FieldDescription>{t("unitNamesHint")}</FieldDescription>
          </Field>
        )}
        {multiUnit &&
          !automaticUnits &&
          Object.keys(unitMap).map((name, index) => (
            <Field key={name}>
              <FieldLabel htmlFor={`unit-${index}`}>
                {t("destinationFor", { name })} *
              </FieldLabel>
              <BusinessUnitCombobox
                id={`unit-${index}`}
                value={unitMap[name] ? [unitMap[name]] : []}
                disabled={action.isPending}
                onChange={(value) => {
                  setUnitMap({ ...unitMap, [name]: value[0] ?? "" });
                  setAccountId("");
                }}
              />
            </Field>
          ))}
        {job.dataset_kind === "bank" && (
          <Field>
            <FieldLabel htmlFor="bank-account">{t("bankAccount")} *</FieldLabel>
            <BankAccountCombobox
              id="bank-account"
              requireAllUnits
              value={accountId ? [accountId] : []}
              onChange={(value) => setAccountId(value[0] ?? "")}
              unitIds={multiUnit ? Object.values(unitMap) : statementUnits}
              currency={currency}
              disabled={
                action.isPending || (!multiUnit && !destinationSelected)
              }
            />
            <FieldDescription>{t("bankAccountHint")}</FieldDescription>
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="date-format">{t("dateFormat")}</FieldLabel>
          <NativeSelect
            id="date-format"
            value={dateFormat}
            disabled={action.isPending}
            onChange={(event) =>
              setDateFormat(event.target.value as ImportMapping["dateFormat"])
            }
          >
            <NativeSelectOption value="uuuu-MM-dd">
              {t("isoDate")}
            </NativeSelectOption>
            <NativeSelectOption value="dd/MM/uuuu">
              {t("dayFirstDate")}
            </NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="decimal">{t("decimalSeparator")}</FieldLabel>
          <NativeSelect
            id="decimal"
            value={decimal}
            disabled={action.isPending}
            onChange={(event) =>
              setDecimal(event.target.value as ImportMapping["decimal"])
            }
          >
            <NativeSelectOption value=".">
              {t("decimalPeriod")}
            </NativeSelectOption>
            <NativeSelectOption value=",">
              {t("decimalComma")}
            </NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="currency">{c("currency")}</FieldLabel>
          <NativeSelect
            id="currency"
            value={currency}
            disabled={action.isPending}
            onChange={(event) => {
              setCurrency(event.target.value as ImportMapping["currency"]);
              setAccountId("");
            }}
          >
            {["BRL", "USD", "EUR"].map((value) => (
              <NativeSelectOption key={value}>{value}</NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </FieldGroup>
      {action.error && <RequestError error={action.error} />}
      <p className="text-sm text-muted-foreground">{t("confirmHint")}</p>
      <Button
        className="self-start"
        disabled={
          action.isPending ||
          (!multiUnit && !destinationSelected) ||
          (multiUnit &&
            !automaticUnits &&
            (!Object.keys(unitMap).length ||
              Object.values(unitMap).some((id) => !id))) ||
          (job.dataset_kind === "bank" && !accountId)
        }
      >
        {action.isPending ? t("confirming") : t("confirmAndImport")}
      </Button>
    </form>
  );
}
