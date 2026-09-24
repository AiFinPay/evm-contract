#!/usr/bin/env node
/**
 * Governance documentation must match on-chain reality.
 *
 * The v1.3 security audit (P0 #3) found docs/TIMELOCK_IMPLEMENTATION.md
 * asserting that a 48-hour timelock protected every critical operation, while
 * on-chain all 18 v1.3 route splitters were owned directly by a 3-of-5 Safe
 * that could change treasury or whitelist immediately. The document was not
 * lying on purpose — it described a plan, and nobody re-read it after the plan
 * stalled. A reader had no way to tell the difference.
 *
 * A prose correction fixes today and rots again the moment the timelock is
 * actually deployed (or the ownership model changes again). So the docs now
 * carry a machine-readable marker:
 *
 *     <!-- governance-status: direct-safe -->   or   <!-- governance-status: timelock -->
 *
 * and this script holds that marker to the chain. It fails when the two
 * disagree in EITHER direction: docs promising a timelock that does not exist,
 * and docs still describing direct ownership after a timelock goes live. The
 * chain is the source of truth; the marker is a claim about it; CI is what
 * keeps a claim from outliving the fact.
 *
 * Fails closed. An unreachable RPC is a non-zero exit, never a skip — the same
 * rule verify-registry.mjs follows, and for the same reason: "we could not
 * check" must never read like "we checked and it was fine".
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { id, getAddress } from 'ethers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = join(ROOT, 'registry/registry.json');

/** Docs that make a claim about how the protocol is governed. */
const GOVERNANCE_DOCS = [
  'docs/TIMELOCK_IMPLEMENTATION.md',
  'docs/TIMELOCK_SETUP.md',
];

const MARKER = /<!--\s*governance-status:\s*(direct-safe|timelock)\s*-->/;
const VALID = ['direct-safe', 'timelock'];

const problems = [];
const warnings = [];
const fail = (msg) => problems.push(msg);

async function rpcCall(url, method, params) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) {
    const err = new Error(`${url}: ${body.error.message}`);
    // A revert is an ANSWER, not a transport failure: asking a Safe for
    // getMinDelay() reverts precisely because a Safe has no such function.
    // Treating it as "could not check" is how a working probe reports every
    // chain as unreachable and tells you nothing.
    err.isRevert = /revert/i.test(body.error.message ?? '');
    throw err;
  }
  return body.result;
}

/**
 * Is `address` an OpenZeppelin TimelockController rather than a plain Safe?
 *
 * `getMinDelay()` is the cheapest question that separates them: a Safe has no
 * such function and its fallback handler reverts, a TimelockController returns
 * its configured delay. We require a full 32-byte word back, so a fallback
 * handler that answers with empty calldata cannot be mistaken for a delay.
 */
async function readMinDelay(url, address) {
  let raw;
  try {
    raw = await rpcCall(url, 'eth_call', [
      { to: address, data: id('getMinDelay()').slice(0, 10) },
      'latest',
    ]);
  } catch (err) {
    if (err.isRevert) return null; // no such function → not a TimelockController
    throw err;
  }
  if (!raw || raw === '0x' || raw.length !== 66) return null;
  return BigInt(raw);
}

async function probeOwner({ chainId, owner, rpcs }) {
  const failures = [];
  for (const url of rpcs) {
    try {
      const served = Number(await rpcCall(url, 'eth_chainId', []));
      if (served !== chainId) {
        failures.push(`${url}: serves chain ${served}, expected ${chainId}`);
        continue;
      }
      const code = await rpcCall(url, 'eth_getCode', [owner, 'latest']);
      if (!code || code === '0x') {
        // An EOA owner is neither a Safe nor a timelock, and is a far worse
        // finding than a stale document. Say so plainly.
        return { kind: 'eoa', minDelay: null };
      }
      const minDelay = await readMinDelay(url, owner);
      return { kind: minDelay === null ? 'direct-safe' : 'timelock', minDelay };
    } catch (err) {
      failures.push(`${url}: ${err.message}`);
    }
  }
  throw new Error(
    `chain ${chainId}: could not read owner ${owner} from any RPC:\n    ${failures.join('\n    ')}`,
  );
}

// ---- 1. what the docs claim -------------------------------------------------

const claims = new Map();
for (const rel of GOVERNANCE_DOCS) {
  const path = join(ROOT, rel);
  if (!existsSync(path)) {
    fail(`${rel}: listed as a governance document but does not exist. Either restore it or drop it from GOVERNANCE_DOCS in ${relative(ROOT, fileURLToPath(import.meta.url))}.`);
    continue;
  }
  const match = MARKER.exec(readFileSync(path, 'utf8'));
  if (!match) {
    fail(`${rel}: no governance-status marker. Add one of ${VALID.map((v) => `<!-- governance-status: ${v} -->`).join(' or ')} near the top, matching what the chain actually does.`);
    continue;
  }
  claims.set(rel, match[1]);
}

const distinctClaims = new Set(claims.values());
if (distinctClaims.size > 1) {
  fail(
    `governance documents disagree with each other:\n    ` +
      [...claims].map(([d, c]) => `${d}: ${c}`).join('\n    '),
  );
}

// ---- 2. what the chain does -------------------------------------------------

const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
const entries = Object.entries(registry.splitters ?? {});
if (entries.length === 0) fail('registry/registry.json lists no splitters — nothing to verify against.');

/** One probe per distinct (chain, owner); the same Safe on two chains is two contracts. */
const targets = new Map();
for (const [key, entry] of entries) {
  if (!entry.owner || !entry.chainId || !Array.isArray(entry.rpcs) || entry.rpcs.length === 0) continue;
  const owner = getAddress(entry.owner);
  const id_ = `${entry.chainId}:${owner.toLowerCase()}`;
  if (!targets.has(id_)) targets.set(id_, { chainId: entry.chainId, owner, rpcs: entry.rpcs, routes: [] });
  targets.get(id_).routes.push(key);
}

const observed = new Map();
for (const target of targets.values()) {
  let result;
  try {
    result = await probeOwner(target);
  } catch (err) {
    fail(err.message);
    continue;
  }
  const where = `chain ${target.chainId} owner ${target.owner} (${target.routes.length} route${target.routes.length === 1 ? '' : 's'}: ${target.routes.slice(0, 3).join(', ')}${target.routes.length > 3 ? ', …' : ''})`;

  if (result.kind === 'eoa') {
    // Neither a Safe nor a timelock, so it can support no governance-status
    // claim and is left out of the consensus below. It is a real finding, but
    // a different one from "the docs say something untrue", and failing here
    // would block unrelated pull requests on a pre-existing condition. It is
    // tracked separately; this warning is loud so it cannot be forgotten.
    warnings.push(`${where} is an externally owned account — not a Safe and not a timelock. A single key controls it.`);
    continue;
  }
  if (result.kind === 'timelock' && result.minDelay === 0n) {
    fail(`${where} is a TimelockController with getMinDelay() = 0. A zero delay is not a delay; treat this as unprotected.`);
    continue;
  }
  observed.set(where, result);
  console.log(
    `  ${result.kind === 'timelock' ? `timelock, ${result.minDelay}s delay` : 'Safe, no timelock'}  ${where}`,
  );
}

// ---- 3. do they agree? ------------------------------------------------------

const observedKinds = new Set([...observed.values()].map((r) => r.kind));
const claimed = distinctClaims.size === 1 ? [...distinctClaims][0] : null;

if (claimed && observedKinds.size > 0) {
  if (observedKinds.size > 1) {
    fail(
      `ownership model is not uniform across chains — some owners are timelocks and some are not, so no single governance-status marker can be true:\n    ` +
        [...observed].map(([w, r]) => `${r.kind}: ${w}`).join('\n    '),
    );
  } else {
    const actual = [...observedKinds][0];
    if (actual !== claimed) {
      fail(
        `governance documents claim "${claimed}" but the chain says "${actual}".\n` +
          (claimed === 'timelock'
            ? '    The docs promise a delay that does not exist. This is audit finding EVM-HIGH-001 /\n    v1.3 P0 #3 — fix the docs, or deploy the timelock and transfer ownership.'
            : '    A timelock appears to be live. Update the governance-status markers and the prose\n    in the governance docs to describe it, then re-run.'),
      );
    }
  }
}

// ---- report -----------------------------------------------------------------

if (warnings.length > 0) {
  console.warn(`\n⚠ ${warnings.length} ownership warning${warnings.length === 1 ? '' : 's'} (not a governance-docs failure):\n`);
  for (const w of warnings) console.warn(`  - ${w}`);
}

if (problems.length > 0) {
  console.error(`\n✖ governance docs do not match the chain (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n`);
  for (const p of problems) console.error(`  - ${p}\n`);
  process.exit(1);
}

console.log(`\n✓ governance documents claim "${claimed}", and every owner on chain matches.`);
