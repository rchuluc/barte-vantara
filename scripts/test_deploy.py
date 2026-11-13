import os
import unittest
from unittest.mock import patch
import deploy


class DeploymentTests(unittest.TestCase):
    def test_registration_strips_response_fields_and_preserves_sidecar(self):
        definition = {"family": "backend", "revision": 7, "status": "ACTIVE", "containerDefinitions": [
            {"name": "backend", "image": "old"}, {"name": "datadog", "image": "agent"}]}
        with patch.object(deploy, "aws", side_effect=[{"taskDefinition": definition}, {"taskDefinition": {"taskDefinitionArn": "new"}}]) as aws:
            self.assertEqual(deploy.register("backend", "backend", "digest"), "new")
            import json
            registered = json.loads(aws.call_args.args[2])
            self.assertNotIn("revision", registered)
            self.assertEqual(registered["containerDefinitions"][0]["image"], "digest")
            self.assertEqual(registered["containerDefinitions"][1]["image"], "agent")

    @patch.dict(os.environ, {"APP": "backend", "ECS_CLUSTER": "cluster", "ECS_SERVICE": "backend", "DEPLOY_IMAGE": "digest", "MIGRATION_FAMILY": "migration", "MIGRATION_NETWORK": "{}"})
    def test_failed_migration_blocks_service_update(self):
        with patch.object(deploy, "register", return_value="revision"), patch.object(deploy.subprocess, "run"), patch.object(deploy, "aws", side_effect=[
            {"tasks": [{"taskArn": "task"}]},
            {"tasks": [{"containers": [{"name": "migrate", "exitCode": 1}], "stoppedReason": "failed"}]},
        ]) as aws:
            with self.assertRaisesRegex(RuntimeError, "Migration failed"):
                deploy.deploy()
            self.assertFalse(any(call.args[0] == "update-service" for call in aws.call_args_list))

    @patch.dict(os.environ, {"APP": "frontend", "ECS_CLUSTER": "cluster", "ECS_SERVICE": "frontend", "DEPLOY_IMAGE": "digest"})
    def test_ecs_rollback_is_not_reported_as_success(self):
        with patch.object(deploy, "register", return_value="new"), patch.object(deploy.subprocess, "run"), patch.object(deploy, "aws", side_effect=[
            {"services": [{"taskDefinition": "old"}]}, {},
            {"services": [{"taskDefinition": "old", "deployments": []}]},
        ]):
            with self.assertRaisesRegex(RuntimeError, "rolled back"):
                deploy.deploy()

    @patch.dict(os.environ, {"APP": "frontend", "ECS_CLUSTER": "cluster", "ECS_SERVICE": "frontend", "DEPLOY_IMAGE": "digest"})
    def test_frontend_deploy_does_not_run_migrations(self):
        with patch.object(deploy, "register", return_value="new"), patch.object(deploy.subprocess, "run"), patch.object(deploy, "aws", side_effect=[
            {"services": [{"taskDefinition": "old"}]}, {},
            {"services": [{"taskDefinition": "new", "deployments": [{"taskDefinition": "new", "rolloutState": "COMPLETED"}]}]},
        ]) as aws:
            deploy.deploy()
            self.assertFalse(any(call.args[0] == "run-task" for call in aws.call_args_list))
