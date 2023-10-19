
const pulumi = require('@pulumi/pulumi');
const aws = require('@pulumi/aws');
const sdk=require("aws-sdk");

const config = new pulumi.Config();
const vpcCidr = config.require('vpcCidr');
const vpcName = config.require('vpcName');
const internetgateway=config.require('internetGateway')
const keyNames=config.require('keyname')
let ec2Instance;
let AMI_ID;
let AMMMID= config.require('amiId');
let ownerId= config.require('ownerid')

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
let availabilityZones=[];

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


listAvailabilityZones().then((azs) => {
    const count = availabilityZones.names?.length || 0; 
    for (let i = 0; i < count && i<3; i++) { 
        const publicSubnet = new aws.ec2.Subnet(`publicSubnet${i}`, {
            vpcId: vpc.id,
            cidrBlock: pulumi.interpolate `10.0.${i}.0/24`,
            availabilityZone: azs.names[i],
            mapPublicIpOnLaunch: true,
            tags: {
                Name: `Public Subnet ${i + 1}`, // Use "i" to generate unique names
            },
        });
        publicSubnets.push(publicSubnet);

        const privateSubnet = new aws.ec2.Subnet(`privateSubnet${i}`, {
            vpcId: vpc.id,
            cidrBlock: pulumi.interpolate `10.0.${i + 100}.0/24`,
            availabilityZone: azs.names[i],
            tags: {
                Name: `Private Subnet ${i + 1}`, // Use "i" to generate unique names
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


}).then(()=>{


        const appSecurityGroup = new aws.ec2.SecurityGroup("applicationSecurityGroup", {
            vpcId: vpc.id,
            ingress: [
                {
                    fromPort: 22,
                    toPort: 22,
                    protocol: "tcp",
                    cidrBlocks: ["73.219.87.237/32"],
                },
                {
                    fromPort: 80,
                    toPort: 80,
                    protocol: "tcp",
                    cidrBlocks: ["0.0.0.0/0"],
                },
                {
                    fromPort: 443,
                    toPort: 443,
                    protocol: "tcp",
                    cidrBlocks: ["0.0.0.0/0"],
                },
                {
                    fromPort: 8080,
                    toPort: 8080,
                    protocol: "tcp",
                    cidrBlocks: ["0.0.0.0/0"],
                },
            ],
        });
      

        const amiOwnerId = ownerId;
        const awsConfig = new sdk.Config({ region: "us-east-1" }); 
        const ec2 = new sdk.EC2(awsConfig);
        
        const listAmis = async () => {
          const params = { Owners: ['ownerId'] };
        
          ec2.describeImages(params, function(err, data) {
            if (err) console.log(err, err.stack);
            else {
              const amiIds = data.Images.map((ami) => ami.ImageId);
              AMI_ID= amiIds;
              console.log(AMI_ID[0])
            }
          });
        };
        
        const amis = listAmis();
        const instance = new aws.ec2.Instance("webAppInstance", {
                ami: AMMMID,
                instanceType: "t2.micro",
                vpcSecurityGroupIds: [appSecurityGroup.id],
                subnetId: publicSubnets[0].id,
                keyName: keyNames,
                rootBlockDevice: {
                    volumeSize: 25,
                    volumeType: "gp2",
                    deleteOnTermination: true,
                },
                disableApiTermination: true,
            });
        
    

ec2Instance = instance; 
exports.vpcId = vpc.id;
exports.publicSubnetIds = publicSubnets.map(subnet => subnet.id);
exports.privateSubnetIds = privateSubnets.map(subnet => subnet.id);
exports.instanceId = instance.id;

})