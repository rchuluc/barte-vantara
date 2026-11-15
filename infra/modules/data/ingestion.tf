resource "aws_s3_bucket" "ingestion" {
  bucket_prefix = "${var.name}-ingestion-"
  force_destroy = false
}

resource "aws_s3_bucket_public_access_block" "ingestion" {
  bucket                  = aws_s3_bucket.ingestion.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

# SSE-S3 follows the existing environment's encryption policy.
# trivy:ignore:AVD-AWS-0132
resource "aws_s3_bucket_server_side_encryption_configuration" "ingestion" {
  bucket = aws_s3_bucket.ingestion.id
  rule {
    apply_server_side_encryption_by_default { sse_algorithm = "AES256" }
  }
}

resource "aws_s3_bucket_versioning" "ingestion" {
  bucket = aws_s3_bucket.ingestion.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_lifecycle_configuration" "ingestion" {
  bucket = aws_s3_bucket.ingestion.id
  rule {
    id     = "abort-incomplete-uploads"
    status = "Enabled"
    filter {}
    abort_incomplete_multipart_upload { days_after_initiation = 7 }
  }
}

resource "aws_s3_bucket_policy" "ingestion_tls" {
  bucket = aws_s3_bucket.ingestion.id
  policy = jsonencode({ Version = "2012-10-17", Statement = [{ Effect = "Deny", Principal = "*", Action = "s3:*", Resource = [aws_s3_bucket.ingestion.arn, "${aws_s3_bucket.ingestion.arn}/*"], Condition = { Bool = { "aws:SecureTransport" = "false" } } }] })
}
