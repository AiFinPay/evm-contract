#!/usr/bin/env node
'use strict';

/**
 * Verify registry/registry.json against live chain state (§9.1).
 *
 * Chain state is the source of truth. This reads the deployed bytecode at each
 * registered address and checks three things: that there is code there at all,
 * that the payment entrypoint the registry claims is actually present in it,
 * and that its keccak-256 matches the pinned runtimeCodeHash. An address on its
 * own says nothing about what is deployed at it — that is the gap this closes.
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
import { keccak256, id, getBytes } from 'ethers';

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
  '1.3': 'payNative(bytes32,address,uint256,address,string)',
};

const selectorOf = (signature) => id(signature).slice(0, 10);

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
      return { code, rpc: url };
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

  const { code, rpc, failures } = await fetchCode(entry);
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
const results = [];

// Serial on purpose. Parallel workers get rate-limited by public RPCs, and a
// throttled response is indistinguishable from an empty one.
for (const [name, entry] of Object.entries(registry.splitters)) {
  process.stdout.write(`${name.padEnd(10)} `);
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
