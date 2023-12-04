# iac-pulumi
Infrastructure as Code

AWS Networking Setup
Setting up your networking infrastructure on Amazon Web Services (AWS) is a crucial step in deploying scalable and resilient applications. This README will guide you through the necessary steps to create a robust networking environment using AWS services. To ensure a reliable and repeatable setup, we'll also introduce Infrastructure as Code (IaC) with Pulumi.


Overview
This Pulumi project is designed to provision and manage cloud resources for a web application. It utilizes AWS for hosting the application and its database and GCP for storage solutions. The project configures VPC, EC2 instances, RDS, SNS topics, IAM roles, security groups, Route 53 DNS services, and integrates GCP storage with AWS Secrets Manager.

Prerequisites
Pulumi CLI
Node.js
AWS CLI
GCP CLI

AWS and GCP accounts
Properly configured AWS and GCP credentials

Installation
Clone the Repository:
Clone the repository to your local machine.

Install Dependencies:
Navigate to the project directory and run npm install to install the necessary node modules.

Configuration
Create a .env file in the project root and set the following environment variables:
AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY
AWS_REGION
GCP_PROJECT_ID
GCP_CLIENT_EMAIL
GCP_PRIVATE_KEY

Deployment
Initialize Pulumi:
Run pulumi up to start the deployment process. This command will prompt you to review the infrastructure plan before applying changes.

Apply Changes:
Confirm the changes to start the deployment. Pulumi will provision the resources as defined in the code.

Monitor Deployment:
Use the Pulumi CLI or Pulumi Console to monitor the deployment progress and view outputs.

Resource Overview
The project sets up the following resources:
VPC and Subnets: Configures a VPC and both public and private subnets.
EC2 Instances: Deploys EC2 instances using launch templates.
RDS Instance: Provisions an RDS instance for the database.
SNS Topics: Sets up SNS topics for messaging.
IAM Roles and Policies: Creates necessary IAM roles and policies for various services.
Security Groups: Configures security groups for EC2, RDS, and Lambda functions.
Route 53: Sets up DNS services using AWS Route 53.
GCP Storage Bucket: Integrates a GCP storage bucket with AWS.
Lambda Functions: Deploys AWS Lambda functions for various tasks.
AWS Secrets Manager: Manages GCP service account keys using AWS Secrets Manager.

SSL Certificate Configuration for Demo Environment
In the demo environment, it's required to use an SSL certificate obtained from a vendor other than AWS Certificate Manager. This section outlines the steps to request, import, and configure an SSL certificate.

Requesting an SSL Certificate
Choose an SSL Vendor: Select a vendor like Namecheap or any other SSL certificate provider.
Purchase and Request Certificate: Follow the vendor's process to purchase and request an SSL certificate. You will typically need to provide details about your domain and verify domain ownership.
Download Certificate Files: Once your SSL certificate is issued, download the certificate files. Typically, you should receive a .crt file (certificate file) and a .key file (private key).
Importing SSL Certificate into AWS Certificate Manager
After obtaining your SSL certificate, import it into AWS Certificate Manager using the AWS CLI.

Open Terminal or Command Prompt: Ensure that you have AWS CLI installed and configured with the necessary permissions.

Navigate to Certificate Files: Change your directory to where your downloaded .crt and .key files are located.

Run AWS CLI Command:
Use the following command to import the certificate into AWS Certificate Manager:

aws acm import-certificate \
    --certificate fileb://<your-certificate-file>.crt \
    --private-key fileb://<your-private-key-file>.key \
    --certificate-chain fileb://<your-certificate-chain-file>.crt \
    --region <your-region>


Replace your-certificate-file, your-private-key-file, and your-certificate-chain-file with your actual file names. Set your-region to the AWS region you are using.


Cleanup
To delete the resources, run pulumi destroy. This command will remove all resources managed by Pulumi in this project.
