import { network } from "hardhat";
import type { HardhatEthers } from "@nomicfoundation/hardhat-ethers/types";
import type { NetworkHelpers } from "@nomicfoundation/hardhat-network-helpers/types";
import type { Signer } from "ethers";
import type {
  AgentPassport,
  AiFinPayCore,
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

  const mockUsdc = "0x1000000000000000000000000000000000000001";
  const mockUsdt = "0x1000000000000000000000000000000000000002";
  const mockNativeUsdId =
    "0x5de33a9112c2b700b8d30b8a3402c103578ccfa2856a12a2b20d7b0c67b6d82d";

  const core = (await AiFinPayCoreFactory.deploy(
    await owner.getAddress(),
    await msecco.getAddress(),
    await passport.getAddress(),
    await treasury.getAddress(),
    await mockPyth.getAddress(),
    mockUsdc,
    mockUsdt,
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
  };
}

export const fixture = deployProtocol;
