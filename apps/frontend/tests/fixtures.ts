import { userSchema, type Me, type User } from "@/lib/contracts";

export const tenantId = "ce19c2fb-b199-4b58-a274-113cd07ce416";
export const member: Me = {
  id: "11111111-1111-4111-8111-111111111111",
  tenant_id: tenantId,
  email: "ap@vantara.com.br",
  display_name: "Alex",
  active: true,
  principal_kind: "human",
  roles: ["ap"],
  unitIds: [],
  bankAccountIds: [],
  actorKind: "human",
  permissions: ["pay"],
  approvalScopes: [],
};
export const admin: Me = {
  ...member,
  email: "admin@vantara.com.br",
  roles: ["admin"],
  permissions: ["configure"],
};
export const other: User = userSchema.parse({
  ...member,
  id: "22222222-2222-4222-8222-222222222222",
  email: "other@example.com",
  display_name: "Taylor",
});
export const newUser = {
  email: "new@example.com",
  password: "Password1!",
  displayName: "New member",
  roles: ["ap"],
  unitIds: [],
  bankAccountIds: [],
};
