variable "aws_region" {
  description = "AWS region for all resources except CloudFront/ACM globals"
  type        = string
  default     = "eu-north-1"
}

variable "account_id" {
  description = "AWS 266727734800"
  type        = string
  default     = "266727734800"
}

variable "alert_emails" {
  description = "Email addresses subscribed to CloudWatch alerts and Budget notifications."
  type        = list(string)
  default     = ["vashkivp@gmail.com"]
}
