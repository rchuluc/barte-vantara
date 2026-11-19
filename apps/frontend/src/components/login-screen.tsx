"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { LocaleSelector } from "@/components/locale-selector";
import { ArrowRight, Eye, EyeOff, ShieldCheck } from "lucide-react";
import { useSignin } from "@/hooks/use-workspace";
import { useTenant } from "@/components/workspace-provider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { RequestError } from "@/components/request-feedback";

export function LoginScreen() {
  const t = useTranslations("login");
  const tenant = useTenant();
  const signin = useSignin();
  const [showPassword, setShowPassword] = useState(false);
  const [requiresNewPassword, setRequiresNewPassword] = useState(false);

  return (
    <main className="login-grid relative min-h-dvh">
      <section className="brand-panel flex flex-col justify-between gap-12 p-8 lg:p-16">
        <p className="text-2xl font-semibold tracking-tight">
          {tenant.name}
          <span aria-hidden="true">.</span>
        </p>
        <div className="hidden max-w-lg flex-col gap-6 lg:flex">
          <p className="text-sm font-medium uppercase tracking-widest">
            {t("connected")}
          </p>
          <p className="text-4xl leading-tight font-medium tracking-tight lg:text-6xl">
            {t("headline")}
            <br />
            {t("nextStep")}
          </p>
          <p className="max-w-sm text-lg leading-relaxed">{t("description")}</p>
        </div>
        <p className="hidden items-center gap-2 text-sm lg:flex">
          <ShieldCheck className="size-4" aria-hidden="true" />
          {t("privateAccess", { name: tenant.name })}
        </p>
      </section>
      <section className="flex items-center justify-center px-6 pt-12 pb-32 lg:px-16 lg:pt-16">
        <div className="flex w-full max-w-sm flex-col gap-8">
          <header className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              {t("workspace", { name: tenant.name })}
            </p>
            <h1 className="text-3xl font-semibold tracking-tight">
              {requiresNewPassword ? t("setPassword") : t("welcome")}
            </h1>
            <p className="text-muted-foreground">
              {requiresNewPassword ? t("replacePassword") : t("continue")}
            </p>
          </header>
          <form
            className="flex flex-col gap-6"
            onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              signin.mutate(
                requiresNewPassword
                  ? { newPassword: String(data.get("password")) }
                  : {
                      email: String(data.get("email")).trim(),
                      password: String(data.get("password")),
                    },
                {
                  onSuccess: (result) => {
                    if ("requiresNewPassword" in result)
                      setRequiresNewPassword(true);
                  },
                },
              );
            }}
          >
            <FieldGroup>
              {!requiresNewPassword && (
                <Field>
                  <FieldLabel htmlFor="email">{t("email")}</FieldLabel>
                  <Input
                    id="email"
                    name="email"
                    type="email"
                    autoComplete="username"
                    maxLength={254}
                    required
                  />
                </Field>
              )}
              <Field>
                <FieldLabel htmlFor="password">
                  {requiresNewPassword ? t("newPassword") : t("password")}
                </FieldLabel>
                <div className="relative">
                  <Input
                    id="password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    key={requiresNewPassword ? "new-password" : "password"}
                    autoComplete={
                      requiresNewPassword ? "new-password" : "current-password"
                    }
                    minLength={requiresNewPassword ? 8 : undefined}
                    maxLength={256}
                    className="pr-12"
                    required
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute top-0 right-0 size-11 hover:bg-transparent hover:text-current dark:hover:bg-transparent"
                    aria-label={
                      showPassword ? t("hidePassword") : t("showPassword")
                    }
                    aria-controls="password"
                    aria-pressed={showPassword}
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff aria-hidden="true" />
                    ) : (
                      <Eye aria-hidden="true" />
                    )}
                  </Button>
                </div>
                {requiresNewPassword && (
                  <p className="text-sm text-muted-foreground">
                    {t("passwordHint")}
                  </p>
                )}
              </Field>
            </FieldGroup>
            {signin.error && <RequestError error={signin.error} />}
            <Button type="submit" disabled={signin.isPending}>
              {signin.isPending
                ? t("signingIn")
                : requiresNewPassword
                  ? t("setAndSignIn")
                  : t("signIn")}
              <ArrowRight data-icon="inline-end" aria-hidden="true" />
            </Button>
            {requiresNewPassword && (
              <Button
                type="button"
                variant="outline"
                disabled={signin.isPending}
                onClick={() => {
                  setRequiresNewPassword(false);
                  signin.reset();
                }}
              >
                {t("back")}
              </Button>
            )}
          </form>
          <p className="text-sm leading-relaxed text-muted-foreground">
            {t("help")}
          </p>
        </div>
      </section>
      <div className="absolute right-6 bottom-6 w-52">
        <LocaleSelector />
      </div>
    </main>
  );
}
