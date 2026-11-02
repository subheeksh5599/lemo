// Compiles the contracts with solc and writes deterministic artifacts for the deploy step.

import { readFile, readdir, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const solc = require("solc");

const sourceDir = new URL("../src/", import.meta.url).pathname;
const artifactDir = new URL("../artifacts/", import.meta.url).pathname;

const files = (await readdir(sourceDir)).filter((name) => name.endsWith(".sol"));
const sources = {};

for (const name of files) {
  sources[name] = { content: await readFile(join(sourceDir, name), "utf8") };
}

const input = {
  language: "Solidity",
  sources,
  settings: {
    optimizer: { enabled: true, runs: 200 },
    outputSelection: { "*": { "*": ["abi", "evm.bytecode.object", "evm.deployedBytecode.object"] } },
  },
};

const output = JSON.parse(solc.compile(JSON.stringify(input)));

const diagnostics = output.errors ?? [];
const failures = diagnostics.filter((entry) => entry.severity === "error");
for (const entry of diagnostics) console.log(`${entry.severity}: ${entry.formattedMessage.trim()}`);
if (failures.length > 0) process.exit(1);

await mkdir(artifactDir, { recursive: true });

for (const [file, contracts] of Object.entries(output.contracts ?? {})) {
  for (const [name, contract] of Object.entries(contracts)) {
    const artifact = {
      contractName: name,
      source: file,
      compiler: solc.version(),
      abi: contract.abi,
      bytecode: `0x${contract.evm.bytecode.object}`,
    };
    await writeFile(join(artifactDir, `${name}.json`), JSON.stringify(artifact, null, 2));
    console.log(`artifact: ${name}.json (${contract.evm.bytecode.object.length / 2} bytes)`);
  }
}
