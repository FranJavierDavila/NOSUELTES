import type { NextConfig } from "next";

const isExport = process.env.STATIC_EXPORT === "1";
// Subruta del sitio publicado en GitHub Pages (…github.io/NOSUELTES/). Para un
// dominio propio servido en la raíz: EXPORT_BASE_PATH="" → sin prefijo.
const exportBase = process.env.EXPORT_BASE_PATH ?? "/NOSUELTES";

const nextConfig: NextConfig = {
  output: isExport ? "export" : "standalone",
  // T85 — la exportación estática publica con basePath de subruta: Next
  // prefija _next/páginas, y los assets que carga el motor por su cuenta pasan
  // por src/game/assetPath.ts vía NEXT_PUBLIC_ASSET_BASE. EXPORT_DIST_DIR da a
  // la prueba local un distDir APARTE (no invalida el .next del standalone que
  // sirven los previews); en CI, sin esa var, sale en out/ como siempre.
  ...(isExport
    ? {
        ...(process.env.EXPORT_DIST_DIR ? { distDir: process.env.EXPORT_DIST_DIR } : {}),
        basePath: exportBase || undefined,
        env: { NEXT_PUBLIC_ASSET_BASE: exportBase },
      }
    : {}),
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
