
const pulumi = require('@pulumi/pulumi');
const aws = require('@pulumi/aws');


const config = new pulumi.Config();
const vpcCidr = config.require('vpcCidr');
const vpcName = config.require('vpcName');
const internetgateway=config.require('internetGateway')



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
});


exports.vpcId = vpc.id;
exports.publicSubnetIds = publicSubnets.map(subnet => subnet.id);
exports.privateSubnetIds = privateSubnets.map(subnet => subnet.id);

