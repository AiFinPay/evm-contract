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
  splitterVersion?: string;
  splitter?: SplitterV14Deployment;
  runtimeCodeHash?: string;
}
