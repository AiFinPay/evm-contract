#!/usr/bin/env node
'use strict';

/**
 * Generate the SDK's splitter table from the canonical registry (§9.1).
 *
 * The registry is the single source of truth; this file is a derived artifact.
 * Hand-editing the output is the failure mode this exists to prevent — the
 * August audit found the SDK's addresses and a stale deployments.json
 * disagreeing, with no way to tell which was right. Now there is: the chain is,
 * verify-registry.mjs reads it, and this generates from what it verified.
 *
 *   node scripts/generate-sdk-table.mjs           write the table
 *   node scripts/generate-sdk-table.mjs --check   fail if the file has drifted
 *
 * `--check` is the CI gate. It regenerates in memory and compares, so editing
 * the generated file by hand turns CI red rather than silently changing where
 * the SDK sends money.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REGISTRY = join(ROOT, 'registry/registry.json');
const OUTPUT = join(ROOT, 'registry/generated/splitter-table.json');

const CHECK = process.argv.includes('--check');

function build(registry) {
  const routes = {};
  for (const [name, entry] of Object.entries(registry.splitters)) {
    // From v1.3 a chain carries one splitter per protocol route, so the key is
    // '<chain>:<route>' and both must be present. Selection by chain alone is
    // the failure this guards: the deployer used CREATE, so the same address
    // recurs on other chains for the other route, and an address on its own
    // does not tell you which economics apply.
    if (!entry.chain || !entry.route) {
      throw new Error(
        `${name} is missing chain/route. Every entry must name both — the SDK ` +
          'selects on chain AND route, and must never fall back between routes.',
      );
    }
    if (name !== `${entry.chain}:${entry.route}`) {
      throw new Error(`${name} does not match its own chain/route (${entry.chain}:${entry.route}).`);
    }
    if (!entry.runtimeCodeHash) {
      throw new Error(
        `${name} has no pinned runtimeCodeHash. Run verify-registry.mjs --pin first — ` +
          'an address without the code hash it was verified against is not a trusted target.',
      );
    }
    if (!entry.verified) {
      throw new Error(`${name} has never been verified against chain state.`);
    }
    for (const field of ['treasury', 'treasuryBps', 'ipCreatorBps', 'owner']) {
      if (entry[field] === undefined || entry[field] === null) {
        throw new Error(
          `${name} has no verified ${field}. Run verify-registry.mjs --pin — the ` +
            'treasury, fee split and owner decide where money goes and who can ' +
            'redirect it, and must come from the chain.',
        );
      }
    }
    if (entry.version === '1.3' && !entry.stablecoins) {
      throw new Error(`${name} has no pinned stablecoins block — the allowlist is owner-mutable and must be recorded.`);
    }
    routes[name] = {
      chain: entry.chain,
      route: entry.route,
      chainId: entry.chainId,
      version: entry.version,
      superseded: entry.superseded === true,
      splitter: entry.splitter,
      runtimeCodeHash: entry.runtimeCodeHash,
      owner: entry.owner,
      treasury: entry.treasury,
      treasuryBps: entry.treasuryBps,
      ipCreatorBps: entry.ipCreatorBps,
      // Owner-mutable, so pinned and verified live — a stable runtime hash
      // says nothing about it. null means "not accepted on this chain".
      stablecoins: entry.stablecoins ?? null,
      // How many independent RPC providers verified this entry. A route
      // verified from one provider cannot be enabled, whatever else is true.
      rpcQuorum: entry.rpcQuorum ?? 2,
      validFrom: entry.validFrom,
      validUntil: entry.validUntil,
      // Deployed is not the same as payable. Settlement stays off until the
      // route has a v1.3 contract and a clean paid E2E.
      settlementEnabled: entry.settlementEnabled === true,
      verifiedAt: entry.verified,
    };

    // Offline mirror of the on-chain check in verify-registry.mjs. That one
    // proves the chain agrees with the registry; this one stops a v1.3 route
    // reaching the SDK owned by anything other than the governance Safe, even
    // if the registry were edited and not re-verified.
    if (
      entry.version === '1.3' &&
      entry.owner.toLowerCase() !== registry.governance.safe.toLowerCase()
    ) {
      throw new Error(
        `${name} is v1.3 but its owner is ${entry.owner}, not the governance Safe ` +
          `${registry.governance.safe}.`,
      );
    }
  }
  return {
    $generated: [
      'DO NOT EDIT. Generated from registry/registry.json by',
      'scripts/generate-sdk-table.mjs. CI regenerates this and fails on any',
      'difference, so hand-edits are rejected rather than shipped.',
    ],
    schemaVersion: registry.schemaVersion,
    sourceUpdatedAt: registry.updatedAt,
    // Carried through so a consumer can check the owner it was handed against
    // the governance shape it was verified under, without a second table.
    governance: {
      safe: registry.governance.safe,
      threshold: registry.governance.threshold,
      owners: registry.governance.owners.map((o) => o.address),
      singleton: registry.governance.singleton,
      fallbackHandler: registry.governance.fallbackHandler,
      guard: registry.governance.guard,
      modules: registry.governance.modules,
    },
    // The reviewed source every runtime hash above reproduces from.
    build: {
      contract: registry.build.contract,
      solcVersion: registry.build.solcVersion,
      evmVersion: registry.build.evmVersion,
      contractsTreeHash: registry.build.contractsTreeHash,
    },
    routes,
  };
}

const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
const generated = `${JSON.stringify(build(registry), null, 2)}\n`;

if (!CHECK) {
  writeFileSync(OUTPUT, generated);
  const built = build(registry).routes;
  const enabled = Object.entries(built).filter(([, n]) => n.settlementEnabled);
  const live = Object.entries(built).filter(([, n]) => !n.superseded);
  console.log(`Wrote ${OUTPUT}`);
  console.log(`  ${Object.keys(built).length} routes (${live.length} current, ${Object.keys(built).length - live.length} superseded)`);
  console.log(`  ${enabled.length} with settlement enabled`);
  process.exit(0);
}

if (!existsSync(OUTPUT)) {
  console.error(`✗ ${OUTPUT} is missing. Run: node scripts/generate-sdk-table.mjs`);
  process.exit(1);
}

const onDisk = readFileSync(OUTPUT, 'utf8');
if (onDisk !== generated) {
  console.error('✗ The generated splitter table has drifted from the canonical registry.');
  console.error('  Either the table was hand-edited, or the registry changed and the');
  console.error('  table was not regenerated. Run: node scripts/generate-sdk-table.mjs');
  console.error('\n  Registry says:');
  for (const [name, n] of Object.entries(build(registry).routes)) {
    console.error(`    ${name.padEnd(26)} v${n.version} ${n.splitter} ${n.runtimeCodeHash.slice(0, 18)}…`);
  }
  process.exit(1);
}

console.log('✓ Generated splitter table matches the canonical registry.');
