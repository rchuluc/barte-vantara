"use client";

import { useId, useState } from "react";
import { Check, ChevronsUpDown, Plus } from "lucide-react";
import { useMe } from "@/hooks/use-workspace";
import {
  useUnits,
  useBankAccounts,
  useSaveDestination,
} from "@/hooks/use-destinations";
import {
  accountLabel,
  type BusinessUnit,
  type BankAccount,
} from "@/lib/destination-contracts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from "@/components/ui/popover";
import {
  Command,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from "@/components/ui/command";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { RequestError } from "@/components/request-feedback";

type PickerProps = {
  id: string;
  value: string[];
  onChange: (value: string[]) => void;
  multiple?: boolean;
  disabled?: boolean;
};

function DestinationCombobox({
  id,
  value,
  onChange,
  multiple,
  disabled,
  options,
  loading,
  label,
  create,
}: PickerProps & {
  options: { id: string; label: string; disabled?: boolean }[];
  loading: boolean;
  label: string;
  create?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const selected = value.map(
    (id) =>
      options.find((option) => option.id === id)?.label ??
      "Unavailable selection",
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          disabled={disabled || loading}
          className="w-full justify-between"
        >
          <span className="truncate">
            {loading
              ? "Loading…"
              : selected.join(", ") || `Select ${label.toLowerCase()}`}
          </span>
          <ChevronsUpDown data-icon="inline-end" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        id={listId}
        className="w-[var(--radix-popover-trigger-width)] p-0"
        align="start"
      >
        <Command label={`Search ${label.toLowerCase()}`}>
          <CommandInput
            aria-label={`Search ${label.toLowerCase()}`}
            placeholder="Search…"
          />
          <CommandList aria-multiselectable={multiple || undefined}>
            <CommandEmpty>No matches found.</CommandEmpty>
            <CommandGroup>
              {options.map((option) => (
                <CommandItem
                  key={option.id}
                  value={option.id}
                  keywords={[option.label]}
                  aria-checked={
                    multiple ? value.includes(option.id) : undefined
                  }
                  disabled={option.disabled && !value.includes(option.id)}
                  onSelect={() => {
                    onChange(
                      multiple
                        ? value.includes(option.id)
                          ? value.filter((id) => id !== option.id)
                          : [...value, option.id]
                        : [option.id],
                    );
                    if (!multiple) setOpen(false);
                  }}
                >
                  {multiple ? (
                    <Checkbox
                      checked={value.includes(option.id)}
                      tabIndex={-1}
                      aria-hidden="true"
                      className="pointer-events-none"
                    />
                  ) : value.includes(option.id) ? (
                    <Check aria-label="Selected" />
                  ) : null}
                  {option.label}
                </CommandItem>
              ))}
            </CommandGroup>
            {create && (
              <CommandGroup forceMount>
                <CommandItem
                  forceMount
                  value="create-destination"
                  onSelect={() => {
                    setOpen(false);
                    create();
                  }}
                >
                  <Plus />
                  Create {label}
                </CommandItem>
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

export function BusinessUnitCombobox(props: PickerProps) {
  const units = useUnits();
  const me = useMe();
  const [creating, setCreating] = useState(false);

  return (
    <>
      <DestinationCombobox
        {...props}
        label="Business Unit"
        loading={units.isPending}
        options={(units.data ?? [])
          .filter((unit) => unit.active || props.value.includes(unit.id))
          .map((unit) => ({
            id: unit.id,
            label: unit.name + (unit.active ? "" : " (disabled)"),
            disabled: !unit.active,
          }))}
        create={
          me.data?.permissions.includes("configure")
            ? () => setCreating(true)
            : undefined
        }
      />
      {units.error && (
        <RequestError
          error={units.error}
          retry={() => {
            void units.refetch();
          }}
        />
      )}
      {creating && (
        <BusinessUnitDialog
          close={() => setCreating(false)}
          saved={(unit) => {
            props.onChange(
              props.multiple ? [...props.value, unit.id] : [unit.id],
            );
            setCreating(false);
          }}
        />
      )}
    </>
  );
}

export function BankAccountCombobox({
  unitIds,
  currency,
  requireAllUnits = false,
  ...props
}: PickerProps & {
  unitIds?: string[];
  currency?: string;
  requireAllUnits?: boolean;
}) {
  const accounts = useBankAccounts();
  const units = useUnits();
  const me = useMe();
  const [creating, setCreating] = useState(false);
  const available = (accounts.data ?? []).filter((account) => {
    const eligible =
      account.active &&
      units.data?.some(
        (unit) =>
          account.unit_ids.includes(unit.id) &&
          unit.active &&
          (!unitIds || unitIds.includes(unit.id)),
      ) &&
      (!requireAllUnits ||
        unitIds?.every((id) => account.unit_ids.includes(id))) &&
      (!currency || account.currency === currency);
    return eligible || props.value.includes(account.id);
  });

  return (
    <>
      <DestinationCombobox
        {...props}
        label="Bank Account"
        loading={accounts.isPending || units.isPending}
        options={available.map((account) => ({
          id: account.id,
          label: accountLabel(account) + (account.active ? "" : " (disabled)"),
          disabled: !account.active,
        }))}
        create={
          me.data?.permissions.includes("configure")
            ? () => setCreating(true)
            : undefined
        }
      />
      {accounts.error && (
        <RequestError
          error={accounts.error}
          retry={() => {
            void accounts.refetch();
          }}
        />
      )}
      {units.error && (
        <RequestError
          error={units.error}
          retry={() => {
            void units.refetch();
          }}
        />
      )}
      {creating && (
        <BankAccountDialog
          unitIds={unitIds}
          currency={currency}
          close={() => setCreating(false)}
          saved={(account) => {
            props.onChange(
              props.multiple ? [...props.value, account.id] : [account.id],
            );
            setCreating(false);
          }}
        />
      )}
    </>
  );
}

export function BusinessUnitDialog({
  unit,
  close,
  saved,
}: {
  unit?: BusinessUnit;
  close: () => void;
  saved: (unit: BusinessUnit) => void;
}) {
  const save = useSaveDestination("business-units");
  const id = useId();

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) close();
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {unit ? "Update Business Unit" : "Create Business Unit"}
          </DialogTitle>
          <DialogDescription>
            Manage a business unit in your workspace.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const data = new FormData(event.currentTarget);
            save.mutate(
              {
                id: unit?.id,
                body: {
                  name: String(data.get("name")).trim(),
                  ...(unit ? { active: unit.active } : {}),
                },
              },
              {
                onSuccess: (result) => {
                  if ("name" in result) saved(result);
                },
              },
            );
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={id}>Name</FieldLabel>
              <Input
                id={id}
                name="name"
                required
                maxLength={200}
                pattern=".*\S.*"
                defaultValue={unit?.name}
                disabled={save.isPending}
              />
            </Field>
          </FieldGroup>
          {save.error && <RequestError error={save.error} />}
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={close}
            >
              Cancel
            </Button>
            <Button disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save business unit"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BankAccountDialog({
  account,
  unitIds,
  currency,
  close,
  saved,
}: {
  account?: BankAccount;
  unitIds?: string[];
  currency?: string;
  close: () => void;
  saved: (account: BankAccount) => void;
}) {
  const save = useSaveDestination("bank-accounts");
  const units = useUnits();
  const [selectedUnits, setSelectedUnits] = useState(
    account?.unit_ids ?? unitIds ?? [],
  );
  const id = useId();

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !save.isPending) close();
      }}
    >
      <DialogContent className="max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {account ? "Update Bank Account" : "Create Bank Account"}
          </DialogTitle>
          <DialogDescription>
            Share one bank account across business units, with a single
            currency.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const data = new FormData(event.currentTarget);
            save.mutate(
              {
                id: account?.id,
                body: {
                  bankCode: String(data.get("bankCode")).trim(),
                  accountRef: String(data.get("accountRef")).trim(),
                  unitIds: selectedUnits,
                  ...(account
                    ? { active: account.active }
                    : { currency: data.get("currency") }),
                },
              },
              {
                onSuccess: (result) => {
                  if ("unit_ids" in result) saved(result);
                },
              },
            );
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor={`${id}-unit`}>Business unit</FieldLabel>
              <BusinessUnitCombobox
                id={`${id}-unit`}
                multiple
                value={selectedUnits}
                onChange={setSelectedUnits}
                disabled={save.isPending}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-bank`}>Bank code</FieldLabel>
              <Input
                id={`${id}-bank`}
                name="bankCode"
                required
                maxLength={50}
                pattern=".*\S.*"
                defaultValue={account?.bank_code}
                disabled={save.isPending}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-reference`}>
                Account reference
              </FieldLabel>
              <Input
                id={`${id}-reference`}
                name="accountRef"
                required
                maxLength={200}
                pattern=".*\S.*"
                defaultValue={account?.account_ref}
                disabled={save.isPending}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor={`${id}-currency`}>Currency</FieldLabel>
              <NativeSelect
                id={`${id}-currency`}
                name="currency"
                defaultValue={account?.currency ?? currency ?? "BRL"}
                disabled={!!account || save.isPending}
              >
                {(currency ? [currency] : ["BRL", "USD", "EUR"]).map(
                  (value) => (
                    <NativeSelectOption key={value}>{value}</NativeSelectOption>
                  ),
                )}
              </NativeSelect>
              {account && (
                <FieldDescription>
                  Currency is fixed. Removing a business unit stops new imports;
                  historical records retain their original access restrictions.
                </FieldDescription>
              )}
            </Field>
          </FieldGroup>
          {units.error && <RequestError error={units.error} />}
          {save.error && <RequestError error={save.error} />}
          <div className="flex justify-end gap-3">
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={close}
            >
              Cancel
            </Button>
            <Button disabled={save.isPending || !selectedUnits.length}>
              {save.isPending ? "Saving…" : "Save bank account"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
