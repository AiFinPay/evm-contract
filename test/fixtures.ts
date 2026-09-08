import { network } from "hardhat";
import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";
import type { NetworkHelpers } from "@nomicfoundation/hardhat-network-helpers/types";
import type { Signer } from "ethers";
import { canonicalSalt, deployDirect, deployViaCreate3 } from "../scripts/lib/create3";

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
  const usdcAddr = await usdc.getAddress();
  const usdtAddr = await usdt.getAddress();

  const routeIdAgent = ethers.keccak256(ethers.toUtf8Bytes(ROUTE_AGENT));
  const routeIdMerchant = ethers.keccak256(ethers.toUtf8Bytes(ROUTE_MERCHANT));

  const ownerAddress = await owner.getAddress();
  const signerAddress = await signer.getAddress();
  const treasuryAddress = await treasury.getAddress();

  const create3Factory = await deployDirect(ethers, "CreateXMock", []);
  const factoryAddress = create3Factory.address;

  const { address: tokenListAddr, contract: tokenList } = await deployViaCreate3(
    ethers,
    factoryAddress,
    "TokenList",
    canonicalSalt(ownerAddress, "TokenList", "1.0"),
    [ownerAddress, [usdcAddr, usdtAddr]],
  );

  const { address: profilesAddr, contract: profiles } = await deployViaCreate3(
    ethers,
    factoryAddress,
    "Profiles",
    canonicalSalt(ownerAddress, "Profiles", "1.0"),
    [ownerAddress, [routeIdAgent, routeIdMerchant], [0, 100], [0, 0]],
  );

  const { address: splitterAddr, contract: splitter } = await deployViaCreate3(
    ethers,
    factoryAddress,
    "B2BSplitterV14",
    canonicalSalt(ownerAddress, "B2BSplitterV14", "1.4"),
    [
      {
        initialAdmin: ownerAddress,
        initialSigner: signerAddress,
        initialPauser: ownerAddress,
        treasury: treasuryAddress,
        tokenList: tokenListAddr,
        profiles: profilesAddr,
      },
    ],
  );

  // Satellites are administered directly by `owner` (test stand-in for governance).
  // The splitter no longer proxies TokenList/Profiles writes.

  return {
    owner,
    treasury,
    signer,
    agent,
    merchant,
    ipCreator,
    attacker,
    splitter,
    tokenList,
    profiles,
    usdc,
    usdt,
    routeIdAgent,
    routeIdMerchant,
  };
}

export { ROUTE_AGENT, ROUTE_MERCHANT };
