import {
  getSafeSingletonDeployment,
  getProxyFactoryDeployment,
} from "@safe-global/safe-deployments";

const version = "1.5.0";
const chainId = 56; // BNB

const singletonDeployment = getSafeSingletonDeployment({ version, network: chainId.toString() });
const factoryDeployment = getProxyFactoryDeployment({ version, network: chainId.toString() });

console.log(singletonDeployment?.networkAddresses[chainId]); // canonical singleton address
console.log(factoryDeployment?.networkAddresses[chainId]); // canonical factory address
