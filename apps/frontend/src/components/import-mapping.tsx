"use client";

import { useState } from "react";
import { useBusinessUnits, useImportAction } from "@/hooks/use-imports";
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
  const units = useBusinessUnits();
  const action = useImportAction(job.id);
  const [columns, setColumns] = useState<Record<string, string>>(
    job.suggestedColumns,
  );
  const [unitId, setUnitId] = useState("");
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
            ...(multiUnit ? { units: unitMap } : { unitId }),
            ...(job.dataset_kind === "bank" ? { accountId } : {}),
            dateFormat,
            decimal,
            currency,
          },
        });
      }}
    >
      <div>
        <h2 className="text-xl font-semibold">Review column mapping</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          Match your source columns to financial fields. Required fields are
          marked with *.
        </p>
      </div>
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        {job.targetFields.map((field) => (
          <Field key={field}>
            <FieldLabel htmlFor={`map-${field}`}>
              {field.replaceAll("_", " ")}
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
              <NativeSelectOption value="">Not mapped</NativeSelectOption>
              {job.headers.map((header) => (
                <NativeSelectOption key={header} value={header}>
                  {header}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
        ))}
      </FieldGroup>
      <h2 className="text-xl font-semibold">Destination & formatting</h2>
      {units.error && (
        <RequestError
          error={units.error}
          retry={() => {
            void units.refetch();
          }}
        />
      )}
      <FieldGroup className="grid gap-4 sm:grid-cols-2">
        {!multiUnit && (
          <Field>
            <FieldLabel htmlFor="destination">Business unit *</FieldLabel>
            <NativeSelect
              id="destination"
              required
              value={unitId}
              disabled={action.isPending || units.isPending}
              onChange={(event) => setUnitId(event.target.value)}
            >
              <NativeSelectOption value="">
                {units.isPending ? "Loading units…" : "Select a business unit"}
              </NativeSelectOption>
              {units.data?.map((unit) => (
                <NativeSelectOption key={unit.id} value={unit.id}>
                  {unit.name}
                </NativeSelectOption>
              ))}
            </NativeSelect>
            <FieldDescription>
              Only units visible to your account are listed.
            </FieldDescription>
          </Field>
        )}
        {automaticUnits && (
          <p className="text-sm text-muted-foreground">
            Protheus unit names are matched automatically. New units are
            registered if your permissions allow it.
          </p>
        )}
        {multiUnit && !automaticUnits && (
          <Field>
            <FieldLabel htmlFor="unit-names">Source unit names *</FieldLabel>
            <Input
              id="unit-names"
              required
              placeholder="Head office, Branch"
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
            <FieldDescription>
              Enter every distinct value from the mapped unit column, separated
              by commas.
            </FieldDescription>
          </Field>
        )}
        {multiUnit &&
          !automaticUnits &&
          Object.keys(unitMap).map((name, index) => (
            <Field key={name}>
              <FieldLabel htmlFor={`unit-${index}`}>
                Destination for {name} *
              </FieldLabel>
              <NativeSelect
                id={`unit-${index}`}
                required
                value={unitMap[name]}
                disabled={action.isPending}
                onChange={(event) =>
                  setUnitMap({ ...unitMap, [name]: event.target.value })
                }
              >
                <NativeSelectOption value="">
                  Select a business unit
                </NativeSelectOption>
                {units.data?.map((unit) => (
                  <NativeSelectOption key={unit.id} value={unit.id}>
                    {unit.name}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
          ))}
        {job.dataset_kind === "bank" && (
          <Field>
            <FieldLabel htmlFor="bank-account">Bank account ID *</FieldLabel>
            <Input
              id="bank-account"
              required
              value={accountId}
              pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
              disabled={action.isPending}
              onChange={(event) => setAccountId(event.target.value)}
            />
            <FieldDescription>
              Use an existing account UUID for the selected unit and currency.
            </FieldDescription>
          </Field>
        )}
        <Field>
          <FieldLabel htmlFor="date-format">Date format</FieldLabel>
          <NativeSelect
            id="date-format"
            value={dateFormat}
            disabled={action.isPending}
            onChange={(event) =>
              setDateFormat(event.target.value as ImportMapping["dateFormat"])
            }
          >
            <NativeSelectOption value="uuuu-MM-dd">
              YYYY-MM-DD
            </NativeSelectOption>
            <NativeSelectOption value="dd/MM/uuuu">
              DD/MM/YYYY
            </NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="decimal">Decimal separator</FieldLabel>
          <NativeSelect
            id="decimal"
            value={decimal}
            disabled={action.isPending}
            onChange={(event) =>
              setDecimal(event.target.value as ImportMapping["decimal"])
            }
          >
            <NativeSelectOption value=".">Period (1234.56)</NativeSelectOption>
            <NativeSelectOption value=",">Comma (1234,56)</NativeSelectOption>
          </NativeSelect>
        </Field>
        <Field>
          <FieldLabel htmlFor="currency">Currency</FieldLabel>
          <NativeSelect
            id="currency"
            value={currency}
            disabled={action.isPending}
            onChange={(event) =>
              setCurrency(event.target.value as ImportMapping["currency"])
            }
          >
            {["BRL", "USD", "EUR"].map((value) => (
              <NativeSelectOption key={value}>{value}</NativeSelectOption>
            ))}
          </NativeSelect>
        </Field>
      </FieldGroup>
      {action.error && <RequestError error={action.error} />}
      <p className="text-sm text-muted-foreground">
        Confirming locks the mapping. You can correct individual rejected rows
        after processing.
      </p>
      <Button className="self-start" disabled={action.isPending}>
        {action.isPending ? "Confirming…" : "Confirm and import"}
      </Button>
    </form>
  );
}
