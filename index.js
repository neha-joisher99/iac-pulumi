const pulumi = require('@pulumi/pulumi');
const aws = require('@pulumi/aws');
const sdk = require("aws-sdk");
const fs= require('fs')
const gcp = require("@pulumi/gcp");
const { Topic } = require('@pulumi/aws/sns');
const { accessKey } = require('@pulumi/aws/config');
const dotenv =require('dotenv');

dotenv.config();

const config = new pulumi.Config();
const healthCheckPath=config.require('healthCheckPath')
const vpcCidr = config.require('vpcCidr');
const vpcName = config.require('vpcName');
const internetgateway = config.require('internetGateway');
const instanceTypeEC2 = config.require('instanceTypeEC2');
const volumeSize = config.require('volumeSize');
const volumeType = config.require('volumeType');
const keyNames = config.require('keyname');
let AMMMID = config.require('amiId');
let ip1 = config.require('ip1');
let domainName = config.require('domainName')
const serverPort=config.require('serverPort')
const sslCertificateArn=config.require('sslCertificateArn')

console.log(process.env.API_KEY)
console.log(process.env.DOMAIN)


let snsTopic
let loadBalancer 
let instance;
let rdsInstance;
let mysecret;

snsTopic = new aws.sns.Topic("assignment_submission", {});

const vpc = new aws.ec2.Vpc(vpcName, {
    cidrBlock: vpcCidr,
    enableDnsSupport: true,
    enableDnsHostnames: true,
    tags: { Name: 'my-vpc' },
});

const internetGateway = new aws.ec2.InternetGateway(internetgateway, {
    vpcId: vpc.id,
    tags: { Name: 'internet-gateway' },
});

const publicRouteTable = new aws.ec2.RouteTable('public-route-table', {
    vpcId: vpc.id,
    tags: { Name: 'public-route-table' },
});

const publicRoute = new aws.ec2.Route('public-route', {
    routeTableId: publicRouteTable.id,
    destinationCidrBlock: '0.0.0.0/0',
    gatewayId: internetGateway.id,
});

const privateRouteTable = new aws.ec2.RouteTable('private-route-table', {
    vpcId: vpc.id,
    tags: { Name: 'private-route-table' },
});

const publicSubnets = [];
const privateSubnets = [];
let availabilityZones = [];

async function listAvailabilityZones() {
    const awsConfig = new pulumi.Config('aws');
    const selectedRegion = awsConfig.require('region');
    const selectedProvider = new aws.Provider('selected-provider', {
        region: selectedRegion,
    });
    availabilityZones = await aws.getAvailabilityZones({}, { provider: selectedProvider });
    pulumi.log.info(`Availability Zones in ${selectedRegion}: ${availabilityZones.names}`);
    return availabilityZones;
}


async function createSubnets() {
    await listAvailabilityZones();
    for (let i = 0; i < 3; i++) {
        const publicSubnet = new aws.ec2.Subnet(`publicSubnet${i}`, {
            vpcId: vpc.id,
            cidrBlock: pulumi.interpolate `10.0.${i}.0/24`,
            availabilityZone: availabilityZones.names[i],
            mapPublicIpOnLaunch: true,
            tags: {
                Name: `Public Subnet ${i + 1}`,
            },
        });
        publicSubnets.push(publicSubnet);

        const privateSubnet = new aws.ec2.Subnet(`privateSubnet${i}`, {
            vpcId: vpc.id,
            cidrBlock: pulumi.interpolate `10.0.${i + 100}.0/24`,
            availabilityZone: availabilityZones.names[i],
            tags: {
                Name: `Private Subnet ${i + 1}`,
            },
        });
        privateSubnets.push(privateSubnet);

        new aws.ec2.RouteTableAssociation(`public-subnet-association-${i}`, {
            subnetId: publicSubnet.id,
            routeTableId: publicRouteTable.id,
        });

        new aws.ec2.RouteTableAssociation(`private-subnet-association-${i}`, {
            subnetId: privateSubnet.id,
            routeTableId: privateRouteTable.id,
        });
    }
}
let appSecurityGroup;
let dbSecurityGroup;
let loadbalancer_sg;
async function createSecurityGroups() {

    loadbalancer_sg = new aws.ec2.SecurityGroup("loadbalancer_sg", {
        vpcId: vpc.id,
        ingress: [
            // {
            //     fromPort: 80,
            //     toPort: 80,
            //     protocol: "tcp",
            //     cidrBlocks: [ip1],
            // },
            {
                fromPort: 443,
                toPort: 443,
                protocol: "tcp",
                cidrBlocks: [ip1],
            },
        ],
        egress: [
            {
                fromPort: 0,
                toPort: 0,
                protocol: "all",
                cidrBlocks: [ip1],
            },
        ],
    });

     appSecurityGroup = new aws.ec2.SecurityGroup("applicationSecurityGroup", {
        vpcId: vpc.id,
        ingress: [
            // {
            //     fromPort: 22,
            //     toPort: 22,
            //     protocol: "tcp",
            //     cidrBlocks: [ip1],
            // },
            {
                fromPort: serverPort,
                toPort: serverPort,
                protocol: "tcp",
                securityGroups:[loadbalancer_sg.id],
            },
        ],
        egress: [
            {
                fromPort: 0,
                toPort: 0,
                protocol: "all",
                cidrBlocks: [ip1],
            },{
                fromPort: 8125,
                toPort: 8125,
                protocol: "udp",
                cidrBlocks: [ip1],
            }
        
            
        ],
    });

    const awsConfig = new sdk.Config({ region: "us-east-1" });
    const ec2 = new sdk.EC2(awsConfig);

     dbSecurityGroup = new aws.ec2.SecurityGroup("dbSecurityGroup", {
        vpcId: vpc.id,
        ingress: [
            {
                fromPort: 5432,
                toPort: 5432,
                protocol: "tcp",
                securityGroups: [appSecurityGroup.id],
            },
        ],
        egress: [
            {
                fromPort: 0,
                toPort: 0,
                protocol: "all",
                cidrBlocks: [ip1],
            },
        ],
    });

    const allowOutboundToEC2Rule = new aws.ec2.SecurityGroupRule("AllowOutboundToDB", {
          type: "egress",
          fromPort: serverPort,
          toPort: serverPort,
          protocol: "tcp",
          sourceSecurityGroupId: appSecurityGroup.id,
          securityGroupId: loadbalancer_sg.id,
        },
      );
}
let cloudWatchRoleResult;
let cloudWatchAgentProfile;

async function cloudWatchRole() {
    if (!cloudWatchRoleResult) {
 
        cloudWatchRoleResult = new aws.iam.Role("CloudWatchAgentRole", {
            assumeRolePolicy: JSON.stringify({
                Version: "2012-10-17",
                Statement: [{
                    Effect: "Allow",
                    Principal: {
                        Service: "ec2.amazonaws.com",
                    },
                    Action: "sts:AssumeRole",
                }],
            }),
        });


      
        const policyArn = aws.iam.ManagedPolicy.CloudWatchAgentServerPolicy;

        new aws.iam.RolePolicyAttachment("CloudWatchAgentPolicyAttachment", {
            policyArn: policyArn,
            role: cloudWatchRoleResult,
        });

        const snsPublishPolicy = snsTopic.arn.apply(arn => new aws.iam.Policy("snsPublishPolicy", {
            description: "Policy for allowing publishing to SNS topic",
            policy: JSON.stringify({
                Version: "2012-10-17",
                Statement: [{
                    Action: "sns:Publish",
                    Effect: "Allow",
                    Resource: arn,
                }],
            }),
        }));
        
        new aws.iam.RolePolicyAttachment("snsPolicyAttachment", {
            role: cloudWatchRoleResult.name,
            policyArn: snsPublishPolicy.arn,
        });

        
        if (!cloudWatchAgentProfile) {
            cloudWatchAgentProfile = new aws.iam.InstanceProfile("CloudWatchAgentProfile", {
                role: cloudWatchRoleResult.name,
            });
        }
    }
    return cloudWatchAgentProfile;
}
cloudWatchRole().catch(console.error);


async function createRDSAndEC2() {

    const cloudWatchAgentRole = await cloudWatchRole();

     rdsParameterGroup = new aws.rds.ParameterGroup("postgres-mywebapp-sg", {
        family: "postgres15",
        description: "Custom parameter group for PostgreSQL",
        type: "Custom",
    });

     dbSubnetGroup = new aws.rds.SubnetGroup("mydbsubnetgroup", {
        subnetIds: privateSubnets.map(subnet => subnet.id),
        tags: { Name: "My DB Subnet Group" },
    });

     rdsInstance = new aws.rds.Instance("myRDSInstance", {
        allocatedStorage: 20,
        storageType: "gp2",
        engine: "postgres",
        engineVersion: "15",
        instanceClass: "db.t3.micro",
        multiAz: false,
        identifier: "csye6225",
        username: config.require('username'),
        password: config.require('password'),
        dbSubnetGroupName: dbSubnetGroup.name,
        publiclyAccessible: false,
        dbName: config.require('dbName'),
        parameterGroupName: rdsParameterGroup.name,
        vpcSecurityGroupIds: [dbSecurityGroup.id],
        skipFinalSnapshot: true,
    });
    return rdsInstance;
}
async function createRoute53() {
   cloudWatchAgentProfile = await cloudWatchRole();


const launchTemplateData = pulumi.all([rdsInstance.address, rdsInstance.username, rdsInstance.password, rdsInstance.dbName, snsTopic.arn])
    .apply(([address, username, password, dbName,topicArn]) => {
        const userDataScript = `#!/bin/bash
sudo sh -c 'rm -f /opt/csye6225/webapp/.env'
sudo sh -c 'echo "HOST=${address}" >> /opt/csye6225/webapp/.env'
sudo sh -c 'echo "USERNAME=${username}" >> /opt/csye6225/webapp/.env'
sudo sh -c 'echo "PASSWORD=${password}" >> /opt/csye6225/webapp/.env'
sudo sh -c 'echo "DATABASE=${dbName}" >> /opt/csye6225/webapp/.env'
sudo sh -c 'echo "dialect=postgres" >> /opt/csye6225/webapp/.env'
sudo sh -c 'echo "TopicArn=${topicArn}" >> /opt/csye6225/webapp/.env'
sudo systemctl daemon-reload
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
    -a fetch-config \
    -m ec2 \
    -c file:/opt/aws/config.json \
    -s
sudo systemctl daemon-reload
sudo systemctl enable webapp
sudo systemctl start webapp
sudo systemctl enable amazon-cloudwatch-agent
sudo systemctl start amazon-cloudwatch-agent
sudo systemctl daemon-reload`;

        return Buffer.from(userDataScript).toString('base64');
    });
    const launchTemplate = new aws.ec2.LaunchTemplate("myLaunchTemplate", {
        imageId: AMMMID, 
        instanceType: instanceTypeEC2,
        keyName: keyNames, 
        networkInterfaces: [{
            associatePublicIpAddress: true,
            securityGroups: [appSecurityGroup.id],
        }],
        userData: launchTemplateData,
        iamInstanceProfile: {
            name: cloudWatchAgentProfile.name,
        },
        blockDeviceMappings: [{
            deviceName: "/dev/xvda",
            ebs: {
                volumeSize: volumeSize,
                volumeType: volumeType,
                deleteOnTermination: true,
            },
        }],
    });
    
    let targetGroup = new aws.lb.TargetGroup("targetGroup", {
        vpcId: vpc.id,
        port: serverPort,
        protocol: "HTTP",
        targetType: "instance",
        healthCheck: {
            enabled: true,
            interval: 60,
            path: healthCheckPath,
            protocol: "HTTP",
            port: serverPort,
            matcher: "200",
            timeout: 30,
            unhealthyThreshold: 3,
          },
    });
    

    let asg = new aws.autoscaling.Group("asg", {
    vpcZoneIdentifiers: publicSubnets.map(subnet => subnet.id),
    targetGroupArn: targetGroup.arn,
    desiredCapacity: 1,
    minSize: 1,
    maxSize: 3,
    launchTemplate: {
        id: launchTemplate.id,
        version: `$Latest`
    },
    tags: [{
        key: "Name",
        value: "asgInstance",
        propagateAtLaunch: true,
    }],
    cooldown:60,
});

const attachment = new aws.autoscaling.Attachment("asg-attachment", {
    lbTargetGroupArn: targetGroup.arn,
    autoscalingGroupName: asg.name,
});

const scaleUpPolicy = new aws.autoscaling.Policy("scaleUpPolicy", {
    scalingAdjustment: 1,
    adjustmentType: "ChangeInCapacity",
    cooldown: 60, 
    autoscalingGroupName: asg.name,
});

const scaleDownPolicy = new aws.autoscaling.Policy("scaleDownPolicy", {
    scalingAdjustment: -1,
    adjustmentType: "ChangeInCapacity",
    cooldown: 60, 
    autoscalingGroupName: asg.name,
});

const cpuUtilizationAlarm_up = new aws.cloudwatch.MetricAlarm("cpuUtilizationAlarm_up", {
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 1,
    threshold: 5,
    metricName: "CPUUtilization",
    namespace: "AWS/EC2",
    dimensions: {
        AutoScalingGroupName: asg.name,
    },
    period: 60,
    statistic: "Average",
    alarmActions: [scaleUpPolicy.arn], 
});


const cpuUtilizationAlarm_down = new aws.cloudwatch.MetricAlarm("cpuUtilizationAlarm_down", {
    comparisonOperator: "LessThanThreshold",
    evaluationPeriods: 1,
    threshold: 3,
    metricName: "CPUUtilization",
    namespace: "AWS/EC2",
    dimensions: {
        AutoScalingGroupName: asg.name,
    },
    period: 60,
    statistic: "Average",
    alarmActions: [scaleDownPolicy.arn], 
});


 loadBalancer = new aws.lb.LoadBalancer("loadBalancer", {
    securityGroups: [loadbalancer_sg.id],
    subnets: publicSubnets.map(subnet => subnet.id),
    loadBalancerType: "application",
    enableDeletionProtection: false,
});

let listener = new aws.lb.Listener("listener", {
    loadBalancerArn: loadBalancer.arn,
    port: 443,
    protocol: "HTTPS",
    certificateArn: sslCertificateArn, 
    defaultActions: [{
        type: "forward",
        targetGroupArn: targetGroup.arn,
    }],
});



    const webserverRecord = new aws.route53.Record("webserver-record", {
        name: domainName, 
        type: "A",
        zoneId: aws.route53.getZone({ name: domainName, privateZone: false }).then(zone => zone.zoneId),
        aliases: [{
            name: loadBalancer.dnsName,
            zoneId: loadBalancer.zoneId,
            evaluateTargetHealth: true,
        }]
    });



//     const trackEmailsDynamoDB = new aws.dynamodb.Table("trackEmails", {
//         attributes: [
//             { name: "id", type: "S" },          
//         ],
//         hashKey: "id",
//         billingMode: "PAY_PER_REQUEST", 
//    });

    const trackEmailsDynamoDB = new aws.dynamodb.Table("trackEmails", {
        attributes: [
            { name: "assignmentId", type: "S" },
            { name: "submissionId", type: "S" },
            { name: "userId", type: "S" },
        ],
        hashKey: "assignmentId",
        rangeKey: "submissionId",
        billingMode: "PAY_PER_REQUEST",
        globalSecondaryIndexes: [{
            name: "UserIdIndex",
            hashKey: "userId",
            projectionType: "ALL",
        }],
    });
   

    const lambdaRole = new aws.iam.Role("lambdaRole", {
       assumeRolePolicy: JSON.stringify({
           Version: "2012-10-17",
           Statement: [{
               Action: "sts:AssumeRole",
               Effect: "Allow",
               Principal: {
                   Service: "lambda.amazonaws.com",
               },
           }],
       }),
   });

   new aws.iam.RolePolicyAttachment("lambda-basic-execution-role", {
    role: lambdaRole.name,
    policyArn: config.require('policyArn'),
});


   const ec2PolicyForLambda = new aws.iam.RolePolicy("ec2PolicyForLambda", {
       role: lambdaRole.name,
       policy: JSON.stringify({
           Version: "2012-10-17",
           Statement: [
               {
                   Effect: "Allow",
                   Action: [
                       "ec2:CreateNetworkInterface",
                       "ec2:DescribeNetworkInterfaces",
                       "ec2:DeleteNetworkInterface",
                   ],
                   Resource: config.require('Resource'),
               },
           ],
       }),
   });

   const secretsManagerPolicy = new aws.iam.RolePolicy("secretsManagerPolicy", {
    role: lambdaRole.name,
    policy: pulumi.output({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Action: "secretsmanager:GetSecretValue",
            Resource: mysecret.arn
        }]
    }).apply(policy => JSON.stringify(policy))
});


   const dynamoDbPolicy = pulumi.interpolate`{
       "Version": "2012-10-17",
       "Statement": [
           {
               "Effect": "Allow",
               "Action": [
                   "dynamodb:GetItem",
                   "dynamodb:PutItem",
                   "dynamodb:UpdateItem"
               ],
               "Resource": "${trackEmailsDynamoDB.arn}"
           }
       ]
   }`;
   
   // Attach the policy to the Lambda role
   const dynamoDbAccessPolicy = new aws.iam.RolePolicy("dynamoDbAccess", {
       role: lambdaRole.name,
       policy: dynamoDbPolicy,
   });


   const lambdaSecurityGroup = new aws.ec2.SecurityGroup("lambdaSecurityGroup", {
       vpcId: vpc.id,
       description: "Allow outbound HTTP/S",
       egress: [{
           fromPort: 0,
           toPort: 0,
           protocol: "-1", // -1 means all protocols
           cidrBlocks: ["0.0.0.0/0"],
       }],
   });

    const bucketName= config.require('bucketName')
    const bucket = new gcp.storage.Bucket(bucketName, {
    location: "US",
    forceDestroy: true,
    uniformBucketLevelAccess: true,
});
const PROJECT_ID= config.require('project_id')
const Domain=config.require('DOMAIN')
const api_key=config.require('API_KEY')  
console.log(PROJECT_ID)
   const lambdaFunction = new aws.lambda.Function("myLambdaFunction", {
      runtime: "nodejs18.x",
       code: new pulumi.asset.AssetArchive({
           ".": new pulumi.asset.FileArchive("./Archive.zip"),
       }),
       handler: "index.handler",
       role: lambdaRole.arn,
        environment: {
            variables: {
        GCP_SECRET_NAME: mysecret.name,
        GCP_BUCKET_NAME: bucket.name,
        DYNAMO_DB_TABLE: trackEmailsDynamoDB.name,
        DOMAIN: Domain,
        API_KEY: api_key,
        PROJECT_ID:PROJECT_ID
            }
        },

   });

   const lambdaPermission = new aws.lambda.Permission("lambdaPermission", {
       action: "lambda:InvokeFunction",
       function: lambdaFunction.name,
       principal: "sns.amazonaws.com",
       sourceArn: snsTopic.arn,
   });

   const snsSubscription = new aws.sns.TopicSubscription("snsSubscription", {
       topic: snsTopic.arn,
       protocol: "lambda",
       endpoint: lambdaFunction.arn,
   });    

    ec2Instance = instance;
    exports.vpcId = vpc.id;
    exports.publicSubnetIds = publicSubnets.map(subnet => subnet.id);
    exports.privateSubnetIds = privateSubnets.map(subnet => subnet.id);
}

async function createGCPServiceAccountAndStoreInAWSSecrets() {

    const storageServiceAccount = new gcp.serviceaccount.Account("storageServiceAccount", {
        accountId: config.require('accountId'),
        displayName: config.require('accountId'),
    });
    const iamPolicyBinding = new gcp.projects.IAMBinding("iamPolicyBinding", {
        project: gcp.config.project,
        role: "roles/storage.admin",
        members: [pulumi.interpolate`serviceAccount:${storageServiceAccount.email}`],
    });
    const myServiceAccountKey = new gcp.serviceaccount.Key("myServiceAccountKey", {
        serviceAccountId: storageServiceAccount.accountId,
    });
     mysecret = new aws.secretsmanager.Secret("mysecret", {
        name: config.require('mysecret'),
        forceOverwriteReplicaSecret:true

    });
    new aws.secretsmanager.SecretVersion("my-secret-version", {
        secretBinary: myServiceAccountKey.privateKey,
        secretId: mysecret.id,
    });
}

function deployResources() {
    createSecurityGroups()
        .then(() => cloudWatchRole())
        .then(() => createRDSAndEC2())
        .then(()=>createGCPServiceAccountAndStoreInAWSSecrets())
        .then(() =>createRoute53())
        .catch(err => {
            console.error('Error during resource deployment:', err);
        });
}

createSubnets()
    .then(deployResources)
    .catch(err => {
        console.error('Error during subnet creation:', err);
    });
