import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

function findRealNode(): string | null {
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

    const which = spawnSync("which", ["node"], { encoding: "utf-8", shell: false });
    if (which.status === 0) {
        const nodePath = which.stdout.trim().split("\n")[0];
        if (nodePath && !nodePath.includes("bun")) {
            return nodePath;
        }
    }

    return null;
}

const nodeBin = process.env.NODE_BIN || findRealNode();
const prettierBin = path.resolve("node_modules/.bin/prettier");

if (!nodeBin) {
    console.error(
        "Error: could not find a real Node.js binary.\n" +
            "Bun's node wrapper is not compatible with Prettier's worker threads.\n" +
            "Please install Node.js (v22+) and set NODE_BIN=/path/to/node, " +
            "or add it to a standard location like /usr/bin/node or /usr/local/bin/node."
    );
    process.exit(1);
}

const result = spawnSync(
    nodeBin,
    [prettierBin, "--write", "--plugin=prettier-plugin-solidity", "contracts/**/*.sol"],
    {
        stdio: "inherit",
        env: { ...process.env, PRETTIER_WORKER_TIMEOUT: "0" },
        shell: false,
    }
);

process.exit(result.status ?? 1);
