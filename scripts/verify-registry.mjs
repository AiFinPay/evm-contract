#!/usr/bin/env node
'use strict';

/**
 * Verify registry/registry.json against live chain state (§9.1).
 *
 * Chain state is the source of truth. At each registered address this checks
 * that code exists, that the payment entrypoint the registry claims is present
 * in that bytecode, that its keccak-256 matches the pinned runtimeCodeHash, and
 * that the treasury, fee split, owner and stablecoin allowlist the contract
 * reports match what is pinned.
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
 * same chain: exact signer set, exact threshold, pinned singleton and its code
 * hash, pinned fallback handler, no guard, no modules. A correct 3-of-5 signer
 * set is not proof that only three signatures can act — a module acts with
 * none — so the whole shape is checked, never a floor.
 *
 * Nothing is trusted from one node. Every value is read from at least two
 * independent providers (distinct hosts) and must agree byte-for-byte. A
 * chain with a single provider must say so in the registry (`rpcQuorum: 1`
 * with a reason) and is reported loudly; it verifies, but it does not activate.
 *
 * It fails closed. An RPC that cannot be reached produces a non-zero exit, not
 * a pass: "we could not check" and "it is fine" must never look the same. The
 * run is serial — eight parallel workers got throttled during the August audit
 * and returned false "NO CODE" results.
 *
 *   node scripts/verify-registry.mjs           verify every entry
 *   node scripts/verify-registry.mjs --pin     write missing hashes / nonces
 *
 * Keccak comes from ethers, already a dependency here. Do not hand-roll it.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { keccak256, id, getBytes, getAddress } from 'ethers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = join(ROOT, 'registry/registry.json');

const PIN = process.argv.includes('--pin');
const ZERO = '0x0000000000000000000000000000000000000000';
const SENTINEL = '0x0000000000000000000000000000000000000001';

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
const word = (value) => BigInt(value).toString(16).padStart(64, '0');

/**
 * Configuration the contract itself reports. Reading these from the chain is
 * the difference between a registry and a second hand-maintained table.
 */
const CONFIG_CALLS = {
  treasury: { sig: 'treasury()', kind: 'address' },
  treasuryBps: { sig: 'treasuryBps()', kind: 'uint' },
  ipCreatorBps: { sig: 'ipCreatorBps()', kind: 'uint' },
  owner: { sig: 'owner()', kind: 'address' },
};

/**
 * Safe v1.4.1 storage. Slot 0 is the singleton. The guard and fallback handler
 * live in keccak-named slots (GuardManager / FallbackManager) rather than
 * behind getters, so they are read with eth_getStorageAt.
 */
const GUARD_SLOT = keccak256(Buffer.from('guard_manager.guard.address'));
const FALLBACK_SLOT = keccak256(Buffer.from('fallback_manager.handler.address'));

// ---------------------------------------------------------------- decoding

function decodeAddress(hex) {
  if (!hex || hex.length < 66) return null;
  return getAddress(`0x${hex.slice(-40)}`);
}

function decodeUint(hex) {
  if (!hex || hex === '0x') return null;
  return Number(BigInt(hex));
}

function decodeBool(hex) {
  if (!hex || hex === '0x') return null;
  return BigInt(hex) !== 0n;
}

/** `address[]` return: offset word, length word, one address per word. */
function decodeAddressArray(hex, arrayWordIndex = 0) {
  if (!hex || hex.length < 130) return null;
  const words = hex.slice(2).match(/.{64}/g);
  if (!words) return null;
  const offset = Number(BigInt(`0x${words[arrayWordIndex]}`)) / 32;
  const length = Number(BigInt(`0x${words[offset]}`));
  if (words.length < offset + 1 + length) return null;
  return Array.from({ length }, (_, i) => getAddress(`0x${words[offset + 1 + i].slice(24)}`));
}

// --------------------------------------------------------------------- rpc

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One request, one retry on rate limiting. Public providers throttle bursts,
 * and a 429 is not a statement about chain state — but a second 429 from the
 * same host is that host declining to answer, and it counts as unreachable.
 */
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
    if (res.status === 429 && attempt === 0) {
      clearTimeout(timer);
      await sleep(1_500);
      return rpcCall(url, method, params, 1);
    }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    if (body.error) throw new Error(body.error.message ?? 'rpc error');
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

const call = (url, to, data) => rpcCall(url, 'eth_call', [{ to, data }, 'latest']);
const codeAt = (url, address) => rpcCall(url, 'eth_getCode', [address, 'latest']);
const slotAt = (url, address, slot) => rpcCall(url, 'eth_getStorageAt', [address, slot, 'latest']);

// ------------------------------------------------------------- observation

/**
 * Everything one node says about one registry entry, in a shape that can be
 * compared byte-for-byte with what another node says. Nothing here is judged;
 * that happens after the observations agree.
 */
async function observeSplitter(url, entry) {
  const chainIdHex = await rpcCall(url, 'eth_chainId', []);
  const chainId = Number(BigInt(chainIdHex));
  if (chainId !== entry.chainId) {
    // A node answering for a different chain would verify the wrong bytecode
    // and report success.
    throw new Error(`serves chain ${chainId}, expected ${entry.chainId}`);
  }

  const code = await codeAt(url, entry.splitter);
  if (!code || code === '0x') return { chainId, code: '0x' };

  const config = {};
  for (const [name, { sig, kind }] of Object.entries(CONFIG_CALLS)) {
    const raw = await call(url, entry.splitter, selectorOf(sig));
    config[name] = kind === 'address' ? decodeAddress(raw) : decodeUint(raw);
    if (config[name] === null || config[name] === undefined) {
      throw new Error(`${sig} returned nothing`);
    }
  }

  // Stablecoin allowlist. The mapping cannot be enumerated, so each pinned
  // token is asked about individually, and the zero address is asked about as
  // a control — it must never be allowed.
  const stablecoins = {};
  if (entry.stablecoins) {
    for (const [symbol, token] of Object.entries(entry.stablecoins)) {
      if (!token) continue;
      const raw = await call(url, entry.splitter, selectorOf('whitelistedTokens(address)') + word(token));
      stablecoins[symbol] = decodeBool(raw);
    }
    stablecoins.$zero = decodeBool(
      await call(url, entry.splitter, selectorOf('whitelistedTokens(address)') + word(ZERO)),
    );
  }

  return { chainId, code, config, stablecoins };
}

/**
 * Everything one node says about the governance Safe on one chain. The Safe is
 * the same contract for both routes on a chain, so this is observed once per
 * chain and cached.
 */
async function observeSafe(url, governance) {
  const { safe } = governance;
  const proxyCode = await codeAt(url, safe);
  if (!proxyCode || proxyCode === '0x') return { proxyCode: '0x' };

  const singleton = decodeAddress(await slotAt(url, safe, '0x0'));
  const singletonCode = await codeAt(url, singleton);
  const fallbackHandler = decodeAddress(await slotAt(url, safe, FALLBACK_SLOT));
  const fallbackCode = fallbackHandler === ZERO ? '0x' : await codeAt(url, fallbackHandler);
  const guard = decodeAddress(await slotAt(url, safe, GUARD_SLOT));

  const owners = decodeAddressArray(await call(url, safe, selectorOf('getOwners()')));
  const threshold = decodeUint(await call(url, safe, selectorOf('getThreshold()')));
  const nonce = decodeUint(await call(url, safe, selectorOf('nonce()')));

  // getModulesPaginated(start, pageSize) returns (address[] modules, address next).
  // A page larger than any sane module count plus next == SENTINEL proves the
  // list is complete, not merely that the first page was empty.
  const modulesRaw = await call(
    url,
    safe,
    selectorOf('getModulesPaginated(address,uint256)') + word(SENTINEL) + word(100),
  );
  const modules = decodeAddressArray(modulesRaw, 0);
  const next = decodeAddress(`0x${modulesRaw.slice(2 + 64, 2 + 128)}`);
  if (modules === null || threshold === null || nonce === null || !owners) {
    throw new Error('Safe getters did not decode');
  }
  if (next !== SENTINEL) throw new Error('module list did not terminate — more than 100 modules?');

  return {
    proxyCodeHash: keccak256(getBytes(proxyCode)),
    singleton,
    singletonCodeHash: keccak256(getBytes(singletonCode)),
    fallbackHandler,
    fallbackHandlerCodeHash: keccak256(getBytes(fallbackCode)),
    guard,
    modules: modules.map((m) => m.toLowerCase()).sort(),
    owners: owners.map((o) => o.toLowerCase()).sort(),
    threshold,
    nonce,
  };
}

// ------------------------------------------------------------------ quorum

const hostOf = (url) => new URL(url).host;

/**
 * Ask independent providers until `required` of them agree, or the list runs
 * out. Agreement is byte-for-byte on the canonical JSON of the observation:
 * a node that disagrees on anything is a disagreement, whatever the field.
 *
 * "Independent" means distinct hosts. Two URLs on one host are one provider.
 */
async function withQuorum(entry, observe, label) {
  const required = entry.rpcQuorum ?? 2;
  const seenHosts = new Set();
  const agreed = [];
  const failures = [];
  let reference = null;

  for (const url of entry.rpcs) {
    const host = hostOf(url);
    if (seenHosts.has(host)) continue;
    seenHosts.add(host);
    try {
      const observation = await observe(url);
      const canonical = JSON.stringify(observation);
      if (reference === null) {
        reference = { canonical, observation, url };
        agreed.push(url);
      } else if (canonical === reference.canonical) {
        agreed.push(url);
      } else {
        // Two nodes disagree about chain state. That is never resolved by
        // picking one — something is wrong with a provider, and a payment
        // registry does not guess which.
        return {
          ok: false,
          reason:
            `${label}: ${hostOf(reference.url)} and ${host} disagree about chain state — ` +
            'a payment registry does not pick a side',
        };
      }
      if (agreed.length >= required) break;
    } catch (error) {
      failures.push(`${host}: ${error.message}`);
    }
  }

  if (!reference) {
    return { ok: false, unreachable: true, reason: `${label}: no RPC reachable — ${failures.join('; ')}` };
  }
  if (agreed.length < required) {
    return {
      ok: false,
      unreachable: true,
      reason:
        `${label}: only ${agreed.length} of the required ${required} independent provider(s) ` +
        `answered (${agreed.map(hostOf).join(', ')}) — ${failures.join('; ') || 'no other hosts listed'}`,
    };
  }
  return { ok: true, observation: reference.observation, providers: agreed.map(hostOf), required };
}

// ------------------------------------------------------------- judgements

/** Exact shape comparison of the Safe: never a floor, never a subset. */
function judgeSafe(seen, governance, chain) {
  const problems = [];
  const eq = (a, b) => String(a).toLowerCase() === String(b).toLowerCase();

  if (seen.proxyCode === '0x') {
    return [`no code at the governance Safe ${governance.safe} — an EOA cannot enforce a threshold`];
  }
  if (!eq(seen.singleton, governance.singleton)) {
    problems.push(`Safe singleton is ${seen.singleton}, expected ${governance.singleton}`);
  }
  if (!eq(seen.singletonCodeHash, governance.singletonCodeHash)) {
    problems.push(`Safe singleton code hash ${seen.singletonCodeHash} does not match the pinned hash`);
  }
  if (!eq(seen.proxyCodeHash, governance.proxyCodeHash)) {
    problems.push(`Safe proxy code hash ${seen.proxyCodeHash} does not match the pinned hash`);
  }
  if (!eq(seen.fallbackHandler, governance.fallbackHandler)) {
    problems.push(`Safe fallback handler is ${seen.fallbackHandler}, expected ${governance.fallbackHandler}`);
  }
  if (!eq(seen.fallbackHandlerCodeHash, governance.fallbackHandlerCodeHash)) {
    problems.push('Safe fallback handler code hash does not match the pinned hash');
  }
  if (!eq(seen.guard, governance.guard)) {
    problems.push(`Safe guard is ${seen.guard}, expected ${governance.guard}`);
  }

  const expectedModules = governance.modules.map((m) => m.toLowerCase()).sort();
  if (JSON.stringify(seen.modules) !== JSON.stringify(expectedModules)) {
    problems.push(
      `Safe modules are [${seen.modules.join(', ') || 'none'}], expected ` +
        `[${expectedModules.join(', ') || 'none'}] — a module executes without owner signatures`,
    );
  }

  if (seen.threshold !== governance.threshold) {
    problems.push(`Safe threshold is ${seen.threshold}, expected exactly ${governance.threshold}`);
  }
  const expectedOwners = governance.owners.map((o) => getAddress(o.address).toLowerCase()).sort();
  const missing = expectedOwners.filter((a) => !seen.owners.includes(a));
  const extra = seen.owners.filter((a) => !expectedOwners.includes(a));
  if (missing.length) problems.push(`Safe is missing owner(s) ${missing.join(', ')}`);
  if (extra.length) problems.push(`Safe has unrecorded owner(s) ${extra.join(', ')}`);

  // The nonce is the cheap, exhaustive proof that nothing owner-controlled
  // changed since the last review: whitelist, treasury and pause can only move
  // through the owner, the owner is this Safe, and every Safe execution
  // increments the nonce. A higher nonce means governance acted — fail until a
  // human reviews what ran and re-pins.
  const reviewed = governance.reviewedNonce?.[chain];
  if (reviewed === undefined || reviewed === null) {
    if (PIN) governance.reviewedNonce = { ...(governance.reviewedNonce ?? {}), [chain]: seen.nonce };
    else problems.push(`no reviewed Safe nonce pinned for ${chain} (chain says ${seen.nonce}) — re-run with --pin`);
  } else if (seen.nonce !== reviewed) {
    problems.push(
      `Safe nonce is ${seen.nonce} but ${reviewed} was reviewed — a governance transaction has ` +
        'executed since the last review; review it, then re-pin with --pin',
    );
  }
  return problems;
}

/** chainId -> quorum result for the Safe. Same contract for both routes. */
const safeByChain = new Map();

async function verifyEntry(name, entry, registry) {
  const signature = ENTRYPOINT[entry.version];
  if (!signature) {
    return { name, ok: false, reason: `unknown declared version "${entry.version}"` };
  }
  if (entry.rpcQuorum !== undefined && (entry.rpcQuorum < 2 && !entry.rpcQuorumReason)) {
    return { name, ok: false, reason: 'rpcQuorum below 2 requires rpcQuorumReason' };
  }

  const quorum = await withQuorum(entry, (url) => observeSplitter(url, entry), 'splitter');
  if (!quorum.ok) return { name, ...quorum };
  const { observation: seen, providers, required } = quorum;

  if (seen.code === '0x') {
    return { name, ok: false, reason: `NO CODE at ${entry.splitter}` };
  }

  const selector = selectorOf(signature).slice(2);
  if (!seen.code.toLowerCase().includes(selector.toLowerCase())) {
    return {
      name,
      ok: false,
      reason: `declared v${entry.version} but ${signature} (0x${selector}) is not in the deployed bytecode`,
    };
  }

  // Treasury, fee split and owner, as the contract reports them.
  const mismatches = [];
  for (const [field, actual] of Object.entries(seen.config)) {
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

  // Stablecoin allowlist. Mutable by the owner without touching bytecode, so a
  // stable runtime hash proves nothing about it.
  if (entry.version === '1.3') {
    if (!entry.stablecoins) {
      mismatches.push('no stablecoins block pinned — the allowlist is owner-mutable and must be recorded');
    } else {
      for (const [symbol, allowed] of Object.entries(seen.stablecoins)) {
        if (symbol === '$zero') {
          if (allowed) mismatches.push('the zero address is whitelisted');
        } else if (!allowed) {
          mismatches.push(`${symbol} ${entry.stablecoins[symbol]} is pinned as accepted but the contract says it is not`);
        }
      }
    }
  }
  if (mismatches.length) {
    return { name, ok: false, reason: mismatches.join('; ') };
  }

  // Governance. Everything pinned above is only as trustworthy as whoever can
  // change it, so the owner is read from the contract rather than inferred
  // from the deploy script that was supposed to set it.
  const governance = registry.governance;
  const ownedByGovernanceSafe = String(entry.owner ?? '').toLowerCase() === governance.safe.toLowerCase();

  if (entry.version === '1.3' && !ownedByGovernanceSafe) {
    return {
      name,
      ok: false,
      reason: `owner is ${entry.owner}, but every v1.3 route splitter must be owned by the governance Safe ${governance.safe}`,
    };
  }
  // Legacy v1.1/v1.2 splitters are owned by a deployer EOA. History, not a
  // settlement target: one key could re-point the treasury on those.
  if (!ownedByGovernanceSafe && entry.settlementEnabled === true) {
    return {
      name,
      ok: false,
      reason: `settlement is enabled but the owner ${entry.owner} is not the governance Safe — a single key could re-point this splitter`,
    };
  }

  if (ownedByGovernanceSafe) {
    if (!safeByChain.has(entry.chainId)) {
      const result = await withQuorum(entry, (url) => observeSafe(url, governance), 'governance Safe');
      safeByChain.set(
        entry.chainId,
        result.ok ? { problems: judgeSafe(result.observation, governance, entry.chain) } : { problems: [result.reason], unreachable: result.unreachable },
      );
    }
    const safe = safeByChain.get(entry.chainId);
    if (safe.problems.length) return { name, ok: false, unreachable: safe.unreachable, reason: safe.problems.join('; ') };
  }

  // A single-provider chain verifies but must not settle. Enforced here, not
  // just documented: the registry cannot mark such a route enabled.
  if (required < 2 && entry.settlementEnabled === true) {
    return {
      name,
      ok: false,
      reason: `settlement is enabled but only ${required} RPC provider is required — activation needs two independent providers`,
    };
  }

  const runtimeCodeHash = keccak256(getBytes(seen.code));
  if (!entry.runtimeCodeHash) {
    if (!PIN) {
      return { name, ok: false, reason: `runtimeCodeHash not pinned (chain says ${runtimeCodeHash}) — re-run with --pin` };
    }
    entry.runtimeCodeHash = runtimeCodeHash;
    return { name, ok: true, pinned: true, runtimeCodeHash, providers, required, bytes: (seen.code.length - 2) / 2 };
  }
  if (entry.runtimeCodeHash.toLowerCase() !== runtimeCodeHash.toLowerCase()) {
    return {
      name,
      ok: false,
      reason: `runtimeCodeHash mismatch — pinned ${entry.runtimeCodeHash}, chain says ${runtimeCodeHash}`,
    };
  }

  return { name, ok: true, runtimeCodeHash, providers, required, bytes: (seen.code.length - 2) / 2 };
}

// --------------------------------------------------------------------- run

const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));

// Without this block there is nothing to check ownership against, and every
// entry would pass on the strength of a field nobody compared to anything.
const g = registry.governance;
const governanceOwners = g?.owners;
const governanceComplete =
  g?.safe &&
  typeof g.threshold === 'number' &&
  Array.isArray(governanceOwners) &&
  governanceOwners.length > 0 &&
  g.singleton &&
  g.singletonCodeHash &&
  g.proxyCodeHash &&
  g.fallbackHandler &&
  g.fallbackHandlerCodeHash &&
  g.guard !== undefined &&
  Array.isArray(g.modules);
if (!governanceComplete) {
  console.error(
    'registry.json has no complete governance block. It must declare the Safe address, exact ' +
      'owner list, threshold, singleton and its code hash, proxy code hash, fallback handler and ' +
      'its code hash, guard, and modules — ownership is not verifiable without them.',
  );
  process.exit(1);
}

const results = [];

// Serial on purpose. Parallel workers get rate-limited by public RPCs, and a
// throttled response is indistinguishable from an empty one.
for (const [name, entry] of Object.entries(registry.splitters)) {
  process.stdout.write(`${name.padEnd(26)} `);
  const result = await verifyEntry(name, entry, registry);
  results.push(result);
  if (result.ok) {
    const quorumNote = result.required < 2 ? ` ⚠ single-provider (${result.providers.join(',')})` : ` ×${result.providers.length}`;
    console.log(
      `OK  v${entry.version} ${result.bytes}B ${result.runtimeCodeHash.slice(0, 18)}…${quorumNote}${result.pinned ? ' (pinned)' : ''}`,
    );
  } else {
    console.log(`FAIL  ${result.reason}`);
  }
}

const failed = results.filter((r) => !r.ok);
const unreachable = failed.filter((r) => r.unreachable);
const singleProvider = results.filter((r) => r.ok && r.required < 2);
const safesOk = [...safeByChain.values()].filter((r) => !r.problems.length).length;

console.log(`\n${results.length - failed.length}/${results.length} verified against chain state.`);
console.log(
  `Governance Safe ${g.safe} verified ${g.threshold}-of-${governanceOwners.length}, ` +
    `singleton ${g.singleton.slice(0, 10)}…, no guard, ${g.modules.length} module(s), on ${safesOk} chain(s).`,
);
if (singleProvider.length) {
  console.log(
    `\n⚠ ${singleProvider.length} entr${singleProvider.length === 1 ? 'y' : 'ies'} verified from a SINGLE provider ` +
      `(${[...new Set(singleProvider.map((r) => r.name.split(':')[0]))].join(', ')}). ` +
      'Accepted for verification, refused for activation: add a second independent endpoint first.',
  );
}

if (PIN && !failed.length) {
  registry.updatedAt = new Date().toISOString().slice(0, 10);
  writeFileSync(REGISTRY, `${JSON.stringify(registry, null, 2)}\n`);
  console.log('registry.json updated with pinned values.');
}

if (failed.length) {
  console.error('\nFailed:');
  for (const f of failed) console.error(`  ${f.name}: ${f.reason}`);
  if (unreachable.length) {
    console.error(
      `\n${unreachable.length} entr${unreachable.length === 1 ? 'y' : 'ies'} could not reach quorum. This is a FAILURE, not a skip —` +
        ' an unchecked chain cannot be released as verified.',
    );
  }
  process.exit(1);
}
