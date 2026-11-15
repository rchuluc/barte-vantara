import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

// Execute the actual inline workflow shell, not a second deployment implementation.
function runBlocks(path) {
  const lines = readFileSync(path, "utf8").split("\n");
  return lines.flatMap((line, index) => {
    const match = line.match(/^(\s*)run: \|$/);
    if (!match) return [];
    const indent = match[1].length + 2;
    const block = [];
    for (const next of lines.slice(index + 1)) {
      if (next.trim() && next.search(/\S/) < indent) break;
      block.push(next.slice(indent));
    }
    return [block.join("\n")];
  });
}

function mockAws() {
  const fs = require("node:fs");
  const args = process.argv.slice(2);
  const op = args[1];
  const scenario = process.env.SCENARIO;
  const app = process.env.APP;
  fs.appendFileSync(process.env.CALLS, JSON.stringify(args) + "\n");
  const value = (key) => args[args.indexOf(key) + 1];
  let result = {};
  if (op === "describe-task-definition") {
    const name = value("--task-definition") === "migration" ? "migrate" : app;
    result = {
      taskDefinition: {
        family: name,
        revision: 7,
        status: "ACTIVE",
        taskDefinitionArn: "old",
        registeredAt: "today",
        requiresAttributes: [],
        compatibilities: [],
        containerDefinitions: [
          {
            name: scenario === "missing-container" ? "wrong" : name,
            image: "old",
          },
          { name: "datadog", image: "agent", essential: true },
        ],
      },
    };
  } else if (op === "register-task-definition") {
    const definition = JSON.parse(value("--cli-input-json"));
    for (const key of [
      "revision",
      "status",
      "taskDefinitionArn",
      "registeredAt",
      "requiresAttributes",
      "compatibilities",
    ])
      if (key in definition) process.exit(9);
    if (
      definition.containerDefinitions[0].image !== process.env.DEPLOY_IMAGE ||
      definition.containerDefinitions[1].image !== "agent" ||
      !definition.containerDefinitions[1].essential
    )
      process.exit(9);
    result = { taskDefinition: { taskDefinitionArn: "new" } };
  } else if (op === "run-task") {
    result =
      scenario === "start-failure"
        ? { failures: [{ reason: "capacity" }], tasks: [] }
        : { tasks: [{ taskArn: "task" }], failures: [] };
  } else if (op === "describe-tasks") {
    result = {
      tasks: [
        {
          containers: [
            {
              name: "migrate",
              ...(scenario === "missing-exit"
                ? {}
                : { exitCode: scenario === "migration-failure" ? 1 : 0 }),
            },
          ],
        },
      ],
    };
  } else if (op === "update-service") {
    fs.writeFileSync(process.env.UPDATED, "yes");
  } else if (op === "wait" && scenario === "wait-failure") {
    process.exit(255);
  } else if (op === "describe-services") {
    const updated = fs.existsSync(process.env.UPDATED);
    const revision = updated && scenario !== "rollback" ? "new" : "old";
    result = {
      services: [
        {
          taskDefinition: revision,
          desiredCount: scenario === "zero-capacity" ? 0 : 1,
          runningCount: scenario === "zero-capacity" ? 0 : 1,
          pendingCount: 0,
          deployments: [
            {
              taskDefinition: revision,
              rolloutState:
                scenario === "incomplete" ? "IN_PROGRESS" : "COMPLETED",
            },
          ],
        },
      ],
    };
  } else if (op !== "wait") {
    process.exit(99);
  }
  console.log(JSON.stringify(result));
}

for (const app of ["frontend", "backend"]) {
  const scenarios = [
    "success",
    "rollback",
    "zero-capacity",
    "incomplete",
    "missing-container",
    "wait-failure",
  ];
  if (app === "backend")
    scenarios.push("start-failure", "migration-failure", "missing-exit");
  for (const scenario of scenarios) {
    test(`${app}: ${scenario}`, () => {
      const dir = mkdtempSync(join(tmpdir(), "actions-test-"));
      try {
        writeFileSync(
          join(dir, "aws"),
          `#!${process.execPath}\n(${mockAws.toString()})();`,
          { mode: 0o755 },
        );
        const result = spawnSync(
          "bash",
          [
            "-e",
            "-o",
            "pipefail",
            "-c",
            runBlocks(".github/actions/ecs-deploy/action.yml")[0],
          ],
          {
            encoding: "utf8",
            env: {
              ...process.env,
              PATH: `${dir}:${process.env.PATH}`,
              APP: app,
              SCENARIO: scenario,
              DEPLOY_IMAGE: `example.invalid/app@sha256:${"a".repeat(64)}`,
              ECS_CLUSTER: "cluster",
              ECS_SERVICE: app,
              MIGRATION_FAMILY: "migration",
              MIGRATION_NETWORK: "{}",
              CALLS: join(dir, "calls"),
              UPDATED: join(dir, "updated"),
              GITHUB_STEP_SUMMARY: join(dir, "summary"),
            },
          },
        );
        assert.equal(
          result.status === 0,
          scenario === "success",
          result.stdout + result.stderr,
        );
        const calls = readFileSync(join(dir, "calls"), "utf8")
          .trim()
          .split("\n")
          .map(JSON.parse);
        if (app === "frontend")
          assert.ok(!calls.some((args) => args[1] === "run-task"));
        if (
          [
            "start-failure",
            "migration-failure",
            "missing-exit",
            "missing-container",
          ].includes(scenario)
        )
          assert.ok(!calls.some((args) => args[1] === "update-service"));
        if (scenario === "success" && app === "backend")
          assert.ok(
            calls.findIndex((args) => args[1] === "describe-tasks") <
              calls.findIndex((args) => args[1] === "update-service"),
          );
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  }
}

for (const status of [0, 1, 2]) {
  test(`Terraform plan exit ${status}`, () => {
    const dir = mkdtempSync(join(tmpdir(), "plan-test-"));
    try {
      writeFileSync(
        join(dir, "terraform"),
        `#!/bin/bash\nif [[ "$2" == plan ]]; then exit ${status}; fi\nprintf '%s' '{"resource_changes":[{"change":{"actions":["create"]}},{"change":{"actions":["delete","create"]}},{"change":{"actions":["update"]}}]}'\n`,
        { mode: 0o755 },
      );
      const block = runBlocks(".github/workflows/ci-infrastructure.yml").find(
        (value) => value.includes("-detailed-exitcode"),
      );
      const output = join(dir, "output");
      const result = spawnSync("bash", ["-e", "-o", "pipefail", "-c", block], {
        encoding: "utf8",
        env: {
          ...process.env,
          PATH: `${dir}:${process.env.PATH}`,
          RUNNER_TEMP: dir,
          GITHUB_OUTPUT: output,
          STATE_BUCKET: "bucket",
          STATE_KEY: "state",
        },
      });
      assert.equal(result.status === 0, status !== 1, result.stderr);
      assert.match(
        readFileSync(output, "utf8"),
        status === 1 ? /Plan failed/ : /2 to add, 1 to change, 1 to destroy/,
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}
