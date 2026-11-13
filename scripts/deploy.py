"""Deploy the scanned digest; fail closed on migration or rollback. Uses AWS CLI v2."""
import json
import os
import subprocess


def aws(*args):
    return json.loads(subprocess.check_output(["aws", "ecs", *args, "--output", "json"]))


def register(family, container, image):
    definition = aws("describe-task-definition", "--task-definition", family)["taskDefinition"]
    allowed = {
        "family", "taskRoleArn", "executionRoleArn", "networkMode", "containerDefinitions",
        "volumes", "placementConstraints", "requiresCompatibilities", "cpu", "memory",
        "pidMode", "ipcMode", "proxyConfiguration", "inferenceAccelerators",
        "ephemeralStorage", "runtimePlatform", "enableFaultInjection",
    }
    definition = {k: v for k, v in definition.items() if k in allowed}
    target = next(c for c in definition["containerDefinitions"] if c["name"] == container)
    target["image"] = image
    return aws("register-task-definition", "--cli-input-json", json.dumps(definition))["taskDefinition"]["taskDefinitionArn"]


def deploy():
    app, cluster, service, image = (os.environ[k] for k in ("APP", "ECS_CLUSTER", "ECS_SERVICE", "DEPLOY_IMAGE"))
    if app == "backend":
        revision = register(os.environ["MIGRATION_FAMILY"], "migrate", image)
        result = aws("run-task", "--cluster", cluster, "--task-definition", revision,
                     "--launch-type", "FARGATE", "--network-configuration", os.environ["MIGRATION_NETWORK"])
        if result.get("failures") or not result.get("tasks"):
            raise RuntimeError(f"Migration task failed to start: {result}")
        task = result["tasks"][0]["taskArn"]
        subprocess.run(["aws", "ecs", "wait", "tasks-stopped", "--cluster", cluster, "--tasks", task], check=True)
        stopped = aws("describe-tasks", "--cluster", cluster, "--tasks", task)["tasks"][0]
        migration = next(c for c in stopped["containers"] if c["name"] == "migrate")
        if migration.get("exitCode") != 0:
            raise RuntimeError(f"Migration failed: {stopped.get('stoppedReason')}; inspect migration logs")
    before = aws("describe-services", "--cluster", cluster, "--services", service)["services"][0]
    revision = register(before["taskDefinition"], app, image)
    aws("update-service", "--cluster", cluster, "--service", service, "--task-definition", revision)
    subprocess.run(["aws", "ecs", "wait", "services-stable", "--cluster", cluster, "--services", service], check=True)
    after = aws("describe-services", "--cluster", cluster, "--services", service)["services"][0]
    if after["taskDefinition"] != revision or not any(d["taskDefinition"] == revision and d.get("rolloutState") == "COMPLETED" for d in after["deployments"]):
        raise RuntimeError("Deployment rolled back or did not complete")
    print(f"Deployed {app}: {image}")


if __name__ == "__main__":
    deploy()
