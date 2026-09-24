// Shared Prettier runner for Solidity formatting.
//
// Both `prettify` and `prettify:check` need to invoke the real Node.js binary
// (Bun's node wrapper is incompatible with Prettier's worker threads) and run
// `prettier` with the same plugin and glob. This helper removes the duplication.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const PRETTIER_BIN = path.resolve("node_modules/.bin/prettier");
const PRETTIER_PLUGIN = "prettier-plugin-solidity";
const PRETTIER_GLOBS = [
  "contracts/**/*.sol",
  "foundry-tests/**/*.sol",
  "scripts/**/*.ts",
  "test/**/*.ts",
  "config/**/*.ts",
  "hardhat.config.ts",
];

/**
 * Locate a real Node.js binary, avoiding Bun's node wrapper.
 */
export function findRealNode(): string | null {
  const candidates = [
    "/usr/bin/node",
    "/usr/local/bin/node",
    "/opt/homebrew/bin/node",
    "/opt/local/bin/node",
    path.join(homedir(), ".local/bin/node"),
    path.join(homedir(), ".local/share/fnm/node-versions/current/installation/bin/node"),
    path.join(homedir(), ".nvm/versions/node/current/bin/node"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  // Fall back to `which node`, but reject Bun's wrapper.
  const which = spawnSync("which", ["node"], { encoding: "utf-8", shell: false });
  if (which.status === 0) {
    const nodePath = which.stdout.trim().split("\n")[0];
    if (nodePath && !nodePath.includes("bun")) {
      return nodePath;
    }
  }

  return null;
}

export type PrettierMode = "check" | "write";

/**
 * Run Prettier on the project's Solidity and TypeScript files with the
 * configured plugin. Exits the process with Prettier's status code, or 1 if
 * no real Node binary can be found.
 */
export function runPrettier(mode: PrettierMode): never {
  const nodeBin = process.env.NODE_BIN || findRealNode();

  if (!nodeBin) {
    console.error(
      "Error: could not find a real Node.js binary.\n" +
        "Bun's node wrapper is not compatible with Prettier's worker threads.\n" +
        "Please install Node.js (v22+) and set NODE_BIN=/path/to/node, " +
        "or add it to a standard location like /usr/bin/node or /usr/local/bin/node.",
    );
    process.exit(1);
  }

  const flag = mode === "check" ? "--check" : "--write";
  const result = spawnSync(
    nodeBin,
    [PRETTIER_BIN, flag, `--plugin=${PRETTIER_PLUGIN}`, ...PRETTIER_GLOBS],
    {
      stdio: "inherit",
      env: { ...process.env, PRETTIER_WORKER_TIMEOUT: "0" },
      shell: false,
    },
  );

  process.exit(result.status ?? 1);
}
