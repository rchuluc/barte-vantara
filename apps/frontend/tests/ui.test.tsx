import { render, screen } from "./render";
import Link from "next/link";
import { expect, it } from "vitest";
import {
  Field,
  FieldContent,
  FieldTitle,
  FieldDescription,
  FieldSeparator,
  FieldError,
} from "@/components/ui/field";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";

it("supports descriptive horizontal fields, section separators and linked badges", () => {
  render(
    <>
      <Field orientation="horizontal">
        <FieldContent>
          <FieldTitle>Notifications</FieldTitle>
          <FieldDescription>Manage updates</FieldDescription>
        </FieldContent>
      </Field>
      <FieldSeparator>Account</FieldSeparator>
      <FieldSeparator />
      <Separator orientation="vertical" decorative={false} />
      <Badge asChild>
        <Link href="/profile">Profile</Link>
      </Badge>
    </>,
  );
  expect(screen.getByText("Manage updates")).toBeInTheDocument();
  expect(screen.getByText("Account")).toBeInTheDocument();
  expect(screen.getByRole("separator")).toHaveAttribute(
    "aria-orientation",
    "vertical",
  );
  expect(screen.getByRole("link", { name: "Profile" })).toHaveAttribute(
    "href",
    "/profile",
  );
});

it("announces field errors and deduplicates validation messages", () => {
  const { rerender } = render(<FieldError />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  rerender(<FieldError>Required field</FieldError>);
  expect(screen.getByRole("alert")).toHaveTextContent("Required field");
  rerender(
    <FieldError errors={[{ message: "Invalid" }, { message: "Invalid" }]} />,
  );
  expect(screen.getByRole("alert")).toHaveTextContent("Invalid");
  rerender(<FieldError errors={[undefined]} />);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  rerender(
    <FieldError
      errors={[{ message: "Invalid" }, { message: "Required" }, undefined]}
    />,
  );
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
});
