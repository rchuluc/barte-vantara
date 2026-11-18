import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { WorkspaceProvider, useTenant } from "@/components/workspace-provider";
import { WorkspaceShell } from "@/components/workspace-shell";
import { LoginScreen } from "@/components/login-screen";
import { AccountScreen } from "@/components/account-screen";
import { UsersScreen } from "@/components/users-screen";
import { UserEditor } from "@/components/user-editor";
import NewUserPage from "@/app/[tenant]/(workspace)/users/new/page";
import { member, admin, other, newUser } from "./fixtures";
import type { Me, User } from "@/lib/contracts";
import LoginPage from "@/app/[tenant]/login/page";
import DashboardPage from "@/app/[tenant]/(workspace)/dashboard/page";
import ProfilePage from "@/app/[tenant]/(workspace)/profile/page";
import UsersPage from "@/app/[tenant]/(workspace)/users/page";
import WorkspaceLayout from "@/app/[tenant]/(workspace)/layout";

const navigation = vi.hoisted(() => ({
  replace: vi.fn(),
  push: vi.fn(),
  pathname: "/dashboard",
}));
vi.mock("next/navigation", () => ({
  useRouter: () => navigation,
  usePathname: () => navigation.pathname,
}));

const fetchMock = vi.fn<typeof fetch>();
let identity: Me;
let people: User[];

function mount(children: React.ReactNode) {
  return render(
    <WorkspaceProvider tenant={{ slug: "vantara", name: "Vantara" }}>
      {children}
    </WorkspaceProvider>,
  );
}

function fill(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

beforeEach(() => {
  identity = { ...member };
  people = [other];
  navigation.replace.mockReset();
  navigation.push.mockReset();
  navigation.pathname = "/dashboard";
  fetchMock.mockReset().mockImplementation(async (url, options) => {
    const path = String(url);
    if (path.endsWith("/me") || path.endsWith("/signin"))
      return Response.json(identity);
    if (path.endsWith("/logout") || options?.method === "DELETE")
      return new Response(null, { status: 204 });
    if (path.endsWith("/users/roles"))
      return Response.json([
        { role: "ap", permissions: ["pay"] },
        { role: "admin", permissions: ["configure"] },
      ]);
    if (path.endsWith("/business-units"))
      return Response.json([{ id: other.id, name: "HQ", active: true }]);
    if (path.endsWith("/bank-accounts"))
      return Response.json([
        {
          id: other.id,
          unit_ids: [other.id],
          configurable: true,
          bank_code: "341",
          account_ref: "123",
          currency: "BRL",
          active: true,
        },
      ]);
    if (options?.method === "POST" || options?.method === "PATCH")
      return Response.json(other);
    return Response.json(people);
  });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

it("submits login through the hook, toggles password visibility, and navigates on success", async () => {
  mount(<LoginPage />);
  fill("Work email", "ap@vantara.com.br");
  fill("Password", "secret");
  expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
  fireEvent.click(screen.getByRole("button", { name: "Show password" }));
  expect(screen.getByLabelText("Password")).toHaveAttribute("type", "text");
  fireEvent.click(screen.getByRole("button", { name: "Hide password" }));
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await waitFor(() =>
    expect(navigation.replace).toHaveBeenCalledWith("/dashboard"),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/signin",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({ email: member.email, password: "secret" }),
    }),
  );
});

it("completes invited administrator password replacement before navigation", async () => {
  fetchMock
    .mockResolvedValueOnce(Response.json({ requiresNewPassword: true }))
    .mockResolvedValueOnce(Response.json(member));
  mount(<LoginScreen />);
  fill("Work email", member.email);
  fill("Password", "temporary");
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  await screen.findByLabelText("New password");
  expect(navigation.replace).not.toHaveBeenCalled();
  expect(screen.queryByLabelText("Work email")).not.toBeInTheDocument();
  expect(screen.getByLabelText("New password")).toHaveValue("");
  fill("New password", "Replacement123!");
  fireEvent.click(
    screen.getByRole("button", { name: "Set password and sign in" }),
  );
  await waitFor(() =>
    expect(navigation.replace).toHaveBeenCalledWith("/dashboard"),
  );
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/signin/password",
    expect.objectContaining({
      body: JSON.stringify({ newPassword: "Replacement123!" }),
    }),
  );
});

it("can leave password replacement and restart sign in", async () => {
  fetchMock.mockResolvedValueOnce(Response.json({ requiresNewPassword: true }));
  mount(<LoginScreen />);
  fill("Work email", member.email);
  fill("Password", "temporary");
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  fireEvent.click(
    await screen.findByRole("button", { name: "Back to sign in" }),
  );
  expect(screen.getByLabelText("Work email")).toBeInTheDocument();
});

it("shows pending login and recoverable invalid-credential feedback", async () => {
  let resolve!: (value: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  mount(<LoginScreen />);
  fill("Work email", member.email);
  fill("Password", "wrong");
  fireEvent.click(screen.getByRole("button", { name: "Sign in" }));
  expect(
    await screen.findByRole("button", { name: /Signing in/ }),
  ).toBeDisabled();
  await act(async () => resolve(new Response(null, { status: 401 })));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    /check your email and password/,
  );
  expect(navigation.replace).not.toHaveBeenCalled();
});

it("renders a member sidebar, profile navigation and signs out", async () => {
  mount(
    <WorkspaceLayout>
      <p>Private content</p>
    </WorkspaceLayout>,
  );
  expect(screen.getByRole("status")).toHaveTextContent("Loading");
  expect(await screen.findByText("Private content")).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "My profile" })).toHaveAttribute(
    "href",
    "/profile",
  );
  expect(
    screen.queryByRole("link", { name: "User management" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Overview" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  await waitFor(() =>
    expect(navigation.replace).toHaveBeenCalledWith("/login"),
  );
});

it("renders admin navigation and fallback display names", async () => {
  identity = { ...admin, display_name: "" };
  navigation.pathname = "/users";
  mount(
    <WorkspaceShell>
      <p>Private</p>
    </WorkspaceShell>,
  );
  expect(
    await screen.findByRole("link", { name: "User management" }),
  ).toHaveAttribute("aria-current", "page");
  expect(
    screen.queryByRole("link", { name: "My profile" }),
  ).not.toBeInTheDocument();
  expect(screen.getByText("Workspace administrator")).toBeInTheDocument();
});

it("does not reveal protected content on failure and can retry", async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
  mount(
    <WorkspaceShell>
      <p>Private</p>
    </WorkspaceShell>,
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "temporarily unavailable",
  );
  expect(screen.queryByText("Private")).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Return to sign in" }),
  ).toHaveAttribute("href", "/login");
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(await screen.findByText("Private")).toBeInTheDocument();
});

it("redirects expired sessions", async () => {
  fetchMock.mockResolvedValue(new Response(null, { status: 401 }));
  const view = mount(
    <WorkspaceShell>
      <p>Private</p>
    </WorkspaceShell>,
  );
  await waitFor(() =>
    expect(navigation.replace).toHaveBeenCalledWith("/login"),
  );
  view.unmount();
});

it("keeps logout failures visible and allows retry", async () => {
  mount(
    <WorkspaceShell>
      <p>Private</p>
    </WorkspaceShell>,
  );
  await screen.findByText("Private");
  let resolve!: (value: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
  expect(
    await screen.findByRole("button", { name: "Signing out…" }),
  ).toBeDisabled();
  await act(async () => resolve(new Response(null, { status: 503 })));
  expect(await screen.findByRole("alert")).toBeInTheDocument();
  expect(navigation.replace).not.toHaveBeenCalled();
});

it("shows dashboard account details and full profile scopes", async () => {
  identity = {
    ...member,
    unitIds: [other.id],
    bankAccountIds: [other.id],
    approvalScopes: [{ unit_id: other.id, permission: "approve" }],
  };
  mount(<ProfilePage />);
  expect(screen.getByRole("status")).toBeInTheDocument();
  expect(
    await screen.findByRole("heading", { name: "My profile" }),
  ).toBeInTheDocument();
  expect(screen.getByText("Active")).toBeInTheDocument();
  expect(screen.getByText(`${other.id}: approve`)).toBeInTheDocument();
  expect(screen.getByText("pay")).toBeInTheDocument();
});

it("shows empty scope messages and absent display name", async () => {
  identity = { ...member, display_name: "", active: false, permissions: [] };
  mount(<AccountScreen profile />);
  expect(await screen.findByText("Not set")).toBeInTheDocument();
  expect(screen.getByText("Inactive")).toBeInTheDocument();
  expect(screen.getAllByText("None assigned")).toHaveLength(4);
});

it("renders the centered overview greeting", async () => {
  mount(<DashboardPage />);
  expect(
    await screen.findByRole("heading", { name: "Welcome, Alex" }),
  ).toBeInTheDocument();
});

it("uses email when the overview display name is absent", async () => {
  identity = { ...member, display_name: "" };
  mount(<AccountScreen />);
  expect(
    await screen.findByRole("heading", { name: `Welcome, ${member.email}` }),
  ).toBeInTheDocument();
});

it("directs admins to overview instead of member profile", async () => {
  identity = admin;
  mount(<AccountScreen profile />);
  expect(await screen.findByRole("alert")).toHaveTextContent("Overview");
});

it("retries account loading failures", async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));
  mount(<AccountScreen />);
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  expect(
    await screen.findByRole("heading", { name: "Welcome, Alex" }),
  ).toBeInTheDocument();
});

it("does not fetch user management data for non-admins", async () => {
  mount(<UsersPage />);
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Administrator access required",
  );
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("retries authorization loading failures before showing admin data", async () => {
  identity = admin;
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
  mount(<UsersScreen />);
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  expect(
    await screen.findByRole("heading", { name: "User management" }),
  ).toBeInTheDocument();
});

it("creates a user with role and scope validation", async () => {
  identity = admin;
  const list = mount(<UsersScreen />);
  expect(await screen.findByRole("link", { name: "Add user" })).toHaveAttribute(
    "href",
    "/users/new",
  );
  list.unmount();
  mount(<NewUserPage />);
  await screen.findByLabelText("Display name");
  fill("Display name", newUser.displayName);
  fill("Email address", newUser.email);
  fill("Initial password", newUser.password);
  fireEvent.click(screen.getByRole("button", { name: "Save user" }));
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "Select at least one role",
  );
  expect(screen.getByLabelText("ap")).toHaveFocus();
  fireEvent.click(screen.getByLabelText("ap"));
  await waitFor(() =>
    expect(screen.getByLabelText("Business units")).toBeEnabled(),
  );
  fireEvent.click(screen.getByLabelText("Business units"));
  fireEvent.click(await screen.findByRole("option", { name: "HQ" }));
  fireEvent.keyDown(screen.getByPlaceholderText("Search…"), { key: "Escape" });
  await waitFor(() =>
    expect(screen.getByLabelText("Business units")).toHaveFocus(),
  );
  fireEvent.click(screen.getByLabelText("Bank accounts"));
  fireEvent.click(
    await screen.findByRole("option", { name: "341 · 123 · BRL" }),
  );
  fireEvent.keyDown(screen.getByPlaceholderText("Search…"), { key: "Escape" });
  fireEvent.click(screen.getByRole("button", { name: "Save user" }));
  await waitFor(() => expect(navigation.push).toHaveBeenCalledWith("/users"));
  expect(fetchMock).toHaveBeenCalledWith(
    "/api/users",
    expect.objectContaining({
      method: "POST",
      body: JSON.stringify({
        displayName: newUser.displayName,
        roles: ["ap"],
        unitIds: [other.id],
        bankAccountIds: [other.id],
        email: newUser.email,
        password: newUser.password,
      }),
    }),
  );
});

it("edits a user, retains scopes, and does not expose password or email editing", async () => {
  identity = admin;
  people = [{ ...other, unitIds: [other.id], bankAccountIds: [other.id] }];
  mount(<UsersScreen />);
  fireEvent.click(
    await screen.findByRole("button", { name: `Edit ${other.email}` }),
  );
  expect(await screen.findByLabelText("Display name")).toHaveValue("Taylor");
  expect(screen.getByLabelText("ap")).toBeChecked();
  expect(screen.queryByLabelText("Initial password")).not.toBeInTheDocument();
  fill("Display name", "Updated");
  fireEvent.click(screen.getByRole("button", { name: "Save user" }));
  await waitFor(() =>
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/users/${other.id}`,
      expect.objectContaining({
        method: "PATCH",
        body: JSON.stringify({
          displayName: "Updated",
          roles: ["ap"],
          unitIds: [other.id],
          bankAccountIds: [other.id],
        }),
      }),
    ),
  );
});

it("cancels editing without saving", async () => {
  const close = vi.fn();
  mount(<UserEditor close={close} />);
  fireEvent.click(await screen.findByRole("button", { name: "Cancel" }));
  expect(close).toHaveBeenCalledOnce();
});

it("keeps fields and errors on failed save, with pending feedback", async () => {
  mount(<UserEditor user={other} close={vi.fn()} />);
  await screen.findByLabelText("Display name");
  let resolve!: (value: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save user" }));
  expect(await screen.findByRole("button", { name: "Saving…" })).toBeDisabled();
  await act(async () => resolve(new Response(null, { status: 409 })));
  expect(await screen.findByRole("alert")).toHaveTextContent("conflicts");
  expect(screen.getByLabelText("Display name")).toHaveValue("Taylor");
});

it("retries unavailable role catalogs", async () => {
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
  mount(<UserEditor close={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  expect(await screen.findByLabelText("ap")).toBeInTheDocument();
});

it("confirms deactivation, supports cancellation, and prevents self-administration", async () => {
  identity = admin;
  people = [admin, other];
  mount(<UsersScreen />);
  expect(
    await screen.findByRole("button", { name: `Edit ${admin.email}` }),
  ).toBeDisabled();
  expect(
    screen.getByRole("button", { name: `Deactivate ${admin.email}` }),
  ).toBeDisabled();
  fireEvent.click(
    screen.getByRole("button", { name: `Deactivate ${other.email}` }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Cancel deactivation" }));
  expect(
    screen.queryByRole("button", { name: "Confirm deactivation" }),
  ).not.toBeInTheDocument();
  fireEvent.click(
    screen.getByRole("button", { name: `Deactivate ${other.email}` }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm deactivation" }));
  expect(await screen.findByRole("status")).toHaveTextContent(
    "User deactivated.",
  );
});

it("shows pending deactivation and handles backend denial", async () => {
  identity = admin;
  mount(<UsersScreen />);
  fireEvent.click(
    await screen.findByRole("button", { name: `Deactivate ${other.email}` }),
  );
  let resolve!: (value: Response) => void;
  fetchMock.mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Confirm deactivation" }));
  expect(
    await screen.findByRole("button", { name: "Deactivating…" }),
  ).toBeDisabled();
  await act(async () => resolve(new Response(null, { status: 403 })));
  await waitFor(() =>
    expect(
      screen
        .getAllByRole("alert")
        .some((alert) => alert.textContent?.includes("do not have access")),
    ).toBe(true),
  );
});

it("reactivates inactive users and displays errors on failed reactivation", async () => {
  identity = admin;
  people = [{ ...other, active: false, display_name: "" }];
  mount(<UsersScreen />);
  fireEvent.click(
    await screen.findByRole("button", { name: `Reactivate ${other.email}` }),
  );
  expect(await screen.findByRole("status")).toHaveTextContent(
    "User reactivated.",
  );
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 403 }));
  fireEvent.click(
    screen.getByRole("button", { name: `Reactivate ${other.email}` }),
  );
  expect(await screen.findByRole("alert")).toHaveTextContent(
    "do not have access",
  );
});

it("pages through users, handles empty pages, and retries listing failures", async () => {
  identity = admin;
  people = Array.from({ length: 20 }, (_, index) => ({
    ...other,
    id: `22222222-2222-4222-8222-${String(index).padStart(12, "0")}`,
    email: `user${index}@example.com`,
  }));
  mount(<UsersScreen />);
  await screen.findByText("user19@example.com");
  expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  people = [];
  fireEvent.click(screen.getByRole("button", { name: "Next" }));
  expect(await screen.findByText("No users on this page")).toBeInTheDocument();
  expect(screen.getByText("Page 2")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Previous" }));
  expect(await screen.findByText("Page 1")).toBeInTheDocument();
});

it("recovers from user-list failures", async () => {
  identity = admin;
  fetchMock
    .mockResolvedValueOnce(Response.json(admin))
    .mockResolvedValueOnce(new Response(null, { status: 503 }));
  mount(<UsersScreen />);
  fireEvent.click(await screen.findByRole("button", { name: "Try again" }));
  expect(await screen.findByText(other.email)).toBeInTheDocument();
});

it("requires tenant context", () => {
  function Broken() {
    useTenant();
    return null;
  }
  expect(() => render(<Broken />)).toThrow("WorkspaceProvider is required");
});
