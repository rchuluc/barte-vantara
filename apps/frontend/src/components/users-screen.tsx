"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { Plus, Users } from "lucide-react";
import {
  useMe,
  useUsers,
  useSaveUser,
  useDeactivateUser,
} from "@/hooks/use-workspace";
import type { User } from "@/lib/contracts";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { UserEditor } from "@/components/user-editor";
import { Loading, RequestError } from "@/components/request-feedback";

export function UsersScreen() {
  const t = useTranslations("ui");
  const me = useMe();

  if (me.error)
    return (
      <RequestError
        error={me.error}
        retry={() => {
          void me.refetch();
        }}
      />
    );
  if (!me.data) return <Loading />;
  if (!me.data.permissions.includes("configure"))
    return (
      <Alert variant="destructive">
        <AlertTitle>{t("adminRequired")}</AlertTitle>
        <AlertDescription>{t("cannotManageUsersContact")}</AlertDescription>
      </Alert>
    );

  return <UserManagement actorId={me.data.id} />;
}

function UserManagement({ actorId }: { actorId: string }) {
  const t = useTranslations("ui");
  const [offset, setOffset] = useState(0);
  const [editor, setEditor] = useState<User | null>(null);
  const [confirmation, setConfirmation] = useState<User | null>(null);
  const [notice, setNotice] = useState("");
  const users = useUsers(offset);
  const save = useSaveUser();
  const deactivate = useDeactivateUser();

  return (
    <section className="flex flex-col gap-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="mb-2 text-sm text-muted-foreground">
            {t("administration")}
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("userManagement")}
          </h1>
          <p className="mt-3 text-muted-foreground">{t("usersDescription")}</p>
        </div>
        <Button asChild>
          <Link href="/users/new">
            <Plus data-icon="inline-start" aria-hidden="true" />
            {t("addUser")}
          </Link>
        </Button>
      </header>
      {notice && <p role="status">{t(notice)}</p>}
      {editor && (
        <UserEditor
          key={editor.id}
          user={editor}
          close={(saved) => {
            setEditor(null);
            if (saved) setNotice("userSaved");
          }}
        />
      )}
      {confirmation && (
        <Alert>
          <AlertTitle>
            {t("deactivateUserQuestion", { email: confirmation.email })}
          </AlertTitle>
          <AlertDescription>
            {t("deactivateDescription")}
            <div className="mt-3 flex flex-wrap gap-3">
              <Button
                variant="destructive"
                disabled={deactivate.isPending}
                onClick={() =>
                  deactivate.mutate(confirmation.id, {
                    onSuccess: () => {
                      setConfirmation(null);
                      setNotice("userDeactivated");
                    },
                  })
                }
              >
                {deactivate.isPending
                  ? t("deactivating")
                  : t("confirmDeactivation")}
              </Button>
              <Button
                variant="outline"
                disabled={deactivate.isPending}
                onClick={() => setConfirmation(null)}
              >
                {t("cancelDeactivation")}
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {deactivate.error && <RequestError error={deactivate.error} />}
      {save.error && <RequestError error={save.error} />}
      {users.error ? (
        <RequestError
          error={users.error}
          retry={() => {
            void users.refetch();
          }}
        />
      ) : !users.data ? (
        <Loading />
      ) : (
        <>
          {users.data.length === 0 ? (
            <Alert>
              <Users aria-hidden="true" />
              <AlertTitle>{t("noUsers")}</AlertTitle>
              <AlertDescription>{t("noUsersDescription")}</AlertDescription>
            </Alert>
          ) : (
            <ul className="divide-y divide-border rounded-xl border border-border bg-card">
              {users.data.map((user) => (
                <li
                  key={user.id}
                  className="flex flex-wrap items-center justify-between gap-5 p-5"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium break-words">
                      {user.display_name || user.email}
                      {user.id === actorId && t("youSuffix")}
                    </p>
                    <p className="mt-1 text-sm break-all text-muted-foreground">
                      {user.email}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant={user.active ? "secondary" : "outline"}>
                        {user.active ? t("active") : t("inactive")}
                      </Badge>
                      {user.roles.map((role) => (
                        <Badge key={role} variant="outline">
                          {t.has(`rolesList.${role}`)
                            ? t(`rolesList.${role}`)
                            : role}
                        </Badge>
                      ))}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      disabled={user.id === actorId}
                      aria-label={t("editUserLabel", { email: user.email })}
                      onClick={() => setEditor(user)}
                    >
                      {t("edit")}
                    </Button>
                    <Button
                      variant="ghost"
                      disabled={
                        user.id === actorId ||
                        save.isPending ||
                        deactivate.isPending
                      }
                      aria-label={t(
                        user.active
                          ? "deactivateUserLabel"
                          : "reactivateUserLabel",
                        { email: user.email },
                      )}
                      onClick={() => {
                        if (user.active) {
                          deactivate.reset();
                          setConfirmation(user);
                        } else
                          save.mutate(
                            { id: user.id, body: { active: true } },
                            { onSuccess: () => setNotice("userReactivated") },
                          );
                      }}
                    >
                      {user.active ? t("deactivate") : t("reactivate")}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <nav
            aria-label={t("userPages")}
            className="flex items-center justify-between gap-3"
          >
            <Button
              variant="outline"
              disabled={offset === 0}
              onClick={() => setOffset(offset - 20)}
            >
              {t("previous")}
            </Button>
            <span className="text-sm text-muted-foreground">
              {t("page", { page: offset / 20 + 1 })}
            </span>
            <Button
              variant="outline"
              disabled={users.data.length < 20}
              onClick={() => setOffset(offset + 20)}
            >
              {t("next")}
            </Button>
          </nav>
        </>
      )}
    </section>
  );
}
