// T60 (histórico): este fichero arrancaba el servicio de salas (socket.io
// :3003) como hijo del server vía eval("require") — pero el eval impide
// compilar el build de PRODUCCIÓN (Edge Runtime rechaza Dynamic Code
// Evaluation) y sin build de producción no hay server ligero para verificar
// el juego en caliente (el T83 lo necesita: next dev se comía 1,8 GB y el
// kernel lo mataba a mitad de partida). T83: register() es no-op; el servicio
// de salas lo arrancan los scripts de package.json (dev lo llevaba haciendo
// así desde siempre; start lo lleva ahora).
export async function register(): Promise<void> {
  // el juego local nunca dependió de esto: sin servicio de red sigue OK
}
