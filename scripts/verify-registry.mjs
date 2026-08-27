#!/usr/bin/env node
'use strict';

/**
 * Verify registry/registry.json against live chain state (§9.1).
 *
 * Chain state is the source of truth. At each registered address this checks
 * that code exists, that the payment entrypoint the registry claims is present
 * in that bytecode, that its keccak-256 matches the pinned runtimeCodeHash, and
 * that the treasury, fee split and owner the contract reports match what is
 * pinned.
 *
 * An address on its own says nothing about what is deployed at it, and a
 * treasury transcribed into a file by hand is just a second unverified table —
 * those are the two gaps this closes. Where the money goes is read from the
 * contract that will send it.
 *
 * Ownership is read for the same reason, one level up. The owner can pause the
 * contract, move the treasury and rewrite the stablecoin whitelist, so every
 * other pinned field is provisional until you know who holds it. Each v1.3
 * splitter must report the governance Safe, and that Safe is then read on the
 * same chain and required to have the exact recorded signer set and threshold —
 * not a floor, since a Safe quietly dropping from 4-of-5 to 3-of-5 is precisely
 * what a floor lets through.
 *
 * It fails closed. An RPC that cannot be reached produces a non-zero exit, not
 * a pass: "we could not check" and "it is fine" must never look the same. That
 * is also why every network is tried against several RPCs before it is called
 * unreachable, and why the run is serial — eight parallel workers got throttled
 * during the August audit and returned false "NO CODE" results.
 *
 *   node scripts/verify-registry.mjs           verify every entry
 *   node scripts/verify-registry.mjs --pin     write missing runtimeCodeHash values
 *
 * Keccak comes from ethers, already a dependency here. Do not hand-roll it.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { keccak256, id, getBytes, getAddress } from 'ethers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = join(ROOT, 'registry/registry.json');

/**
 * Payment entrypoints by declared version. The selector is derived, never
 * written down: a hardcoded selector that drifts from its signature is exactly
 * the sort of quiet inconsistency this tool exists to catch.
 */
const ENTRYPOINT = {
  '1.1': 'payMatic(address,address,string)',
  '1.2': 'payNative(bytes32,address,address,string)',
  '1.3': 'payNative((bytes32,address,uint256,address,uint256,string))',
};

const selectorOf = (signature) => id(signature).slice(0, 10);

/**
 * Configuration the contract itself reports. Reading these from the chain is
 * the difference between a registry and a second hand-maintained table: the
 * treasury and the fee split decide where money goes, so they must not be
 * transcribed by a human into a file that nothing checks.
 */
const CONFIG_CALLS = {
  treasury: { sig: 'treasury()', kind: 'address' },
  treasuryBps: { sig: 'treasuryBps()', kind: 'uint' },
  ipCreatorBps: { sig: 'ipCreatorBps()', kind: 'uint' },
  owner: { sig: 'owner()', kind: 'address' },
};

function decodeAddress(hex) {
  if (!hex || hex.length < 66) return null;
  return getAddress(`0x${hex.slice(-40)}`);
}

function decodeUint(hex) {
  if (!hex || hex === '0x') return null;
  return Number(BigInt(hex));
}

/**
 * Decode an `address[]` return. `Safe.getOwners()` is the only dynamic return
 * this script reads, so this stays deliberately narrow: offset word, length
 * word, then one address per word.
 */
function decodeAddressArray(hex) {
  if (!hex || hex.length < 130) return null;
  const words = hex.slice(2).match(/.{64}/g);
  if (!words) return null;
  const length = Number(BigInt(`0x${words[1]}`));
  if (words.length < 2 + length) return null;
  return Array.from({ length }, (_, i) => getAddress(`0x${words[2 + i].slice(24)}`));
}

async function readConfig(url, address) {
  const out = {};
  for (const [name, { sig, kind }] of Object.entries(CONFIG_CALLS)) {
    const data = selectorOf(sig);
    const raw = await rpcCall(url, 'eth_call', [{ to: address, data }, 'latest']);
    out[name] = kind === 'address' ? decodeAddress(raw) : decodeUint(raw);
    if (out[name] === null || out[name] === undefined) {
      throw new Error(`${sig} returned nothing`);
    }
  }
  return out;
}

/**
 * The governance Safe as it exists on the chain being verified.
 *
 * `owner()` returning the right address is only half the answer. A Safe at that
 * address with different signers, or with the threshold lowered, still reports
 * the same owner while meaning something entirely different — one key instead
 * of three. So the signer set and the threshold are read too, and compared as
 * an exact shape rather than a floor. `threshold >= 2` is what the production
 * deploy script used to assert, and it passed a 4-of-5 Safe that had become
 * 3-of-5 without comment: a floor waves through exactly the case worth
 * catching.
 *
 * Tried against the same RPC list as the splitter, preferring the node that
 * already served the code, and each node is re-checked for chain identity
 * first: a node answering for a different chain would report a different Safe
 * and call it a match. Only when every node fails is the Safe unverified — and
 * unverified is a failure, not a skip.
 */
async function readSafe(entry, preferredRpc, governance) {
  const { safe } = governance;
  const urls = [preferredRpc, ...entry.rpcs.filter((u) => u !== preferredRpc)];
  const failures = [];

  for (const url of urls) {
    try {
      const chainIdHex = await rpcCall(url, 'eth_chainId', []);
      if (Number(BigInt(chainIdHex)) !== entry.chainId) {
        failures.push(`${url}: serves a different chain`);
        continue;
      }
      const code = await rpcCall(url, 'eth_getCode', [safe, 'latest']);
      if (!code || code === '0x') {
        return { problems: [`no code at the governance Safe ${safe} — an EOA cannot enforce a threshold`] };
      }
      const owners = decodeAddressArray(
        await rpcCall(url, 'eth_call', [{ to: safe, data: selectorOf('getOwners()') }, 'latest']),
      );
      const threshold = decodeUint(
        await rpcCall(url, 'eth_call', [{ to: safe, data: selectorOf('getThreshold()') }, 'latest']),
      );
      if (!owners) return { problems: [`getOwners() at ${safe} did not decode as address[]`] };
      if (threshold === null) return { problems: [`getThreshold() at ${safe} returned nothing`] };
      return { problems: compareSafe(owners, threshold, governance), owners, threshold };
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    }
  }

  return { problems: [`could not read the governance Safe — ${failures.join('; ')}`] };
}

/** Exact shape comparison: same signers, same threshold. Never a floor. */
function compareSafe(owners, threshold, governance) {
  const expectedThreshold = governance.threshold;
  const problems = [];
  if (threshold !== expectedThreshold) {
    problems.push(`Safe threshold is ${threshold}, expected exactly ${expectedThreshold}`);
  }

  const actual = new Set(owners.map((a) => a.toLowerCase()));
  const expected = new Set(governance.owners.map((o) => getAddress(o.address).toLowerCase()));
  const missing = [...expected].filter((a) => !actual.has(a));
  const extra = [...actual].filter((a) => !expected.has(a));
  if (missing.length) problems.push(`Safe is missing owner(s) ${missing.join(', ')}`);
  if (extra.length) problems.push(`Safe has unrecorded owner(s) ${extra.join(', ')}`);

  return problems;
}

/** chainId -> result. The Safe is the same contract for both routes on a chain. */
const safeChecked = new Map();

const PIN = process.argv.includes('--pin');

async function rpcCall(url, method, params) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(body.error.message ?? 'rpc error');
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

/** Try each RPC in turn. Only when all fail is the chain unreachable. */
async function fetchCode(entry) {
  const failures = [];
  for (const url of entry.rpcs) {
    try {
      const chainIdHex = await rpcCall(url, 'eth_chainId', []);
      const actualChainId = Number(BigInt(chainIdHex));
      if (actualChainId !== entry.chainId) {
        // A node answering for a different chain would verify the wrong
        // bytecode and report success.
        failures.push(`${url}: serves chain ${actualChainId}, expected ${entry.chainId}`);
        continue;
      }
      const code = await rpcCall(url, 'eth_getCode', [entry.splitter, 'latest']);
      if (!code || code === '0x') return { code, rpc: url, config: null };
      // Same RPC, so the config cannot come from a different node than the code.
      const config = await readConfig(url, entry.splitter);
      return { code, rpc: url, config };
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    }
  }
  return { code: null, failures };
}

async function verifyEntry(name, entry) {
  const signature = ENTRYPOINT[entry.version];
  if (!signature) {
    return { name, ok: false, reason: `unknown declared version "${entry.version}"` };
  }

  const { code, rpc, config, failures } = await fetchCode(entry);
  if (code === null) {
    return {
      name,
      ok: false,
      unreachable: true,
      reason: `no RPC reachable — ${failures.join('; ')}`,
    };
  }
  if (!code || code === '0x') {
    return { name, ok: false, reason: `NO CODE at ${entry.splitter}` };
  }

  const selector = selectorOf(signature).slice(2);
  if (!code.toLowerCase().includes(selector.toLowerCase())) {
    return {
      name,
      ok: false,
      reason: `declared v${entry.version} but ${signature} (0x${selector}) is not in the deployed bytecode`,
    };
  }

  // Treasury and fee split, as the contract reports them.
  const mismatches = [];
  for (const [field, actual] of Object.entries(config ?? {})) {
    const pinned = entry[field];
    if (pinned === undefined || pinned === null) {
      if (PIN) entry[field] = actual;
      else mismatches.push(`${field} not pinned (chain says ${actual})`);
      continue;
    }
    const same =
      typeof actual === 'string'
        ? String(pinned).toLowerCase() === actual.toLowerCase()
        : Number(pinned) === actual;
    if (!same) mismatches.push(`${field} pinned ${pinned}, chain says ${actual}`);
  }
  if (mismatches.length) {
    return { name, ok: false, reason: mismatches.join('; ') };
  }

  // Governance. Everything pinned above is only as trustworthy as whoever can
  // change it: the owner can pause the contract, move the treasury and rewrite
  // the stablecoin whitelist. So the owner is read from the contract rather
  // than inferred from the deploy script that was supposed to set it.
  const governance = registry.governance;
  const ownedByGovernanceSafe =
    String(entry.owner ?? '').toLowerCase() === governance.safe.toLowerCase();

  if (entry.version === '1.3' && !ownedByGovernanceSafe) {
    return {
      name,
      ok: false,
      reason:
        `owner is ${entry.owner}, but every v1.3 route splitter must be owned by ` +
        `the governance Safe ${governance.safe}`,
    };
  }

  // The legacy v1.1/v1.2 splitters are owned by a deployer EOA. That is history
  // and cannot be rewritten, but it must never become a settlement target: one
  // key can re-point the treasury on those. Superseded is not enough on its own,
  // so ownership and payability are tied together here.
  if (!ownedByGovernanceSafe && entry.settlementEnabled === true) {
    return {
      name,
      ok: false,
      reason:
        `settlement is enabled but the owner ${entry.owner} is not the governance ` +
        'Safe — a single key could re-point this splitter',
    };
  }

  if (ownedByGovernanceSafe) {
    if (!safeChecked.has(entry.chainId)) {
      safeChecked.set(entry.chainId, await readSafe(entry, rpc, governance));
    }
    const { problems } = safeChecked.get(entry.chainId);
    if (problems.length) return { name, ok: false, reason: problems.join('; ') };
  }

  const runtimeCodeHash = keccak256(getBytes(code));
  if (!entry.runtimeCodeHash) {
    if (!PIN) {
      return {
        name,
        ok: false,
        reason: `runtimeCodeHash not pinned (chain says ${runtimeCodeHash}) — re-run with --pin`,
        observed: runtimeCodeHash,
      };
    }
    entry.runtimeCodeHash = runtimeCodeHash;
    return { name, ok: true, pinned: true, runtimeCodeHash, rpc, bytes: (code.length - 2) / 2 };
  }
  if (entry.runtimeCodeHash.toLowerCase() !== runtimeCodeHash.toLowerCase()) {
    return {
      name,
      ok: false,
      reason: `runtimeCodeHash mismatch — pinned ${entry.runtimeCodeHash}, chain says ${runtimeCodeHash}`,
    };
  }

  return { name, ok: true, runtimeCodeHash, rpc, bytes: (code.length - 2) / 2 };
}

const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));

// Without this block there is nothing to check ownership against, and every
// entry would pass on the strength of a field nobody compared to anything.
const governanceOwners = registry.governance?.owners;
if (
  !registry.governance?.safe ||
  typeof registry.governance.threshold !== 'number' ||
  !Array.isArray(governanceOwners) ||
  governanceOwners.length === 0
) {
  console.error(
    'registry.json has no usable governance block. It must declare the Safe ' +
      'address, its exact owner list and its threshold — ownership is not ' +
      'verifiable without them.',
  );
  process.exit(1);
}

const results = [];

// Serial on purpose. Parallel workers get rate-limited by public RPCs, and a
// throttled response is indistinguishable from an empty one.
for (const [name, entry] of Object.entries(registry.splitters)) {
  process.stdout.write(`${name.padEnd(26)} `);
  const result = await verifyEntry(name, entry);
  results.push(result);
  if (result.ok) {
    console.log(
      `OK  v${entry.version} ${result.bytes}B ${result.runtimeCodeHash.slice(0, 18)}…${result.pinned ? ' (pinned)' : ''}`,
    );
  } else {
    console.log(`FAIL  ${result.reason}`);
  }
}

const failed = results.filter((r) => !r.ok);
const unreachable = failed.filter((r) => r.unreachable);

console.log(`\n${results.length - failed.length}/${results.length} verified against chain state.`);
console.log(
  `Governance Safe ${registry.governance.safe} verified ` +
    `${registry.governance.threshold}-of-${governanceOwners.length} on ` +
    `${[...safeChecked.values()].filter((r) => !r.problems.length).length} chain(s).`,
);

if (PIN && !failed.length) {
  registry.updatedAt = new Date().toISOString().slice(0, 10);
  writeFileSync(REGISTRY, `${JSON.stringify(registry, null, 2)}\n`);
  console.log('registry.json updated with pinned runtime code hashes.');
}

if (failed.length) {
  console.error('\nFailed:');
  for (const f of failed) console.error(`  ${f.name}: ${f.reason}`);
  if (unreachable.length) {
    console.error(
      `\n${unreachable.length} chain(s) unreachable. This is a FAILURE, not a skip —` +
        ' an unchecked chain cannot be released as verified.',
    );
  }
  process.exit(1);
}
