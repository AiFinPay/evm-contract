import { network } from "hardhat";
import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";
import type { NetworkHelpers } from "@nomicfoundation/hardhat-network-helpers/types";
import type { Signer } from "ethers";

const connection = await network.create();
export const ethers: HardhatEthers = connection.ethers;
export const networkHelpers: NetworkHelpers = connection.networkHelpers;
export const loadFixture = networkHelpers.loadFixture;

export interface V14Fixture {
  owner: Signer;
  treasury: Signer;
  signer: Signer;
  agent: Signer;
  merchant: Signer;
  ipCreator: Signer;
  attacker: Signer;
  splitter: any;
  tokenList: any;
  profiles: any;
  usdc: any;
  usdt: any;
  routeIdAgent: string;
  routeIdMerchant: string;
}

const ROUTE_AGENT = "agent-x402";
const ROUTE_MERCHANT = "merchant-aifp1";

export async function fixtureV14(): Promise<V14Fixture> {
  const [owner, treasury, signer, agent, merchant, ipCreator, attacker] = await ethers.getSigners();

  const MockERC20Factory = await ethers.getContractFactory("MockERC20");
  const usdc = await MockERC20Factory.deploy("Test USDC", "USDC", 6n);
  const usdt = await MockERC20Factory.deploy("Test USDT", "USDT", 6n);

  const B2BSplitterV14Factory = await ethers.getContractFactory("B2BSplitterV14");
  const routeIdAgent = ethers.keccak256(ethers.toUtf8Bytes(ROUTE_AGENT));
  const routeIdMerchant = ethers.keccak256(ethers.toUtf8Bytes(ROUTE_MERCHANT));

  const splitter = await B2BSplitterV14Factory.deploy({
    initialAdmin: await owner.getAddress(),
    initialSigner: await signer.getAddress(),
    initialPauser: await owner.getAddress(),
    treasury: await treasury.getAddress(),
    stablecoins: [await usdc.getAddress(), await usdt.getAddress()],
    routeIds: [routeIdAgent, routeIdMerchant],
    treasuryBps: [0, 100],
    ipCreatorBps: [0, 0],
  });

  return {
    owner,
    treasury,
    signer,
    agent,
    merchant,
    ipCreator,
    attacker,
    splitter,
    tokenList: await ethers.getContractAt("TokenList", await splitter.tokenList()),
    profiles: await ethers.getContractAt("Profiles", await splitter.profiles()),
    usdc,
    usdt,
    routeIdAgent,
    routeIdMerchant,
  };
}

export { ROUTE_AGENT, ROUTE_MERCHANT };
