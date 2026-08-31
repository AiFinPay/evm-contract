export interface CoreDeployment {
    msecco: string;
    passport: string;
    core: string;
    owner: string;
}

export interface SplitterDeployment {
    address: string;
    owner: string;
    treasury: string;
    usdc: string;
    usdt: string;
}

export interface SplitterV14Deployment {
    address: string;
    admin: string;
    signer: string;
    pauser: string;
    treasury: string;
    tokenList: string;
    profiles: string;
    usdc: string;
    usdt: string;
}

export interface DeploymentRecord {
    network: string;
    chainId: number;
    timestamp: string;
    core?: CoreDeployment;
    splitter?: SplitterDeployment;
    splitterV14?: SplitterV14Deployment;
}
