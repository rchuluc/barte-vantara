output "endpoint" { value = aws_db_instance.this.endpoint }

output "master_secret_arn" { value = aws_db_instance.this.master_user_secret[0].secret_arn }

output "runtime_secret_arn" { value = aws_secretsmanager_secret.runtime.arn }

output "bucket_arn" { value = aws_s3_bucket.this.arn }
output "ingestion_bucket_arn" { value = aws_s3_bucket.ingestion.arn }

output "ingestion_bucket_name" { value = aws_s3_bucket.ingestion.id }
