output "state_bucket" { value = aws_s3_bucket.state.id }

output "state_bucket_arn" { value = aws_s3_bucket.state.arn }

output "state_region" { value = var.region }
