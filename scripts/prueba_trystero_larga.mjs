// Diagnóstico extendido: 2 peers nostr 60 s con estado de relays a mitad.
import { joinRoom, selfId, getRelaySockets } from "trystero/nostr";

const ROOM = "PROBA";
const APP = "nosueltes-probe-v1";
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

let done = false;
const fin = (code, why) => { if (done) return; done = true; console.log("RESULTADO:", why); process.exit(code); };

const peerA = joinRoom({ appId: APP }, ROOM);
peerA.onPeerJoin = (id) => { log("A ve a", id); void actA.send("hola-de-A", { target: id }); };
const actA = peerA.makeAction("probe");
actA.onMessage = (data, ctx) => { log("A recibe", data, "de", ctx.peerId); fin(0, "OK"); };

const peerB = joinRoom({ appId: APP }, ROOM);
peerB.onPeerJoin = (id) => { log("B ve a", id); void actB.send("hola-de-B", { target: id }); };
const actB = peerA.makeAction("probe2");
actB.onMessage = (data, ctx) => log("B recibe", data, "de", ctx.peerId);

log("selfId:", selfId);
setTimeout(() => log("relays a los 20 s:", Object.values(getRelaySockets()).map(w => w.readyState).join(",")), 20000);
setTimeout(() => fin(1, "TIMEOUT-60s"), 60000);
