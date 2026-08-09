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
  const networks = {};
  for (const [name, entry] of Object.entries(registry.splitters)) {
    if (!entry.runtimeCodeHash) {
      throw new Error(
        `${name} has no pinned runtimeCodeHash. Run verify-registry.mjs --pin first — ` +
          'an address without the code hash it was verified against is not a trusted target.',
      );
    }
    if (!entry.verified) {
      throw new Error(`${name} has never been verified against chain state.`);
    }
    networks[name] = {
      chainId: entry.chainId,
      version: entry.version,
      splitter: entry.splitter,
      runtimeCodeHash: entry.runtimeCodeHash,
      // Deployed is not the same as payable. Settlement stays off until the
      // route has a v1.3 contract and a clean paid E2E.
      settlementEnabled: entry.settlementEnabled === true,
      verifiedAt: entry.verified,
    };
  }
  return {
    $generated: [
      'DO NOT EDIT. Generated from registry/registry.json by',
      'scripts/generate-sdk-table.mjs. CI regenerates this and fails on any',
      'difference, so hand-edits are rejected rather than shipped.',
    ],
    schemaVersion: registry.schemaVersion,
    sourceUpdatedAt: registry.updatedAt,
    networks,
  };
}

const registry = JSON.parse(readFileSync(REGISTRY, 'utf8'));
const generated = `${JSON.stringify(build(registry), null, 2)}\n`;

if (!CHECK) {
  writeFileSync(OUTPUT, generated);
  const enabled = Object.entries(build(registry).networks).filter(([, n]) => n.settlementEnabled);
  console.log(`Wrote ${OUTPUT}`);
  console.log(`  ${Object.keys(registry.splitters).length} networks`);
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
  for (const [name, n] of Object.entries(build(registry).networks)) {
    console.error(`    ${name.padEnd(10)} v${n.version} ${n.splitter} ${n.runtimeCodeHash.slice(0, 18)}…`);
  }
  process.exit(1);
}

console.log('✓ Generated splitter table matches the canonical registry.');
