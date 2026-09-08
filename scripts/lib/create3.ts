// Deterministic CREATE3 deployment helpers using the canonical CreateX factory.
//
// CreateX (https://github.com/pcaversaccio/createx) is deployed at the same
// address on 100+ EVM chains. It supports CREATE, CREATE2, and CREATE3. We only
// use its CREATE3 functions here.
//
// CreateX applies "salt guarding" internally: the effective salt depends on the
// salt prefix. Our helpers encode the deployer permissioned-protection prefix
// so that only the configured deployer EOA can land the contract at the predicted
// address on any chain. The 21st byte is set to 0x00 (no cross-chain redeploy
// protection) so the same salt produces the same address across all chains.

import {
  ContractFactory,
  Interface,
  ZeroAddress,
  concat,
  dataSlice,
  getBytes,
  hexlify,
  keccak256,
  solidityPacked,
} from "ethers";
import type { NetworkContext } from "./deployment.js";

export const CREATEX_FACTORY_NAME = "ICreateX";
export const CREATEX_FACTORY_ADDRESS = "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed";

export const CREATEX_ABI = new Interface([
  "function deployCreate3(bytes32,bytes) payable returns (address)",
  "function computeCreate3Address(bytes32) view returns (address)",
  "function computeCreate3Address(bytes32,address) pure returns (address)",
]);

/**
 * Build a CreateX-compatible guarded salt.
 *
 * Layout: 32 bytes total
 *   bytes 00..19  = deployer address (permissioned deploy protection)
 *   byte  20      = 0x00 (cross-chain redeploy protection disabled)
 *   bytes 21..31  = entropy from keccak256(name || version || extra)
 *
 * CreateX will hash this with msg.sender internally, so only the specified
 * deployer EOA can deploy to the predicted address.
 */
export function canonicalSalt(
  _deployerAddress: string,
  _contractName: string,
  _version: string,
  _extra = "0",
): string {
  const entropy = keccak256(
    solidityPacked(["string", "string", "string"], [_contractName, _version, _extra]),
  );
  const salt = concat([
    dataSlice(_deployerAddress, 0, 20), // last 20 bytes of address
    "0x00", // no cross-chain redeploy protection
    dataSlice(entropy, 21, 32), // 11 bytes of entropy
  ]);
  return hexlify(salt);
}

/**
 * Predict the guarded CreateX address for a contract.
 */
export async function predictCreate3Address(
  _ethers: NetworkContext["ethers"],
  _factoryAddress: string,
  _deployerAddress: string,
  _salt: string,
): Promise<string> {
  const createX = new _ethers.Contract(_factoryAddress, CREATEX_ABI, _ethers.provider);
  // The CreateX function `computeCreate3Address(bytes32)` expects the salt
  // *after* `_guard` has been applied. It computes the address where
  // `deployCreate3` will store the child contract. The two-argument overload
  // `computeCreate3Address(bytes32,address)` is a general Solady-style
  // computation and is NOT used by `deployCreate3`.
  const guarded = guardedSalt(_deployerAddress, _salt);
  return (await createX.computeCreate3Address(guarded)) as string;
}

/**
 * Deploy a contract through the CreateX factory.
 */
export async function deployViaCreate3(
  _ethers: NetworkContext["ethers"],
  _factoryAddress: string,
  _contractName: string,
  _salt: string,
  _args: unknown[],
): Promise<{
  contract: Awaited<ReturnType<ContractFactory["deploy"]>>;
  address: string;
  predicted: string;
}> {
  const createX = await _ethers.getContractAt(CREATEX_FACTORY_NAME, _factoryAddress);
  const deployer = (await _ethers.getSigners())[0];
  const deployerAddress = await deployer.getAddress();

  const ContractFactory = await _ethers.getContractFactory(_contractName);
  const creationCode = ContractFactory.interface.encodeDeploy(_args);
  const fullBytecode = ContractFactory.bytecode + creationCode.slice(2);

  const predicted = await predictCreate3Address(_ethers, _factoryAddress, deployerAddress, _salt);

  const tx = await createX.connect(deployer).deployCreate3(_salt, fullBytecode);
  const receipt = await tx.wait();
  if (!receipt || receipt.status !== 1)
    throw new Error(`CreateX deploy of ${_contractName} failed`);

  const address = predicted;
  if ((await _ethers.provider.getCode(address)).length <= 2) {
    throw new Error(
      `${_contractName} CreateX deployment succeeded but no runtime code at ${address}`,
    );
  }

  const contract = await _ethers.getContractAt(_contractName, address);
  return { contract, address, predicted };
}

/**
 * Deploy a contract directly. Used in tests for the local CreateX stand-in.
 */
export async function deployDirect(
  _ethers: NetworkContext["ethers"],
  _contractName: string,
  _args: unknown[],
): Promise<{ contract: Awaited<ReturnType<ContractFactory["deploy"]>>; address: string }> {
  const ContractFactory = await _ethers.getContractFactory(_contractName);
  const contract = await ContractFactory.deploy(..._args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  return { contract, address };
}

/**
 * Resolve the CreateX factory address for the current chain.
 *
 * Local EDR networks get a fresh CreateX mock deployed automatically.
 * Production networks use the canonical CreateX address.
 */
export async function resolveCreate3Factory(
  _ethers: NetworkContext["ethers"],
  _networkName: string,
): Promise<string> {
  const chainId = Number((await _ethers.provider.getNetwork()).chainId);
  const envKey = `CREATE3_FACTORY_${chainId}`;
  const envAddress = process.env[envKey]?.trim();

  if (envAddress && envAddress !== ZeroAddress) {
    return envAddress;
  }

  // Local simulated network: deploy a fresh CreateX mock for testing.
  if (_networkName === "default" || _networkName === "localhost") {
    const { address } = await deployDirect(_ethers, "CreateXMock", []);
    console.log(`  CreateX mock deployed locally at ${address}`);
    return address;
  }

  return CREATEX_FACTORY_ADDRESS;
}

/**
 * Compute the CreateX guarded salt off-chain.
 *
 * Mirrors CreateX._guard for the case where:
 *   - first 20 bytes == msg.sender (permissioned deploy protection)
 *   - 21st byte == 0x00 (no cross-chain redeploy protection)
 */
export function guardedSalt(_deployerAddress: string, _salt: string): string {
  const senderBytes32 = "0x" + _deployerAddress.toLowerCase().slice(2).padStart(64, "0");
  return keccak256(solidityPacked(["bytes32", "bytes32"], [senderBytes32, _salt]));
}

/**
 * Mine a salt that makes the CreateX-deployed address start with `_prefix`.
 *
 * Varies the `extra` field of the canonical salt. Returns the first matching
 * salt, its guarded form, and the predicted address.
 */
export function mineSaltForPrefix(
  _factoryAddress: string,
  _deployerAddress: string,
  _contractName: string,
  _version: string,
  _prefix: string,
  _start = 0,
  _maxAttempts = 1_000_000,
): { salt: string; guardedSalt: string; address: string; attempts: number } {
  const target = _prefix.toLowerCase().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]+$/.test(target)) throw new Error("Invalid hex prefix");

  const senderBytes32 = "0x" + _deployerAddress.toLowerCase().slice(2).padStart(64, "0");
  const factory = _factoryAddress.toLowerCase();

  for (let i = _start; i < _start + _maxAttempts; i++) {
    const salt = canonicalSalt(_deployerAddress, _contractName, _version, String(i));
    const guarded = keccak256(solidityPacked(["bytes32", "bytes32"], [senderBytes32, salt]));
    const address = computeCreate3AddressLocal(guarded, factory);

    if (address.toLowerCase().slice(2).startsWith(target)) {
      return { salt, guardedSalt: guarded, address, attempts: i - _start + 1 };
    }
  }

  throw new Error(
    `Could not find address starting with 0x${_prefix} within ${_maxAttempts} attempts (start ${_start})`,
  );
}

/**
 * Off-chain address computation matching CreateX.computeCreate3Address.
 */
export function computeCreate3AddressLocal(_guardedSalt: string, _factoryAddress: string): string {
  const PROXY_INITCODE_HASH = "0x21c35dbe1b344a2488cf3321d6ce542f8e9f305544ff09e4993a62319a497c1f";
  const proxy =
    "0x" +
    keccak256(
      solidityPacked(
        ["bytes1", "address", "bytes32", "bytes32"],
        ["0xff", _factoryAddress, _guardedSalt, PROXY_INITCODE_HASH],
      ),
    ).slice(-40);
  return (
    "0x" +
    keccak256(solidityPacked(["bytes2", "address", "bytes1"], ["0xd694", proxy, "0x01"])).slice(-40)
  );
}
