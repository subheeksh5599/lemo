const {ApiPromise,WsProvider}=require("@polkadot/api");
(async()=>{const api=await ApiPromise.create({provider:new WsProvider("wss://test-node-v3.portaldot.dev"),noInitWarn:true});
for(const a of process.argv.slice(2)){const x=await api.query.system.account(a);console.log(a,"free",Number(x.data.free.toBigInt())/1e14,"reserved",Number(x.data.reserved.toBigInt())/1e14)}process.exit(0)})();
