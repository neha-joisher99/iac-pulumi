const pulumi = require('@pulumi/pulumi');
const aws = require('@pulumi/aws');
const sdk = require("aws-sdk");

const config = new pulumi.Config();
const vpcCidr = config.require('vpcCidr');
const vpcName = config.require('vpcName');
const internetgateway = config.require('internetGateway');
const keyNames = config.require('keyname');
let ec2Instance;
let AMI_ID;
let AMMMID = config.require('amiId');
let ownerId = config.require('ownerid');
let ip1 = config.require('ip1');
let ip2 = config.require('ip2');
let ip3 = config.require('ip3');

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
async function createSecurityGroups() {
     appSecurityGroup = new aws.ec2.SecurityGroup("applicationSecurityGroup", {
        vpcId: vpc.id,
        ingress: [
            {
                fromPort: 22,
                toPort: 22,
                protocol: "tcp",
                cidrBlocks: [ip1],
            },
            {
                fromPort: 80,
                toPort: 80,
                protocol: "tcp",
                cidrBlocks: [ip1],
            },
            {
                fromPort: 443,
                toPort: 443,
                protocol: "tcp",
                cidrBlocks: [ip2],
            },
            {
                fromPort: 3000,
                toPort: 3000,
                protocol: "tcp",
                cidrBlocks: [ip3],
            },
        ],
        egress: [
            {
                fromPort: 0,
                toPort: 0,
                protocol: "all",
                cidrBlocks: ["0.0.0.0/0"],
            },
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
                cidrBlocks: ["0.0.0.0/0"],
            },
        ],
    });
}

async function createRDSAndEC2() {
    // Create an RDS Parameter Group
     rdsParameterGroup = new aws.rds.ParameterGroup("postgres-mywebapp-sg", {
        family: "postgres15",
        description: "Custom parameter group for PostgreSQL",
        type: "Custom",
    });

     dbSubnetGroup = new aws.rds.SubnetGroup("mydbsubnetgroup", {
        subnetIds: privateSubnets.map(subnet => subnet.id),
        tags: { Name: "My DB Subnet Group" },
    });

    const rdsInstance = new aws.rds.Instance("myRDSInstance", {
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

    const port = 5432;
    const instance = new aws.ec2.Instance("webAppInstance", {
        ami: AMMMID,
        instanceType: "t2.micro",
        vpcSecurityGroupIds: [appSecurityGroup.id],
        subnetId: publicSubnets[0].id,
        keyName: keyNames,
        userData: pulumi.interpolate`#!/bin/bash
        sudo rm -rf /opt/csye6225/webapp/.env
        sudo sh -c "echo 'HOST=${rdsInstance.address}' >> /etc/environment"
        sudo sh -c "echo 'USERNAME=${rdsInstance.username}' >> /etc/environment"
        sudo sh -c "echo 'PASSWORD=${rdsInstance.password}' >> /etc/environment"
        sudo sh -c "echo 'DATABASE=${rdsInstance.dbName}' >> /etc/environment"
        sudo systemctl daemon-reload`,
        rootBlockDevice: {
            volumeSize: 25,
            volumeType: "gp2",
        },
        dependsOn: [rdsInstance],
    });

    ec2Instance = instance;
    exports.vpcId = vpc.id;
    exports.publicSubnetIds = publicSubnets.map(subnet => subnet.id);
    exports.privateSubnetIds = privateSubnets.map(subnet => subnet.id);
    exports.instanceId = instance.id;
}

async function deployResources() {
    await createSecurityGroups();
    await createRDSAndEC2();
}

createSubnets()
    .then(() => deployResources())
    .catch((err) => {
        // Handle any errors here
        console.error('Error:', err);
    });
