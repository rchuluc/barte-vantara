"use client";

import { useState } from "react";
import { useRoles, useSaveUser } from "@/hooks/use-workspace";
import { createUserSchema, patchUserSchema, type User } from "@/lib/contracts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Field,
  FieldGroup,
  FieldLabel,
  FieldSet,
  FieldLegend,
  FieldDescription,
} from "@/components/ui/field";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
} from "@/components/ui/card";
import { Loading, RequestError } from "@/components/request-feedback";
import {
  BusinessUnitCombobox,
  BankAccountCombobox,
} from "@/components/destination-picker";

export function UserEditor({
  user,
  close,
}: {
  user?: User;
  close: (saved?: boolean) => void;
}) {
  const roles = useRoles();
  const save = useSaveUser();
  const [validation, setValidation] = useState<string>();
  const [unitIds, setUnitIds] = useState(user?.unitIds ?? []);
  const [bankAccountIds, setBankAccountIds] = useState(
    user?.bankAccountIds ?? [],
  );

  if (roles.error)
    return (
      <RequestError
        error={roles.error}
        retry={() => {
          void roles.refetch();
        }}
      />
    );
  if (!roles.data) return <Loading />;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{user ? "Edit user" : "Add user"}</CardTitle>
        <CardDescription>
          {user ? user.email : "Create an account and assign workspace access."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form
          className="flex flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const body = {
              displayName: String(data.get("displayName")),
              roles: data.getAll("roles").map(String),
              unitIds,
              bankAccountIds,
            };
            const input = user
              ? patchUserSchema.safeParse(body)
              : createUserSchema.safeParse({
                  ...body,
                  email: data.get("email"),
                  password: data.get("password"),
                });

            if (!input.success) {
              setValidation(
                "Select at least one role and check the account details and access scopes.",
              );
              form
                .querySelector<HTMLInputElement>('input[name="roles"]')
                ?.focus();
              return;
            }

            setValidation(undefined);
            if (user)
              save.mutate(
                { id: user.id, body: input.data },
                { onSuccess: () => close(true) },
              );
            else
              save.mutate(
                { body: createUserSchema.parse(input.data) },
                { onSuccess: () => close(true) },
              );
          }}
        >
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="displayName">Display name</FieldLabel>
              <Input
                id="displayName"
                name="displayName"
                defaultValue={user?.display_name}
                maxLength={200}
                autoFocus
              />
            </Field>
            {!user && (
              <>
                <Field>
                  <FieldLabel htmlFor="new-email">Email address</FieldLabel>
                  <Input
                    id="new-email"
                    name="email"
                    type="email"
                    maxLength={254}
                    autoComplete="off"
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="new-password">
                    Initial password
                  </FieldLabel>
                  <Input
                    id="new-password"
                    name="password"
                    type="password"
                    minLength={8}
                    maxLength={256}
                    autoComplete="new-password"
                    aria-describedby="password-help"
                    required
                  />
                  <FieldDescription id="password-help">
                    At least 8 characters, including uppercase, lowercase, a
                    number and a symbol.
                  </FieldDescription>
                </Field>
              </>
            )}
            <FieldSet>
              <FieldLegend>Roles</FieldLegend>
              <FieldDescription>
                Select one or more roles. Admin grants user-management access.
              </FieldDescription>
              <div className="grid gap-2 sm:grid-cols-2">
                {roles.data.map(({ role }) => (
                  <Field key={role} orientation="horizontal">
                    <FieldLabel
                      className="min-h-11 cursor-pointer"
                      htmlFor={`role-${role}`}
                    >
                      <input
                        id={`role-${role}`}
                        type="checkbox"
                        name="roles"
                        value={role}
                        defaultChecked={user?.roles.includes(role)}
                        className="size-5 accent-primary"
                      />
                      {role}
                    </FieldLabel>
                  </Field>
                ))}
              </div>
            </FieldSet>
            <Field>
              <FieldLabel htmlFor="unitIds">Business units</FieldLabel>
              <BusinessUnitCombobox
                id="unitIds"
                multiple
                value={unitIds}
                disabled={save.isPending}
                onChange={(value) => {
                  setUnitIds(value);
                  setBankAccountIds([]);
                }}
              />
              <FieldDescription id="unit-help">
                Select one or more units. Changing units clears selected bank
                accounts.
              </FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="bankAccountIds">Bank accounts</FieldLabel>
              <BankAccountCombobox
                id="bankAccountIds"
                multiple
                value={bankAccountIds}
                onChange={setBankAccountIds}
                unitIds={unitIds}
                disabled={save.isPending || !unitIds.length}
              />
              <FieldDescription id="account-help">
                Only accounts in your scope can be assigned. Removing units may
                require clearing dependent approval scopes first.
              </FieldDescription>
            </Field>
          </FieldGroup>
          {validation && (
            <p role="alert" className="text-sm text-destructive">
              {validation}
            </p>
          )}
          {save.error && <RequestError error={save.error} />}
          <div className="flex flex-wrap gap-3">
            <Button type="submit" disabled={save.isPending}>
              {save.isPending ? "Saving…" : "Save user"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={save.isPending}
              onClick={() => close()}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
