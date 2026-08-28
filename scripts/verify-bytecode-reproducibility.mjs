#!/usr/bin/env node
/**
 * Does the deployed bytecode come from the source in this repository?
 *
 * verify-registry.mjs pins runtimeCodeHash per route and re-reads it from the
 * chain every run, so deployed code cannot change without CI noticing. That is
 * the second half of a chain of custody. This is the first half, and until now
 * it was missing: the pin recorded "the bytecode that was there when we first
 * looked", which would hold equally well for bytecode nobody here ever
 * compiled. v1.3 audit P1.
 *
 * The comparison is not a plain hash. Two things legitimately differ between
 * `solc` output and a live contract, and exactly two:
 *
 *   immutables — written into the runtime code at construction. The artifact's
 *                immutableReferences gives their offsets, and both sides are
 *                zeroed there before comparing.
 *   metadata   — the trailing CBOR blob. In practice it matched byte for byte
 *                here, because the source and settings are the same ones that
 *                produced the deployment, so nothing is stripped. If it ever
 *                stops matching, that is a real difference worth looking at
 *                rather than something to mask away.
 *
 * WHAT MASKING COSTS, said plainly because it is not obvious:
 *
 * Zeroing the immutables blinds this check to the fee split. Both immutables
 * on the agent-x402 routes are already zero (treasuryBps 0, ipCreatorBps 0),
 * so a merchant-aifp1 splitter with its immutables masked is byte-identical to
 * an agent-x402 splitter. This gate therefore cannot tell the two routes
 * apart, and must never be read as confirming which one takes a fee.
 *
 * That is not a hole, because verify-registry.mjs reads treasuryBps() and
 * ipCreatorBps() from each contract and compares them to the registry. The two
 * checks are complementary and neither is sufficient alone: this one says the
 * code is ours, that one says the numbers inside it are the agreed ones.
 */
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { getAddress } from 'ethers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = join(ROOT, 'registry/registry.json');

/**
 * A route is checked when it says which source it should reproduce from, via
 * `reproducesFrom` in the registry. Nothing is inferred from the version
 * number, and that is deliberate.
 *
 * The legacy v1.2 routes do not reproduce from HEAD: contracts/B2BSplitter.sol
 * now compiles to 4952 bytes against 3151 deployed. That is the source moving
 * on after deployment, not evidence of tampering — but it means checking them
 * requires the commit they were built from, which nobody has recorded. Hard-
 * failing on it would paint CI red on every unrelated pull request until
 * someone did that archaeology, and a gate everyone learns to ignore protects
 * nothing.
 *
 * So they warn instead, with the byte counts, and the moment someone pins the
 * right commit they can add `reproducesFrom` and get a real check. v1.1
 * predates this repository's contract set entirely; there is no source here
 * that could reproduce it, and inventing a mapping would produce a confident
 * wrong answer.
 */

const problems = [];
const warnings = [];

function loadArtifact(relative) {
  const path = join(ROOT, 'artifacts', `${relative}.json`);
  if (!existsSync(path)) return null;
  const artifact = JSON.parse(readFileSync(path, 'utf8'));
  const raw = artifact.deployedBytecode;
  const object = typeof raw === 'string' ? raw : raw?.object;
  if (!object || object === '0x') return null;
  return { object, immutableReferences: artifact.immutableReferences ?? {} };
}

/** Zero every byte range the artifact marks as immutable. */
function maskImmutables(hex, immutableReferences) {
  const bytes = Buffer.from(hex.slice(2), 'hex');
  for (const spans of Object.values(immutableReferences)) {
    for (const { start, length } of spans) bytes.fill(0, start, start + length);
  }
  return bytes.toString('hex').toLowerCase();
}

async function rpcCall(url, method, params, attempt = 0) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(25_000),
  });
  if (res.status === 429 && attempt < 2) {
    await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    return rpcCall(url, method, params, attempt + 1);
  }
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  if (body.error) throw new Error(body.error.message ?? 'rpc error');
  return body.result;
}

/** Fail closed: an unreachable chain is unverified, and unverified is a failure. */
async function fetchCode(entry) {
  const failures = [];
  for (const url of entry.rpcs) {
    try {
      const served = Number(BigInt(await rpcCall(url, 'eth_chainId', [])));
      if (served !== entry.chainId) {
        failures.push(`${url}: serves chain ${served}`);
        continue;
      }
      const code = await rpcCall(url, 'eth_getCode', [getAddress(entry.splitter), 'latest']);
      if (code && code !== '0x') return code;
      failures.push(`${url}: no code at ${entry.splitter}`);
    } catch (error) {
      failures.push(`${url}: ${error.message}`);
    }
  }
  throw new Error(`no RPC could read the code — ${failures.join('; ')}`);
}

const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
const artifacts = new Map();
let checked = 0;

for (const [name, entry] of Object.entries(registry.splitters ?? {})) {
  const source = entry.reproducesFrom;
  if (!source) {
    warnings.push(
      `${name} (v${entry.version}): no "reproducesFrom" in the registry, so nothing here traces this bytecode to a source file. Unverified, not verified.`,
    );
    continue;
  }

  if (!artifacts.has(source)) artifacts.set(source, loadArtifact(source));
  const artifact = artifacts.get(source);
  if (!artifact) {
    problems.push(
      `${name}: no compiled artifact for ${source}. Run "hardhat compile --build-profile production" first — a missing artifact must not read as a passing check.`,
    );
    continue;
  }

  let onChain;
  try {
    onChain = await fetchCode(entry);
  } catch (error) {
    problems.push(`${name}: ${error.message}`);
    continue;
  }

  const localBytes = (artifact.object.length - 2) / 2;
  const chainBytes = (onChain.length - 2) / 2;
  if (localBytes !== chainBytes) {
    problems.push(
      `${name}: compiled ${localBytes} bytes, chain has ${chainBytes}. The source in this repository did not produce the deployed contract.`,
    );
    continue;
  }

  const local = maskImmutables(artifact.object, artifact.immutableReferences);
  const chain = maskImmutables(onChain, artifact.immutableReferences);
  if (local !== chain) {
    let at = -1;
    for (let i = 0; i < local.length; i += 2) {
      if (local.slice(i, i + 2) !== chain.slice(i, i + 2)) { at = i / 2; break; }
    }
    problems.push(
      `${name}: same length but differs from byte ${at}. Compiled from ${source}, deployed at ${entry.splitter}.`,
    );
    continue;
  }

  checked += 1;
  console.log(`  ok  ${name.padEnd(26)} v${entry.version}  ${chainBytes}B reproduced from ${source.split('/').pop()}`);
}

if (warnings.length) {
  console.warn(`\n⚠ ${warnings.length} route(s) not traceable to source in this repository:\n`);
  for (const w of warnings) console.warn(`  - ${w}`);
}

if (problems.length) {
  console.error(`\n✖ bytecode does not reproduce (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n`);
  for (const p of problems) console.error(`  - ${p}\n`);
  process.exit(1);
}

console.log(
  `\n✓ ${checked} route(s) reproduce from this repository's source, immutables masked.` +
    `\n  Fee values are NOT covered here — verify-registry.mjs reads treasuryBps()/ipCreatorBps() for that.`,
);
