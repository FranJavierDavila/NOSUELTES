/**
 * T85 DESPLIEGUE — prefijo de assets según dónde se sirve el juego.
 *
 * En GitHub Pages la web vive en una SUBRUTA (…/NOSUELTES/): las páginas y los
 * estáticos de Next (_next) los resuelve `basePath` en next.config.ts, pero
 * todo lo que el motor carga por su cuenta (JSON de /content, GLB, texturas,
 * audio, emotes) usa rutas ABSOLUTAS que apuntarían a la raíz del dominio y
 * darían 404. El prefijo se INLINa en el build (env de next.config):
 *  - dev / standalone: sin valor → identidad (comportamiento de siempre)
 *  - export en subruta: "/NOSUELTES"
 *  - export en dominio raíz: ""
 */
const BASE = process.env.NEXT_PUBLIC_ASSET_BASE ?? "";

export function assetUrl(path: string): string {
  if (!path || !path.startsWith("/")) return path; // relativas: sin cambio
  if (path.startsWith("//")) return path; // URL protocol-relative externa
  if (!BASE) return path; // despliegue en raíz: rutas absolutas tal cual
  if (path === BASE || path.startsWith(`${BASE}/`)) return path; // ya prefijada
  return `${BASE}${path}`;
}
