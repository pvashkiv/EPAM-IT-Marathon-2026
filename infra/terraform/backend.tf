terraform {
  required_version = ">= 1.10"

  backend "s3" {
    bucket       = "terraform-state-266727734800"
    key          = "restaurant/terraform.tfstate"
    region       = "eu-north-1"
    use_lockfile = true
    encrypt      = true
  }
}
