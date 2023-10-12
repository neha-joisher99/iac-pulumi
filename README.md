# iac-pulumi
Infrastructure as Code

AWS Networking Setup
Setting up your networking infrastructure on Amazon Web Services (AWS) is a crucial step in deploying scalable and resilient applications. This README will guide you through the necessary steps to create a robust networking environment using AWS services. To ensure a reliable and repeatable setup, we'll also introduce Infrastructure as Code (IaC) with Pulumi.

Networking Infrastructure Setup
1. Create Virtual Private Cloud (VPC)
A Virtual Private Cloud (VPC) is your isolated network environment within AWS.
Follow AWS Console or CLI instructions to create a VPC.
2. Create Subnets
You must create 3 public subnets and 3 private subnets, each in different availability zones within the same region and VPC.
Each availability zone should have one public and one private subnet.
Properly distribute your subnets to ensure high availability.
3. Internet Gateway
Create an Internet Gateway resource.
Attach the Internet Gateway to the VPC to enable communication with the internet.
4. Public Route Table
Create a public route table.
Attach all public subnets to the public route table.
5. Private Route Table
Create a private route table.
Attach all private subnets to the private route table.
6. Public Route
In the public route table created above, define a route with the destination CIDR block 0.0.0.0/0.
Set the internet gateway created in step 3 as the target for this route to allow internet access for resources in the public subnets.
