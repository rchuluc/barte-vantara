// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

it("keeps authored JSX text and accessible labels in translation catalogs", () => {
  const names = new Set([
    "Vantara",
    "Protheus",
    "Omie",
    "Protheus + Omie",
    "Português (Brasil)",
    "English",
    "Español",
  ]);
  const violations: string[] = [];

  function inspect(directory: string) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) inspect(path);
      else if (path.endsWith(".tsx")) {
        const source = ts.createSourceFile(
          path,
          readFileSync(path, "utf8"),
          ts.ScriptTarget.Latest,
          true,
          ts.ScriptKind.TSX,
        );
        function visit(node: ts.Node) {
          if (
            ts.isJsxText(node) &&
            /[a-zA-ZÀ-ÿ]/.test(node.text) &&
            !names.has(node.text.trim())
          )
            violations.push(`${path}: ${node.text.trim()}`);
          if (
            ts.isJsxAttribute(node) &&
            ["aria-label", "placeholder", "title", "alt"].includes(
              node.name.getText(source),
            ) &&
            node.initializer &&
            ts.isStringLiteral(node.initializer) &&
            /[a-zA-ZÀ-ÿ]/.test(node.initializer.text)
          )
            violations.push(`${path}: ${node.getText(source)}`);
          ts.forEachChild(node, visit);
        }
        visit(source);
      }
    }
  }

  inspect("src/components");
  inspect("src/app");
  expect(violations).toEqual([]);
});
