# Deployment Guide

This repo uses three deployment tracks:

- Terraform for shared AWS infrastructure under `infra/terraform`
- AWS Syndicate for the backend application under `backend/restaurant-backend-app`
- Angular build artifacts synced to the frontend S3 bucket under `frontend/restaurant-frontend-app`

## Prerequisites

Install the tools below on your machine:

- AWS CLI configured with credentials for the target AWS account (`aws configure`) (https://docs.aws.amazon.com/cli/latest/userguide/getting-started-prereqs.html)
- Terraform 1.10 or newer (https://developer.hashicorp.com/terraform/install)
- Python 3.10-3.11 (https://www.python.org/downloads/release/python-3110/)
- .NET 10 SDK (https://dotnet.microsoft.com/en-us/download/dotnet/10.0)
- AWS Syndicate (`pip install aws-syndicate`) (https://github.com/epam/aws-syndicate)
- Node.js 22.x with npm (https://nodejs.org/en/download/archive/v22.0.0)

## Deployment order

Use this order:

1. Deploy Terraform infrastructure
2. Deploy the backend using Syndicate
3. Deploy the frontend to s3

Terraform then provisions or updates the shared AWS foundation, including the frontend S3 bucket and CloudFront distribution. Syndicate packages and deploys the backend application stack. After that, build the Angular app with the correct backend URL and sync it to S3.

## 1. Deploy Terraform infrastructure

Terraform manages the shared infrastructure resources in `infra/terraform`.

Before deploying, verify terraform config files:
Replace variables with your **AWS account ID** and **Email**

- `infra/terraform/backend.tf` - replace the Terraform state bucket name
- `infra/terraform/variables.tf` - replace the default `account_id` and `alert_emails`


Before running `terraform init`, create the Terraform state bucket with AWS CLI if it does not already exist. 
Get your AWS account ID from the CLI first:

Windows PowerShell:

```powershell
$ACCOUNT_ID = aws sts get-caller-identity --query Account --output text
```

Linux or macOS:

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
```

You can use AWS Console interface
AWS Management Console equivalent:
- Go to **S3** → **Create bucket** and use the bucket name **restaurant-terraform-state-$ACCOUNT_ID**
- Turn on **Versioning** in the bucket properties
- Leave **Block all public access** enabled
- Use **Default encryption** with SSE-S3 (AES256)

As alternative you can you AWS CLI
Replace the bucket name with the CLI variable:

Windows PowerShell:

```powershell
aws s3api create-bucket `
	--bucket restaurant-terraform-state-$ACCOUNT_ID `
	--region us-west-2 `
	--create-bucket-configuration LocationConstraint=us-west-2

aws s3api put-bucket-versioning `
	--bucket restaurant-terraform-state-$ACCOUNT_ID `
	--versioning-configuration Status=Enabled

aws s3api put-public-access-block `
		--bucket restaurant-terraform-state-$ACCOUNT_ID `
	--public-access-block-configuration `
		"BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

Linux or macOS:

```bash
aws s3api create-bucket \
	--bucket restaurant-terraform-state-$ACCOUNT_ID \
	--region us-west-2 \
	--create-bucket-configuration LocationConstraint=us-west-2

aws s3api put-bucket-versioning \
	--bucket restaurant-terraform-state-$ACCOUNT_ID \
	--versioning-configuration Status=Enabled

aws s3api put-public-access-block \
		--bucket restaurant-terraform-state-$ACCOUNT_ID \
	--public-access-block-configuration \
		"BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
```

### After bucket creation
```bash
cd ../../infra/terraform
terraform init
terraform fmt -check -recursive
terraform validate
terraform plan
terraform apply -auto-approve
```

## 2. Deploy the backend with Syndicate

The backend app is deployed from `backend/restaurant-backend-app`.

Before deploying, verify the Syndicate config files:
edit syndicate.yml → set project_path to your local absolute path to backend/restaurant-backend-app
Replace bucket names with your AWS account ID
- `.syndicate-config-restaurant-backend-app/syndicate.yml`
- `.syndicate-config-restaurant-backend-app/syndicate_aliases.yml`

On Windows PowerShell, run:

```powershell
cd ../../backend/restaurant-backend-app
python3 -m venv syndicate_venv
.\syndicate_venv\Scripts\Activate.ps1
pip install aws-syndicate
$env:SDCT_CONF = (Resolve-Path ".\.syndicate-config-restaurant-backend-app").Path
syndicate create-deploy-target-bucket
syndicate build
syndicate deploy --deploy_name dev
```

On Linux or macOS, run:

```bash
cd ../../backend/restaurant-backend-app
python3 -m venv syndicate_venv
source syndicate_venv/bin/activate
export SDCT_CONF="$(pwd)/.syndicate-config-restaurant-backend-app"
syndicate create-deploy-target-bucket
syndicate build
syndicate deploy --deploy_name dev
```

### Updating an existing deployment

For code or route changes on an already deployed stack, **do not** run `syndicate clean` + `deploy`:
`clean` deletes every resource, including all DynamoDB data. Build a new bundle and update in place:

```bash
export SDCT_CONF="$(pwd)/.syndicate-config-restaurant-backend-app"
syndicate build --bundle_name api_vN
syndicate update --bundle_name api_vN --update-only-types lambda --update-only-types api_gateway
```

`update` adds new API Gateway routes, removes routes that are no longer in `deployment_resources.json`
and redeploys the `develop` stage. To roll back, run `syndicate update` with the previous bundle name.

### Seed reference data

A fresh stack has empty tables, so nothing can be booked. Add locations, tables, dishes and placeholder
waiters (idempotent, safe to re-run):

```bash
python3 scripts/seed/seed_catalog.py --dry-run   # preview
python3 scripts/seed/seed_catalog.py --region <your-region>
```

## 3. Deploy the frontend

This section describes the manual deployment flow. It does not use GitHub Actions.

Terraform creates and configures everything needed for frontend hosting:

- the private frontend S3 bucket
- the bucket policy that allows CloudFront to read from it
- the CloudFront distribution that serves the site

You do not need to configure the bucket manually after `terraform apply`. The manual part is only building the frontend and uploading the files to S3.

### 3.1 Get the backend URL

Use the deployed API Gateway base URL as `BACKEND_URL`. Example:

```text
https://<api-id>.execute-api.us-west-2.amazonaws.com/develop
```

The production frontend build will fail unless `BACKEND_URL` is set.

To look it up in AWS:

```powershell
aws apigateway get-rest-apis --region us-west-2 --query "items[?name=='restaurant-backend-api'].{name:name,id:id}" --output table
```

Or set variables from AWS CLI:

Windows PowerShell:

```powershell
$API_ID = aws apigateway get-rest-apis --region us-west-2 --query "items[?name=='restaurant-backend-api'].id | [0]" --output text
$env:BACKEND_URL = "https://$API_ID.execute-api.us-west-2.amazonaws.com/develop"
```

Linux or macOS:

```bash
API_ID=$(aws apigateway get-rest-apis --region us-west-2 --query "items[?name=='restaurant-backend-api'].id | [0]" --output text)
export BACKEND_URL="https://$API_ID.execute-api.us-west-2.amazonaws.com/develop"
```

### 3.2 Build the production bundle

From the frontend app directory, install dependencies and build:

```powershell
cd ../../frontend/restaurant-frontend-app
npm ci
npm run build
```

The build process generates `src/environments/environment.production.ts` automatically from `BACKEND_URL` and writes the production bundle to `dist/restaurant-frontend-app/browser`.

### 3.3 Upload the bundle to S3

Upload the build in three groups, each with its own browser cache policy, then remove stale files.
Hashed bundles never change, so they are cached for a year; `assets/` keep stable names, so only for a day;
`index.html` is never cached so a new release is picked up immediately.

```bash
DIST=dist/restaurant-frontend-app/browser
BUCKET=s3://restaurant-frontend-$ACCOUNT_ID

aws s3 cp $DIST $BUCKET --recursive --exclude "*" --include "*.js" --include "*.css" --include "media/*" --cache-control "public, max-age=31536000, immutable"
aws s3 cp $DIST $BUCKET --recursive --exclude "*.js" --exclude "*.css" --exclude "media/*" --exclude "index.html" --cache-control "public, max-age=86400"
aws s3 cp $DIST/index.html $BUCKET/index.html --cache-control "no-cache"
aws s3 sync $DIST $BUCKET --delete
```

`aws s3 cp` is used instead of `sync` for the upload because `sync` skips unchanged files and would
never update their `Cache-Control` metadata. The final `sync --delete` only removes files in S3 that no
longer exist in the local build output.

Then drop the CloudFront cache so visitors get the new build:

```bash
aws cloudfront create-invalidation --distribution-id <distribution-id> --paths "/*"
```

### 3.4 Get the frontend URL

Get the CloudFront domain name from Terraform:

```powershell
cd ../../infra/terraform
terraform output cloudfront_distribution_domain_name
terraform output cloudfront_distribution_id
```

Use the returned domain name as the frontend host. Example:

```text
https://dxxxxxxxxxxxx.cloudfront.net
```

CloudFront does not provide a fixed public IP you should use. Use the distribution domain name instead.

## Clean up all resources

Use the reverse order of deployment:

1. Remove uploaded frontend files from the frontend S3 bucket
2. Clean up the backend resources deployed by Syndicate
3. Destroy the shared infrastructure managed by Terraform
4. Remove the Terraform state bucket
5. Remove the Syndicate artifacts bucket

### Remove frontend files from S3

The frontend bucket must be empty before Terraform can destroy it.

```powershell
aws s3 rm s3://restaurant-frontend-$ACCOUNT_ID/ --recursive
```

If you are not using the shared training account, replace the bucket name with your own account-specific frontend bucket.

### Clean up backend resources with Syndicate

From the backend project directory, use the same Syndicate configuration and run:

```powershell
cd ../../backend/restaurant-backend-app
$env:SDCT_CONF = (Resolve-Path ".\.syndicate-config-restaurant-backend-app").Path
syndicate clean
```

On Linux or macOS, use:

```bash
cd ../../backend/restaurant-backend-app
export SDCT_CONF="$(pwd)/.syndicate-config-restaurant-backend-app"
syndicate clean
```

This removes the backend resources that Syndicate deployed into the AWS account.

### Destroy Terraform-managed infrastructure

After the frontend bucket is empty and the backend resources are removed, destroy the shared infrastructure:

```powershell
cd ../../infra/terraform
terraform destroy -auto-approve
```

This removes the frontend S3 bucket, CloudFront distribution, and the rest of the infrastructure managed in `infra/terraform`.

### Clear versioned bucket

S3 bucket for storing terraform state have versioning configured. In order to delete it you must empty all versions created for s3 object.

- Go to **S3** select **restaurant-terraform-state-$ACCOUNT_ID** → **Empty Bucket**

### Remove the Terraform state bucket

The Terraform state bucket is configured in `infra/terraform/backend.tf` and is not deleted by `terraform destroy`. Empty it first and then delete it manually:

```powershell
aws s3api delete-bucket --bucket restaurant-terraform-state-$ACCOUNT_ID --region us-west-2
```

### Remove the Syndicate artifacts bucket

The Syndicate deploy target bucket is not managed by Terraform in this repo. If you also want to delete that bucket, empty it first and then remove it manually:

```powershell
aws s3 rm s3://marathon2026-restaurant-artifacts-$ACCOUNT_ID/ --recursive
aws s3api delete-bucket --bucket marathon2026-restaurant-artifacts-$ACCOUNT_ID --region us-west-2
```

Only do this if you are sure you no longer need the stored Syndicate build artifacts.