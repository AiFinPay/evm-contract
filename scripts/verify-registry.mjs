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

      // Everything above answers "who may sign". None of it answers "what does
      // the Safe do with a signature" — and that is where a compromise hides.
      // v1.3 audit P0 #2.
      const implementation = await readSafeImplementation(url, safe);

      return {
        problems: [
          ...compareSafe(owners, threshold, governance),
          ...compareImplementation(implementation, governance, safe),
        ],
        owners,
        threshold,
        implementation,
      };
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    }
  }

  return { problems: [`could not read the governance Safe — ${failures.join('; ')}`] };
}

/**
 * Storage slots a Safe uses for the pieces that change its behaviour without
 * changing its signers. Slot 0 is the proxy's singleton; the other two are
 * namespaced hashes, chosen by Safe precisely so they cannot collide with
 * ordinary storage.
 */
const SAFE_SLOT_SINGLETON = `0x${'0'.repeat(64)}`;
const SAFE_SLOT_GUARD = id('guard_manager.guard.address');
const SAFE_SLOT_FALLBACK = id('fallback_manager.handler.address');
const MODULE_SENTINEL = '0x0000000000000000000000000000000000000001';
const ZERO = '0x0000000000000000000000000000000000000000';

/** Right-most 20 bytes of a storage word, as a checksummed address. */
function addressFromWord(word) {
  if (!word || word === '0x') return null;
  return getAddress(`0x${word.slice(-40)}`);
}

/**
 * Read the four things that decide what a Safe actually does, as opposed to
 * who is allowed to ask it.
 *
 * Modules are read through `getModulesPaginated` rather than storage, because
 * the module list is a linked list and reconstructing it from raw slots means
 * reimplementing Safe's own traversal. A page of 20 is far past anything we
 * expect; if it ever fills, `next` tells us and we say so rather than assuming
 * the list ended.
 */
async function readSafeImplementation(url, safe) {
  const singleton = addressFromWord(
    await rpcCall(url, 'eth_getStorageAt', [safe, SAFE_SLOT_SINGLETON, 'latest']),
  );
  const guard = addressFromWord(
    await rpcCall(url, 'eth_getStorageAt', [safe, SAFE_SLOT_GUARD, 'latest']),
  );
  const fallbackHandler = addressFromWord(
    await rpcCall(url, 'eth_getStorageAt', [safe, SAFE_SLOT_FALLBACK, 'latest']),
  );

  const PAGE = 20;
  const data =
    selectorOf('getModulesPaginated(address,uint256)') +
    MODULE_SENTINEL.slice(2).padStart(64, '0') +
    PAGE.toString(16).padStart(64, '0');
  const raw = await rpcCall(url, 'eth_call', [{ to: safe, data }, 'latest']);
  const words = (raw ?? '0x').slice(2).match(/.{64}/g) ?? [];
  const count = words.length >= 3 ? parseInt(words[2], 16) : 0;
  const modules = words.slice(3, 3 + count).map((w) => getAddress(`0x${w.slice(-40)}`));
  const truncated = count >= PAGE;

  const codeHashOf = async (address) =>
    address && address !== ZERO
      ? keccak256(getBytes(await rpcCall(url, 'eth_getCode', [address, 'latest'])))
      : null;

  return {
    singleton,
    singletonCodeHash: await codeHashOf(singleton),
    guard,
    fallbackHandler,
    fallbackHandlerCodeHash: await codeHashOf(fallbackHandler),
    modules,
    truncated,
  };
}

/**
 * Compare against the pin in registry.json. A missing pin is a failure, not a
 * skip: "we never wrote down what the Safe should be" and "the Safe is what we
 * expect" must not produce the same green tick.
 */
function compareImplementation(actual, governance, safe) {
  const pin = governance.implementation;
  const problems = [];
  if (!pin) {
    return [
      `registry governance has no "implementation" pin, so the Safe singleton, modules, guard and fallback handler at ${safe} are unverified. A Safe can be fully compromised without changing a single signer.`,
    ];
  }

  // The singleton is the one that matters most: swap it and every other answer
  // this script trusts, getOwners() included, comes from the new code.
  if (pin.singleton && actual.singleton !== getAddress(pin.singleton)) {
    problems.push(
      `Safe singleton is ${actual.singleton}, expected ${getAddress(pin.singleton)}. The proxy delegates every call here — a different singleton means getOwners() and getThreshold() above were answered by unreviewed code.`,
    );
  }
  if (pin.singletonCodeHash && actual.singletonCodeHash !== pin.singletonCodeHash.toLowerCase()) {
    problems.push(
      `Safe singleton code hash is ${actual.singletonCodeHash}, expected ${pin.singletonCodeHash}.`,
    );
  }

  // A module executes through the Safe with no signature check whatsoever.
  const expectedModules = new Set((pin.modules ?? []).map((m) => getAddress(m)));
  const unexpected = actual.modules.filter((m) => !expectedModules.has(m));
  if (unexpected.length) {
    problems.push(
      `Safe has unrecorded module(s) ${unexpected.join(', ')}. A module executes transactions through the Safe without any signature, so the ${governance.threshold}-of-${governance.owners.length} threshold does not apply to it.`,
    );
  }
  const missingModules = [...expectedModules].filter((m) => !actual.modules.includes(m));
  if (missingModules.length) {
    problems.push(`registry expects module(s) ${missingModules.join(', ')} that the Safe does not have.`);
  }
  if (actual.truncated) {
    problems.push(`Safe returned a full page of modules — the list may be longer than this check read.`);
  }

  const expectedGuard = pin.guard ? getAddress(pin.guard) : ZERO;
  if ((actual.guard ?? ZERO) !== expectedGuard) {
    problems.push(
      `Safe guard is ${actual.guard === ZERO ? 'unset' : actual.guard}, expected ${expectedGuard === ZERO ? 'unset' : expectedGuard}. A guard runs around every execution and can block or alter it.`,
    );
  }

  if (pin.fallbackHandler && actual.fallbackHandler !== getAddress(pin.fallbackHandler)) {
    problems.push(
      `Safe fallback handler is ${actual.fallbackHandler}, expected ${getAddress(pin.fallbackHandler)}. The handler answers every selector the Safe does not implement itself.`,
    );
  }
  if (
    pin.fallbackHandlerCodeHash &&
    actual.fallbackHandlerCodeHash !== pin.fallbackHandlerCodeHash.toLowerCase()
  ) {
    problems.push(
      `Safe fallback handler code hash is ${actual.fallbackHandlerCodeHash}, expected ${pin.fallbackHandlerCodeHash}.`,
    );
  }

  return problems;
}

/**
 * The stablecoin whitelist, checked in both directions.
 *
 * `whitelistedTokens` is a plain mapping, so the chain will answer "is THIS
 * token allowed" and nothing else — there is no way to ask it for the whole
 * set. Reconstructing the set means replaying WhitelistedTokensUpdated from
 * deployment, and every free RPC we use caps eth_getLogs at 10 000 blocks
 * (verified 2026-08-27 against drpc, publicnode and 1rpc), which turns a full
 * replay into roughly a hundred requests per chain per run. That is not a
 * check, it is a rate limit waiting to happen.
 *
 * So this asks about named tokens only, and the registry names them in two
 * lists. `whitelisted` is what must be ON — it catches a stablecoin being
 * removed, which silently breaks every payment in it. `mustNotBeWhitelisted`
 * is what must stay OFF, seeded with the tokens the superseded
 * scripts/deploy-splitter-v13.ts table named: exactly the addresses a redeploy
 * from the wrong table would switch on.
 *
 * What this does NOT cover, stated plainly so nobody reads a green tick as
 * more than it is: a token nobody has named cannot be detected here. Catching
 * that needs event indexing against an archive node, and is tracked separately.
 */
async function checkStablecoins(preferredRpc, entry) {
  const pin = entry.stablecoins;
  if (!pin) return [];   // only v1.3 routes carry the pin
  const problems = [];

  // Free nodes rate-limit, and a 429 on one of them says nothing about the
  // whitelist. Fall through the same RPC list the code came from, in the same
  // order readSafe uses, and only give up when every node is exhausted.
  const urls = [preferredRpc, ...entry.rpcs.filter((u) => u !== preferredRpc)];
  const read = async (token) => {
    const data = selectorOf('whitelistedTokens(address)') + getAddress(token).slice(2).padStart(64, '0');
    const failures = [];
    for (const url of urls) {
      try {
        const raw = await rpcCall(url, 'eth_call', [{ to: entry.splitter, data }, 'latest']);
        return BigInt(raw ?? '0x0') === 1n;
      } catch (error) {
        failures.push(`${url}: ${error.message}`);
      }
    }
    throw new Error(`no RPC could read whitelistedTokens(${token}) — ${failures.join('; ')}`);
  };

  for (const { symbol, address } of pin.whitelisted ?? []) {
    if (!(await read(address))) {
      problems.push(
        `${symbol} ${address} is NOT whitelisted, but the registry says it must be. Every payment quoted in ${symbol} on this route reverts.`,
      );
    }
  }
  for (const { symbol, address } of pin.mustNotBeWhitelisted ?? []) {
    if (await read(address)) {
      problems.push(
        `${symbol} ${address} IS whitelisted, and the registry says it must not be. This is the address the superseded deploy-splitter-v13.ts table names — check whether this route was deployed from the wrong config.`,
      );
    }
  }
  return problems;
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

async function rpcCall(url, method, params, attempt = 0) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
      signal: controller.signal,
    });
    if (res.status === 429 && attempt < 2) {
      // A free node saying "too many requests" is not a node that failed. It
      // is asking us to slow down, and every check here is read-only, so
      // retrying is safe. Bounded, because "could not check" must still be
      // able to become a failure rather than an infinite wait.
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
      return rpcCall(url, method, params, attempt + 1);
    }
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

  // The comment above names rewriting the stablecoin whitelist as one of the
  // things an owner can do. Until now nothing checked it, so the sentence was
  // a description of the risk rather than a defence against it.
  let stableProblems;
  try {
    stableProblems = await checkStablecoins(rpc, entry);
  } catch (error) {
    // Fail closed, and as THIS entry rather than as the whole run. An
    // exception escaping here killed the process on the first attempt, which
    // turned one rate-limited node into zero routes verified.
    return { name, ok: false, unreachable: true, reason: `stablecoin whitelist unreadable — ${error.message}` };
  }
  if (stableProblems.length) return { name, ok: false, reason: stableProblems.join('; ') };

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
const safeOk = [...safeChecked.values()].filter((r) => !r.problems.length);
console.log(
  `Governance Safe ${registry.governance.safe} verified ` +
    `${registry.governance.threshold}-of-${governanceOwners.length} on ` +
    `${safeOk.length} chain(s).`,
);
// Naming what was checked, not just that something was: "3-of-5 verified" reads
// as a complete answer, and for the whole of v1.3 it was taken as one while the
// singleton, modules, guard and fallback handler went unread.
const impl = safeOk.find((r) => r.implementation)?.implementation;
if (impl) {
  console.log(
    `  singleton ${impl.singleton}, fallback handler ${impl.fallbackHandler}, ` +
      `${impl.modules.length} module(s), guard ${impl.guard === `0x${'0'.repeat(40)}` ? 'unset' : impl.guard} ` +
      `— all matched the registry pin.`,
  );
}

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
