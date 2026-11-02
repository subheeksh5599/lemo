// Exercises the full backend surface against a running server: register, proof,
// both rule checks, revision acceptance with gossip, metrics and the OpenAPI doc.

const base = process.env.BASE ?? "http://127.0.0.1:8792";
const chainRpc = process.env.CHAIN ?? "https://test-node-v3.portaldot.dev";

async function rpc(url, method, params = []) {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error(`http ${response.status}`);
      const body = await response.json();
      if (body.error) throw new Error(body.error.message);
      return body.result;
    } catch (cause) {
      if (attempt === 5) throw cause;
      await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
    }
  }
}

const json = async (path, init) => {
  const response = await fetch(`${base}${path}`, init);
  const body = await response.json();
  return { status: response.status, body };
};

const post = (path, payload) =>
  json(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });

const head = await rpc(chainRpc, "chain_getFinalizedHead");
const header = await rpc(chainRpc, "chain_getHeader", [head]);
console.log("chain head:", parseInt(header.number, 16));

const health = await json("/health");
console.log("health:", health.status, "| evm:", JSON.stringify(health.body.evm), "| statements:", health.body.statements.available);

const accounts = await rpc(chainRpc, "state_getKeysPaged", ["0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9", 1, null, head]);
const account = "0x" + accounts[0].slice(2 + 64 + 32);
const titleId = "0x" + "ee".repeat(32);
const contract = "0x884fe7b4df96d257c23c2db2077a511c4db2abf7";

const registered = await post("/titles", {
  titleId,
  label: "lifecycle-witness",
  evm: { contract, standard: "erc20" },
  fields: [
    { label: "revision", pallet: "System", item: "Number", hasher: "identity", args: [], decode: "u32" },
    { label: "owner", pallet: "System", item: "Account", hasher: "blake2_128_concat", args: [{ type: "account32", value: account }], decode: "bytes" },
    { label: "backing", pallet: "System", item: "Number", hasher: "identity", args: [], decode: "u32" },
  ],
});
console.log("register:", registered.status, registered.body.titleId ?? registered.body.error?.code);

const proof = await json(`/titles/${titleId}/proof`);
console.log("proof:", proof.status, "block", registered.body?.package?.block?.number ?? "-", "| report valid:", JSON.stringify(proof.body.report?.valid), "| revision:", proof.body.revision);

const transfer = await json(`/titles/${titleId}/transfer-check`);
console.log("transfer-check:", transfer.status, "allowed:", transfer.body.verdict?.allowed);
for (const check of transfer.body.verdict?.checks ?? []) console.log(`   ${check.ok ? "ok  " : "FAIL"} ${check.name}: ${check.detail}`);

const unbond = await fetch(`${base}/titles/${titleId}/unbond-check`).then(async (response) => ({
  status: response.status,
  body: await response.json(),
}));
console.log("unbond-check:", unbond.status, "allowed:", unbond.verdict ?? unbond.body.verdict?.allowed);
console.log("representation:", JSON.stringify(unbond.body.representation));
for (const check of unbond.body.verdict?.checks ?? []) {
  if (!check.ok) console.log(`   refused: ${check.name} — ${check.detail}`);
}

const accepted = await post(`/titles/${titleId}/revisions`, {});
console.log("accept revision:", accepted.status, JSON.stringify(accepted.body.revision), "| announcement:", JSON.stringify(accepted.body.announcement));

const repeated = await post(`/titles/${titleId}/revisions`, {});
console.log("accept again:", repeated.status, repeated.body.revision?.status ?? repeated.body.error?.code);

const history = await json(`/titles/${titleId}/revisions`);
console.log("history:", history.status, "entries:", history.body.revisions?.length);

const metrics = await fetch(`${base}/metrics`).then((response) => response.text());
console.log("metrics lines:", metrics.split("\n").filter((line) => line.startsWith("lemo_")).length);

const spec = await json("/openapi.json");
console.log("openapi:", spec.status, "paths:", Object.keys(spec.body.paths ?? {}).length);

const missing = await json(`/titles/${"0x" + "00".repeat(32)}/proof`);
console.log("unknown title:", missing.status, missing.body.error?.code);

