export interface StablecoinDeployment {
  symbol: string;
  address: string;
  name?: string;
  source?: string | null;
}

export interface SplitterV14Deployment {
  address: string;
  admin: string;
  signer: string;
  pauser: string;
  treasury: string;
  tokenList: string;
  profiles: string;
  /** Canonical asset list. Symbols are display metadata; addresses are identities. */
  stablecoins: StablecoinDeployment[];
}

export interface DeploymentRecord {
  network: string;
  chainId: number;
  timestamp: string;
  splitterVersion?: string;
  splitter?: SplitterV14Deployment;
  runtimeCodeHash?: string;
  status?: "enabled" | "disabled" | "invalid" | "retired";
  settlementEnabled?: boolean;
  disabledReason?: string;
}
