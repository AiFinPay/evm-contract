import { network } from "hardhat";
import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";
import type { NetworkHelpers } from "@nomicfoundation/hardhat-network-helpers/types";
import type { Signer } from "ethers";
import type {
  AgentPassport,
  AiFinPayCore,
  B2BSplitter,
  MockERC20,
  MockPyth,
  MSECCOToken,
} from "../typechain-types";

const connection = await network.create();
export const ethers: HardhatEthers = connection.ethers;
export const networkHelpers: NetworkHelpers = connection.networkHelpers;
export const loadFixture = networkHelpers.loadFixture;

export interface ProtocolContracts {
  owner: Signer;
  treasury: Signer;
  agent: Signer;
  merchant: Signer;
  ipCreator: Signer;
  attacker: Signer;
  msecco: MSECCOToken;
  passport: AgentPassport;
  core: AiFinPayCore;
  mockPyth: MockPyth;
  usdc: MockERC20;
  usdt: MockERC20;
}

export interface ProtocolWithSplitter extends ProtocolContracts {
  splitter: B2BSplitter;
}

async function deployProtocol(): Promise<ProtocolContracts> {
  const [
    owner,
    treasury,
    agent,
    merchant,
    ipCreator,
    attacker,
  ] = await ethers.getSigners();

  const MockPythFactory = await ethers.getContractFactory("MockPyth");
  const mockPyth = (await MockPythFactory.deploy()) as unknown as MockPyth;

  const MSECCOTokenFactory = await ethers.getContractFactory("MSECCOToken");
  const AgentPassportFactory = await ethers.getContractFactory("AgentPassport");
  const AiFinPayCoreFactory = await ethers.getContractFactory("AiFinPayCore");

  const msecco = (await MSECCOTokenFactory.deploy(
    await owner.getAddress()
  )) as unknown as MSECCOToken;
  const passport = (await AgentPassportFactory.deploy(
    await owner.getAddress()
  )) as unknown as AgentPassport;

  // Real mock tokens: the Core constructor now reads decimals() from each
  // token (AIFINP-120), so a codeless placeholder address no longer deploys.
  const MockERC20Factory = await ethers.getContractFactory("MockERC20");
  const usdc = (await MockERC20Factory.deploy("USD Coin", "USDC", 6)) as unknown as MockERC20;
  const usdt = (await MockERC20Factory.deploy("Tether USD", "USDT", 6)) as unknown as MockERC20;
  const mockNativeUsdId =
    "0x5de33a9112c2b700b8d30b8a3402c103578ccfa2856a12a2b20d7b0c67b6d82d";

  const core = (await AiFinPayCoreFactory.deploy(
    await owner.getAddress(),
    await msecco.getAddress(),
    await passport.getAddress(),
    await treasury.getAddress(),
    await mockPyth.getAddress(),
    await usdc.getAddress(),
    await usdt.getAddress(),
    mockNativeUsdId
  )) as unknown as AiFinPayCore;

  await msecco.setCore(await core.getAddress());
  await passport.setCore(await core.getAddress());

  return {
    owner,
    treasury,
    agent,
    merchant,
    ipCreator,
    attacker,
    msecco,
    passport,
    core,
    mockPyth,
    usdc,
    usdt,
  };
}

async function deployProtocolWithSplitter(): Promise<ProtocolWithSplitter> {
  const base = await deployProtocol();

  // v1.2: constructor now takes per-chain (owner, treasury, usdc, usdt) — AIFINP-34.
  // Distinct non-zero placeholders; native/idempotency/zero-creator tests
  // don't move ERC-20.
  const testUsdc = "0x1000000000000000000000000000000000000001";
  const testUsdt = "0x1000000000000000000000000000000000000002";
  const B2BSplitterFactory = await ethers.getContractFactory("B2BSplitter");
  const splitter = (await B2BSplitterFactory.deploy(
    await base.treasury.getAddress(),
    await base.treasury.getAddress(),
    testUsdc,
    testUsdt
  )) as unknown as B2BSplitter;

  return { ...base, splitter };
}

export const fixture = deployProtocol;
export const fixtureWithSplitter = deployProtocolWithSplitter;
