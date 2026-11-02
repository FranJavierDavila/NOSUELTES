// Prueba de conectividad de señalización Trystero/Nostr desde el sandbox:
// dos peers se unen a la misma sala y se intercambian un mensaje.
// Ejecutar con Node >= 22 (WebSocket global).
import { joinRoom, selfId } from "trystero/nostr";

const ROOM = "PROBA";
const APP = "nosueltes-probe-v1";
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);

const peerA = joinRoom({ appId: APP }, ROOM);
peerA.onPeerJoin = (id) => { log("A ve a", id); void sendA("hola-de-A", { target: id }); };
const actA = peerA.makeAction("probe");
actA.onMessage = (data, ctx) => {
  log("A recibe", data, "de", ctx.peerId);
  console.log("RESULTADO: OK");
  void Promise.all([peerA.leave(), peerB.leave()]).finally(() => process.exit(0));
};

const peerB = joinRoom({ appId: APP }, ROOM);
peerB.onPeerJoin = (id) => { log("B ve a", id); void sendB("hola-de-B", { target: id }); };
const actB = peerB.makeAction("probe");
actB.onMessage = (data, ctx) => log("B recibe", data, "de", ctx.peerId);

const [sendA] = [actA.send];
const [sendB] = [actB.send];

log("selfId:", selfId, "— esperando señalización (30 s máx)...");
setTimeout(() => { console.log("RESULTADO: TIMEOUT — sin peers"); void Promise.all([peerA.leave(), peerB.leave()]).finally(() => process.exit(1)); }, 30000);
