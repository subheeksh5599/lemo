// Manual smoke run against a running server, using a real account key from the chain.
const rpc = async (url, method, params) => {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  return (await response.json()).result;
};

const chain = "https://live-v3-node.portaldot.dev";
const prefix = "0x26aa394eea5630e07c48ae0c9558cef7b99d880ec681799c0cf30e8886371da9";
const [key] = await rpc(chain, "state_getKeysPaged", [prefix, 1, null]);
const account = "0x" + key.slice(2 + 64 + 32);

const base = process.env.BASE ?? "http://127.0.0.1:8791";
const titleId = "0x" + "ab".repeat(32);

const binding = {
  titleId,
  label: "portaldot-finality-witness",
  fields: [
    { label: "revision", pallet: "System", item: "Number", hasher: "identity", args: [], decode: "u32" },
    { label: "owner", pallet: "System", item: "Account", hasher: "blake2_128_concat", args: [{ type: "account32", value: account }], decode: "bytes" },
  ],
};

const register = await fetch(`${base}/titles`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(binding),
});
console.log("register:", register.status, (await register.text()).slice(0, 160));

const proof = await fetch(`${base}/titles/${titleId}/proof`);
const body = await proof.json();
console.log("proof:", proof.status);
console.log("  block:", body.package?.block?.number, "identical root:", body.report?.checks?.map((c) => `${c.name}=${c.ok}`).join(","));
console.log("  revision:", body.revision, "readings:", JSON.stringify(body.readings?.map((r) => [r.label, r.status, r.decoded])));

const verify = await fetch(`${base}/proofs/verify`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ package: body.package }),
});
console.log("verify:", verify.status, JSON.stringify((await verify.json()).valid));

const consumeBody = { digest: body.package.digest, titleId, operation: "redeem" };
const first = await fetch(`${base}/proofs/consume`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(consumeBody) });
console.log("consume #1:", first.status, await first.text());
const second = await fetch(`${base}/proofs/consume`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(consumeBody) });
console.log("consume #2:", second.status, await second.text());

const tampered = { ...body.package, block: { ...body.package.block, stateRoot: "0x" + "11".repeat(32) } };
const tamperCheck = await fetch(`${base}/proofs/verify`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ package: tampered }) });
const tamperReport = await tamperCheck.json();
console.log("tampered verify:", tamperCheck.status, "valid:", tamperReport.valid, tamperReport.checks?.[0]?.detail);
