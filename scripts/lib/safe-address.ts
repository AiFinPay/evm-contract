// Shared Safe Proxy address prediction and vanity mining helpers.
//
// These helpers are used by both the offline vanity miner and the on-chain
// Safe multisig deployer. All calculations follow the canonical Safe Proxy
// Factory CREATE2 formula used by Safe v1.4.1 and v1.5.0:
//
//   salt      = keccak256(keccak256(initializer), saltNonce)
//   initCode  = proxyCreationCode ++ singletonAddress
//   address   = CREATE2(salt, initCode)
//
// For chain-specific deployments (v1.5.0 only) the salt also includes chainId;
// this module intentionally uses the cross-chain-compatible formula.

import { AbiCoder, Interface, ZeroAddress, keccak256, solidityPacked } from "ethers";

// Minimal Safe Proxy Factory ABI fragments needed by callers.
export const SAFE_PROXY_FACTORY_ABI = [
  "function proxyCreationCode() view returns (bytes)",
  "function proxyCreationCodehash(address singleton) view returns (bytes32)",
  "function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
  "function createProxyWithNonceL2(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)",
];

/**
 * Compute the Safe Proxy init code hash off-chain.
 *
 * Prefer calling factory.proxyCreationCodehash(singleton) on-chain for
 * production address prediction; this helper is kept for offline mining.
 */
export function computeSafeInitCodeHash(
  _proxyCreationCode: string,
  _singletonAddress: string,
): string {
  return keccak256(
    solidityPacked(["bytes", "uint256"], [_proxyCreationCode, BigInt(_singletonAddress)]),
  );
}

// Minimal Safe singleton ABI fragments needed by callers.
export const SAFE_SINGLETON_ABI = [
  "function setup(address[] calldata _owners, uint256 _threshold, address to, bytes calldata data, address fallbackHandler, address paymentToken, uint256 payment, address payable paymentReceiver) external",
];

/**
 * Build the initializer calldata for Safe setup().
 *
 * Encodes the standard setup() call with its function selector so the Safe
 * proxy executes setup() during deployment. Uses no modules, no payment token,
 * and no fallback handler by default. Pass a non-zero fallbackHandler if the
 * Safe needs the compatibility fallback handler.
 */
export function buildSafeInitializer(
  _owners: string[],
  _threshold: number,
  _fallbackHandler: string = ZeroAddress,
): string {
  const iface = new Interface([
    "function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address payable paymentReceiver)",
  ]);
  return iface.encodeFunctionData("setup", [
    _owners,
    _threshold,
    ZeroAddress,
    "0x",
    _fallbackHandler,
    ZeroAddress,
    0,
    ZeroAddress,
  ]);
}

/**
 * Predict the address of a Safe Proxy deployed via createProxyWithNonce().
 *
 * @param _factoryAddress    - Safe Proxy Factory address.
 * @param _initCodeHash      - keccak256(proxyCreationCode ++ uint256(singleton)).
 *                             Call factory.proxyCreationCodehash(singleton) on-chain
 *                             to obtain the exact value and avoid off-chain hashing
 *                             discrepancies.
 * @param _initializer       - The encoded setup() call data.
 * @param _saltNonce         - The salt nonce supplied by the caller.
 */
export function predictSafeAddress(
  _factoryAddress: string,
  _initCodeHash: string,
  _initializer: string,
  _saltNonce: bigint,
): string {
  const initializerHash = keccak256(_initializer);
  const salt = keccak256(solidityPacked(["bytes32", "uint256"], [initializerHash, _saltNonce]));

  return (
    "0x" +
    keccak256(
      solidityPacked(
        ["bytes1", "address", "bytes32", "bytes32"],
        ["0xff", _factoryAddress, salt, _initCodeHash],
      ),
    ).slice(-40)
  );
}

function formatAttempts(_attempts: bigint): string {
  return _attempts.toLocaleString("en-US");
}

interface MineResult {
  saltNonce: bigint;
  address: string;
  attempts: bigint;
}

function toPaddedHex(_value: bigint, _bytes = 32): string {
  return _value.toString(16).padStart(_bytes * 2, "0");
}

/**
 * Fast inner mining loop. Avoids solidityPacked/string allocation overhead by
 * concatenating raw hex strings before calling keccak256.
 */
function mineMany(
  _factoryAddress: string,
  _initCodeHash: string,
  _initializerHash: string,
  _matches: (_address: string) => boolean,
  _start: bigint,
  _maxAttempts: bigint,
  _count: number,
  _onProgress?: (_attempts: bigint) => void,
): MineResult[] {
  const results: MineResult[] = [];
  const factoryHex = _factoryAddress.toLowerCase().slice(2);
  const initCodeHashHex = _initCodeHash.toLowerCase().slice(2);
  const initializerHashHex = _initializerHash.toLowerCase().slice(2);
  const reportInterval = 1_000_000n;
  let nextReport = _start + reportInterval;

  for (let i = _start; i < _start + _maxAttempts; i++) {
    const saltNonceHex = toPaddedHex(i);
    const salt = keccak256(`0x${initializerHashHex}${saltNonceHex}`);
    const saltHex = salt.toLowerCase().slice(2);
    const addressHash = keccak256(`0xff${factoryHex}${saltHex}${initCodeHashHex}`);
    const address = `0x${addressHash.toLowerCase().slice(-40)}`;

    if (_matches(address)) {
      results.push({ saltNonce: i, address, attempts: i - _start + 1n });
      if (results.length >= _count) {
        return results;
      }
    }

    if (_onProgress && i >= nextReport) {
      _onProgress(i - _start + 1n);
      nextReport += reportInterval;
    }
  }

  throw new Error(
    `Could not find ${_count} matching address(es) within ${_maxAttempts} attempts (start ${_start})`,
  );
}

function normalizeHexTarget(_value: string | undefined): string | undefined {
  if (!_value) return undefined;
  const cleaned = _value.toLowerCase().replace(/^0[xX]/, "");
  if (!/^[0-9a-f]+$/.test(cleaned)) throw new Error(`Invalid hex target: ${_value}`);
  return cleaned;
}

/**
 * Mine a salt nonce that makes the Safe Proxy address start with `_prefix`.
 */
export function mineSaltForPrefix(
  _initCodeHash: string,
  _factoryAddress: string,
  _initializer: string,
  _prefix: string,
  _start = 0n,
  _maxAttempts = 1_000_000n,
): MineResult {
  const target = normalizeHexTarget(_prefix)!;
  const initializerHash = keccak256(_initializer);
  return mineMany(
    _factoryAddress,
    _initCodeHash,
    initializerHash,
    (addr) => addr.toLowerCase().slice(2).startsWith(target),
    _start,
    _maxAttempts,
    1,
  )[0];
}

/**
 * Mine multiple salt nonces that make the Safe Proxy address start with `_prefix`.
 *
 * Returns the first `_count` matches so callers can pick one whose target address
 * is actually empty on-chain (CREATE2 reverts if the address already has code).
 */
export function mineSaltForPrefixCandidates(
  _initCodeHash: string,
  _factoryAddress: string,
  _initializer: string,
  _prefix: string,
  _start = 0n,
  _maxAttempts = 10_000_000n,
  _count = 20,
  _onProgress?: (_attempts: bigint) => void,
): MineResult[] {
  const target = normalizeHexTarget(_prefix)!;
  const initializerHash = keccak256(_initializer);
  return mineMany(
    _factoryAddress,
    _initCodeHash,
    initializerHash,
    (addr) => addr.toLowerCase().slice(2).startsWith(target),
    _start,
    _maxAttempts,
    _count,
    _onProgress,
  );
}

/**
 * Mine a salt nonce that makes the Safe Proxy address end with `_postfix`.
 */
export function mineSaltForPostfix(
  _initCodeHash: string,
  _factoryAddress: string,
  _initializer: string,
  _postfix: string,
  _start = 0n,
  _maxAttempts = 1_000_000n,
): MineResult {
  const target = normalizeHexTarget(_postfix)!;
  const initializerHash = keccak256(_initializer);
  return mineMany(
    _factoryAddress,
    _initCodeHash,
    initializerHash,
    (addr) => addr.toLowerCase().slice(2).endsWith(target),
    _start,
    _maxAttempts,
    1,
  )[0];
}

/**
 * Mine a salt nonce that makes the Safe Proxy address match both `_prefix` and `_postfix`.
 */
export function mineSaltForPrefixAndPostfix(
  _initCodeHash: string,
  _factoryAddress: string,
  _initializer: string,
  _prefix: string,
  _postfix: string,
  _start = 0n,
  _maxAttempts = 10_000_000n,
): MineResult {
  const targetPrefix = normalizeHexTarget(_prefix)!;
  const targetPostfix = normalizeHexTarget(_postfix)!;
  const initializerHash = keccak256(_initializer);
  return mineMany(
    _factoryAddress,
    _initCodeHash,
    initializerHash,
    (addr) => {
      const hex = addr.toLowerCase().slice(2);
      return hex.startsWith(targetPrefix) && hex.endsWith(targetPostfix);
    },
    _start,
    _maxAttempts,
    1,
  )[0];
}

/**
 * Convenience entry used by the deployer script: pick the right mining function
 * based on whether a prefix, postfix, or both were requested.
 */
export function mineSalt(
  _initCodeHash: string,
  _factoryAddress: string,
  _initializer: string,
  _prefix: string | undefined,
  _postfix: string | undefined,
  _start = 0n,
  _maxAttempts = 10_000_000n,
): MineResult {
  if (_prefix && _postfix) {
    return mineSaltForPrefixAndPostfix(
      _initCodeHash,
      _factoryAddress,
      _initializer,
      _prefix,
      _postfix,
      _start,
      _maxAttempts,
    );
  }
  if (_prefix) {
    return mineSaltForPrefix(
      _initCodeHash,
      _factoryAddress,
      _initializer,
      _prefix,
      _start,
      _maxAttempts,
    );
  }
  if (_postfix) {
    return mineSaltForPostfix(
      _initCodeHash,
      _factoryAddress,
      _initializer,
      _postfix,
      _start,
      _maxAttempts,
    );
  }
  throw new Error("At least one of --prefix or --postfix is required");
}

export type { MineResult };
