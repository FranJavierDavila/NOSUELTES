// T60 SHERPAS NET — servicio de salas para juego remoto (mini servicio).
// El HOST corre la simulación; el GUEST envía su input y recibe snapshots.
// Este servicio NO conoce el juego: solo empareja sockets por código de sala
// y retransmite. Todo en memoria (una instancia del sandbox), con TTL.
//
// Gateway: el cliente SIEMPRE conecta con io('/?XTransformPort=3003') y
// path '/' — Caddy reenvía a este puerto (ver Caddyfile / skill fullstack).
import { createServer } from "http";
import { Server, type Socket } from "socket.io";

const PORT = 3003;

interface Room {
  code: string;
  host: Socket;
  guest: Socket | null;
  /** parámetros de la partida que el host envía al arrancar (GO); null = fin. */
  session: {
    wallSeed: number;
    seed: number;
    difficulty: string;
    lang: "es" | "en";
    resume: boolean;
    cpsYs: number[];
    wallFrontZ: number;
    wallWidthM: number;
  } | null;
  createdAt: number;
}

const rooms = new Map<string, Room>();

const ALFABETO = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // sin I/L/0/1 (dictado por voz)
const makeCode = (): string =>
  Array.from({ length: 4 }, () => ALFABETO[Math.floor(Math.random() * ALFABETO.length)]).join("");

/** TTL de sala: se limpia cuando host y guest están ambos desconectados. */
const roomAlive = (r: Room): boolean =>
  r.host.connected || (r.guest?.connected ?? false);

setInterval(() => {
  for (const [code, r] of rooms) {
    if (!roomAlive(r)) {
      try { r.guest?.emit("net:closed", { reason: "host-gone" }); } catch { /* ya muerto */ }
      rooms.delete(code);
    }
  }
}, 30_000).unref?.();

const httpServer = createServer((_req, res) => {
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ ok: true, service: "sherpas-net", rooms: rooms.size }));
});

const io = new Server(httpServer, {
  // DO NOT change the path: Caddy usa '/' para el forwarding (skill fullstack).
  path: "/",
  cors: { origin: "*", methods: ["GET", "POST"] },
  pingTimeout: 60_000,
  pingInterval: 25_000,
  maxHttpBufferSize: 2e6,
});

io.on("connection", (socket: Socket) => {
  // ---------- HOST: crear sala ----------
  socket.on("net:create", (_payload: unknown, ack?: (r: unknown) => void) => {
    // el host solo puede tener una sala activa: cerrar la previa
    for (const [code, r] of rooms) {
      if (r.host.id === socket.id) {
        try { r.guest?.emit("net:closed", { reason: "host-recreated" }); } catch { /* ya muerto */ }
        rooms.delete(code);
      }
    }
    let code = makeCode();
    for (let i = 0; i < 50 && rooms.has(code); i++) code = makeCode();
    const room: Room = { code, host: socket, guest: null, session: null, createdAt: Date.now() };
    rooms.set(code, room);
    socket.data.roomCode = code;
    socket.data.role = "host";
    ack?.({ ok: true, code });
  });

  // ---------- GUEST: unirse ----------
  socket.on("net:join", (payload: { code?: string }, ack?: (r: unknown) => void) => {
    const code = String(payload?.code ?? "").trim().toUpperCase();
    const room = rooms.get(code);
    if (!room || !room.host.connected) { ack?.({ ok: false, error: "sala-no-existe" }); return; }
    if (room.guest && room.guest.connected) { ack?.({ ok: false, error: "sala-llena" }); return; }
    room.guest = socket;
    socket.data.roomCode = code;
    socket.data.role = "guest";
    room.host.emit("net:guest-joined", {});
    ack?.({ ok: true, code });
  });

  // ---------- HOST → GUEST: parámetros de partida (al pulsar GO) ----------
  socket.on("net:session", (payload: Room["session"]) => {
    const room = rooms.get(String(socket.data.roomCode ?? ""));
    if (!room || socket.data.role !== "host") return;
    room.session = payload ?? null;
    room.guest?.emit("net:session", payload);
  });

  // ---------- HOST → GUEST: snapshots de simulación ----------
  socket.on("net:snapshot", (payload: unknown) => {
    const room = rooms.get(String(socket.data.roomCode ?? ""));
    if (!room || socket.data.role !== "host") return;
    if (room.guest?.connected) room.guest.emit("net:snapshot", payload);
  });

  // ---------- GUEST → HOST: input ----------
  socket.on("net:intent", (payload: unknown) => {
    const room = rooms.get(String(socket.data.roomCode ?? ""));
    if (!room || socket.data.role !== "guest") return;
    if (room.host.connected) room.host.emit("net:intent", payload);
  });

  // ---------- desconexión ----------
  socket.on("disconnect", () => {
    const code = String(socket.data.roomCode ?? "");
    const room = rooms.get(code);
    if (!room) return;
    if (socket.data.role === "guest" && room.guest?.id === socket.id) {
      room.guest = null;
      room.host.emit("net:guest-left", {});
    } else if (socket.data.role === "host") {
      room.guest?.emit("net:closed", { reason: "host-left" });
    }
  });
});

httpServer.on("error", (err: NodeJS.ErrnoException) => {
  if (err.code === "EADDRINUSE") {
    // ya hay una instancia viva (co-arranque desde `bun run dev`): salir callado
    console.log("[sherpas-net] :3003 ya está en servicio — no duplico instancia");
    process.exit(0);
  }
  throw err;
});

httpServer.listen(PORT, () => {
  console.log(`[sherpas-net] salas de juego remoto en :${PORT}`);
});

process.on("SIGTERM", () => { httpServer.close(() => process.exit(0)); });
process.on("SIGINT", () => { httpServer.close(() => process.exit(0)); });
