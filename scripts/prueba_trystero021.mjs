// Prueba clásica 0.21.x: makeAction devuelve [send, get, onProgress].
import { joinRoom, selfId } from "trystero/nostr";
const APP = "nosueltes-probe-v1";
const ROOM = "PROBA";
const log = (...a) => console.log(new Date().toISOString().slice(11, 23), ...a);
let done = false;
const fin = (code, why) => { if (done) return; done = true; console.log("RESULTADO:", why); process.exit(code); };

const peerA = joinRoom({ appId: APP }, ROOM);
const [sendA, getA] = peerA.makeAction("probe");
peerA.onPeerJoin((id) => { log("A ve a", id); sendA("hola-de-A", id); });
getA((data, id) => { log("A recibe", data, "de", id); fin(0, "OK"); });

const peerB = joinRoom({ appId: APP }, ROOM);
const [sendB, getB] = peerB.makeAction("probe");
peerB.onPeerJoin((id) => { log("B ve a", id); sendB("hola-de-B", id); });
getB((data, id) => log("B recibe", data, "de", id));

log("selfId:", selfId, "(30 s máx)");
setTimeout(() => fin(1, "TIMEOUT"), 30000);
