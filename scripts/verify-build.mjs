#!/usr/bin/env node
'use strict';

/**
 * Prove the reviewed source reproduces every deployed v1.3 runtime (§9.1).
 *
 * verify-registry.mjs proves that what is on chain has not changed since it
 * was pinned. That is a different claim from "the source we reviewed is what
 * is on chain", and only the second one lets a reviewer reason about the
 * contract from the code in front of them. This closes that gap:
 *
 *   1. contracts/ must be the exact tree that was reviewed — its git tree hash
 *      is pinned in registry.build.contractsTreeHash. Any change under
 *      contracts/, however small, fails here until re-reviewed and re-pinned.
 *   2. the compiler and settings that produced the artifact must be exactly
 *      the pinned ones — solc version, EVM target, optimizer, viaIR — read
 *      back from the build-info the compiler wrote, not from hardhat.config.
 *   3. each route's immutable profile (treasuryBps / ipCreatorBps) is written
 *      into the compiled runtime at the byte offsets the compiler reports in
 *      immutableReferences, the result is hashed, and the hash must equal the
 *      runtimeCodeHash pinned — and verified live — for that route.
 *
 * Step 3 is what makes the two-hash world explicit: one contract, one source,
 * two immutable profiles, eighteen deployments. Anything else on chain with a
 * different hash is not this source.
 *
 *   bun run hardhat compile --build-profile production
 *   node scripts/verify-build.mjs
 */

import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { keccak256 } from 'ethers';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = join(ROOT, 'registry/registry.json');

const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
const build = registry.build;
const failures = [];
const fail = (msg) => failures.push(msg);

if (!build?.contract || !build.solcVersion || !build.contractsTreeHash) {
  console.error('registry.json has no build block — nothing to reproduce against.');
  process.exit(1);
}

// 1. The source tree is the reviewed one.
const treeHash = execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD:contracts'], { encoding: 'utf8' }).trim();
if (treeHash !== build.contractsTreeHash) {
  fail(
    `contracts/ tree is ${treeHash}, reviewed tree was ${build.contractsTreeHash} — ` +
      'the source has changed since review; re-review it and re-pin contractsTreeHash',
  );
}
const dirty = execFileSync('git', ['-C', ROOT, 'status', '--porcelain', 'contracts/'], { encoding: 'utf8' }).trim();
if (dirty) fail('contracts/ has uncommitted changes — a working-tree edit is not a reviewed source');

// 2. The artifact came from the pinned toolchain.
const artifactPath = join(ROOT, `artifacts/contracts/${build.contract}.sol/${build.contract}.json`);
let artifact;
try {
  artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
} catch {
  console.error(`${artifactPath} not found. Run: bun run hardhat compile --build-profile production`);
  process.exit(1);
}
const buildInfo = JSON.parse(readFileSync(join(ROOT, `artifacts/build-info/${artifact.buildInfoId}.json`), 'utf8'));
const settings = buildInfo.input?.settings ?? {};
const solcVersion = String(buildInfo.solcVersion ?? '').replace(/^v/, '');
const check = (label, actual, expected) => {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    fail(`${label}: artifact was built with ${JSON.stringify(actual)}, pinned ${JSON.stringify(expected)}`);
  }
};
check('solc version', solcVersion, build.solcVersion);
check('EVM version', settings.evmVersion, build.evmVersion);
check('optimizer', { enabled: settings.optimizer?.enabled, runs: settings.optimizer?.runs }, build.optimizer);
check('viaIR', settings.viaIR === true, build.viaIR);

// 3. Each route's immutable profile reproduces its live runtime hash.
//
// Immutables occupy 32-byte slots in the runtime that the compiler leaves as
// zero and the constructor fills in; immutableReferences maps each immutable's
// AST id to those offsets. The ids are assigned in declaration order, and
// B2BSplitterV13 declares treasuryBps before ipCreatorBps.
const refs = artifact.immutableReferences ?? {};
const ids = Object.keys(refs).sort((a, b) => Number(a) - Number(b));
if (ids.length !== 2) fail(`expected 2 immutables (treasuryBps, ipCreatorBps), artifact reports ${ids.length}`);

function runtimeHashFor(treasuryBps, ipCreatorBps) {
  const code = Buffer.from(artifact.deployedBytecode.slice(2), 'hex');
  const values = { [ids[0]]: treasuryBps, [ids[1]]: ipCreatorBps };
  for (const [astId, positions] of Object.entries(refs)) {
    const wordHex = BigInt(values[astId]).toString(16).padStart(64, '0');
    for (const { start, length } of positions) {
      if (length !== 32) fail(`immutable ${astId} has a ${length}-byte slot; expected 32`);
      Buffer.from(wordHex, 'hex').copy(code, start);
    }
  }
  return keccak256(code);
}

const routes = Object.entries(registry.splitters).filter(([, e]) => e.version === '1.3');
const profiles = new Map();
for (const [name, entry] of routes) {
  const expected = runtimeHashFor(entry.treasuryBps, entry.ipCreatorBps);
  const key = `${entry.treasuryBps}/${entry.ipCreatorBps}`;
  profiles.set(key, expected);
  const status = expected.toLowerCase() === String(entry.runtimeCodeHash).toLowerCase() ? 'OK ' : 'FAIL';
  console.log(`${name.padEnd(26)} ${status} ${key.padEnd(5)} source→${expected.slice(0, 18)}… pinned ${String(entry.runtimeCodeHash).slice(0, 18)}…`);
  if (status !== 'OK ') {
    fail(`${name}: reviewed source with profile ${key} hashes to ${expected}, registry pins ${entry.runtimeCodeHash}`);
  }
}

console.log(
  `\n${routes.length - failures.filter((f) => f.includes('hashes to')).length}/${routes.length} runtime hashes reproduced ` +
    `from contracts/ @ ${treeHash.slice(0, 12)} with solc ${solcVersion} (${settings.evmVersion}, ` +
    `optimizer ${settings.optimizer?.runs}, viaIR ${settings.viaIR === true}).`,
);
console.log(`Immutable profiles: ${[...profiles].map(([k, h]) => `${k} → ${h.slice(0, 12)}…`).join('; ')}`);

if (failures.length) {
  console.error('\nFailed:');
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
