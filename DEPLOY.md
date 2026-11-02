# Despliegue del juego «SHERPAS AL LÍMITE» desde GitHub

El proyecto tiene dos partes:

- **La web del juego** (Next.js + Babylon.js): todo el juego en solitario y el
  cooperativo local (dos jugadores en el mismo teclado) es 100 % cliente, se
  sirve como web estática.
- **El servicio de salas** (`mini-services/sherpas-net`, socket.io en el puerto
  3003): SOLO hace falta para **juego remoto** (anfitrión/invitado por código
  de sala). Es un proceso de larga vida con memoria: no cabe en un alojamiento
  estático ni en funciones serverless.

Por tanto hay tres rutas de despliegue vía GitHub, según lo que necesites:

| | Un jugador + cooperativo local | Juego remoto (salas) | Dominio propio | Coste |
|---|---|---|---|---|
| **A. Vercel** | ✅ | ❌ | ✅ (CNAME) | gratis |
| **B. GitHub Pages** | ✅ | ❌ | ✅ (dominio raíz) | gratis |
| **C. VPS propio** | ✅ | ✅ | ✅ | el del servidor |

En las tres, el desencadenante es el mismo: `git push` → GitHub compila y
publica (o Vercel lo hace por ti).

---

## Opción A — Vercel (recomendada: cero cambios, dominio propio fácil)

1. Entra en [vercel.com](https://vercel.com) con tu cuenta de GitHub y pulsa
   **Add New… → Project**.
2. Importa el repositorio `FranJavierDavila/NOSUELTES`. Vercel detecta Next.js
   solo: no toques ajustes de build (comando `npm run build`, salida por
   defecto). **No actives** la opción de incluir el servicio de salas: no existe
   para Vercel.
3. Pulsa **Deploy**. Cada `git push` a `main` reproducirá el despliegue.
4. Dominio propio: **Settings → Domains → Add**, escribe tu dominio y crea en
   tu registrador el registro DNS que te indique (CNAME a
   `cname.vercel-dns.com`, o A a `76.76.21.21`). El certificado HTTPS es
   automático.

Limitación: al no existir el servicio de salas, el botón de partida remota no
conectará (el juego sigue funcionando en solitario y cooperativo local).

## Opción B — GitHub Pages (100 % GitHub, gratis)

El workflow `.github/workflows/deploy-pages.yml` (incluido más abajo y en el
repo) compila la **exportación estática** (`STATIC_EXPORT=1 npx next build` →
carpeta `out/`, probada y funcionando) y la publica en Pages en cada push a
`main`.

1. Añade el workflow a GitHub: en el repo, **Add file → Create new file**,
   ruta `.github/workflows/deploy-pages.yml`, y pega el contenido que se da al
   final de este documento (o activa en tu token el permiso `workflow` y haz
   push del fichero). 
2. **Settings → Pages → Build and deployment → Source: GitHub Actions**. Nada
   más: el push (o la pestaña Actions → «Despliegue a GitHub Pages» → Run
   workflow) publica la web en
   `https://franjavierdavila.github.io/NOSUELTES/`.
2. Dominio propio raíz (recomendado): **Settings → Pages → Custom domain**,
   escribe `juego.tudominio.com` y crea en tu registrador un registro CNAME de
   ese subdominio a `franjavierdavila.github.io`. Con el dominio en la RAÍZ el
   juego funciona tal cual (verificado: los modelos se cargan con rutas
   absolutas `/models/…`).

⚠️ **Si lo sirves en subruta** (`…github.io/NOSUELTES/`) faltan dos ajustes que
no vienen hechos: `basePath: "/NOSUELTES"` en `next.config.ts` y convertir las
rutas de modelos de absolutas (`/models/…`) a relativas. Con dominio propio en
raíz (paso 2) no hace falta tocar nada.

Limitaciones: sin salas (sin juego remoto) y sin HTTPS en dominios `.es` de
algún registrador — GitHub Pages sí emite certificado para dominios propios
habituales.

## Opción C — VPS propio (todo funciona, incluido el juego remoto)

1. En tu VPS (Ubuntu): instala Node 22 (`apt install nodejs npm` o nvm) y
   clona el repo.
2. `npm install && npm run build` (el build ya copia los estáticos al
   standalone) y arranca con `npm start` (levanta el servicio de salas en
   3003 y la web en 3000).
3. Pon delante un proxy (Caddy/Nginx) que reenvíe tu dominio → 3000 y
   `/?XTransformPort=3003` → 3003 (el cliente siempre conecta por la ruta raíz
   con ese parámetro; hay un Caddyfile de referencia en el repo si existiera).
4. Automatízalo con GitHub Actions: un workflow que, en cada push, haga el
   build y lo suba por SSH/rsync al VPS (guarda `SSH_HOST`, `SSH_USER`,
   `SSH_KEY` en **Settings → Secrets and variables → Actions** — nunca en el
   código).

---

## Qué eliges

- Solo quieres jugar tú (y el mismo ordenador para dos): **B** si lo quieres
  100 % GitHub gratis, **A** si prefieres la web más rápida y dominio propio
  sin tocar DNS de GitHub.
- Quieres jugar en remoto con alguien por código de sala: **C** (o A/B para la
  web y el servicio de salas aparte en una máquina pequeña siempre encendida).

## Comandos útiles

```bash
# build de producción standalone (con salas, para VPS/sandbox)
npm run build && npm start

# build de exportación estática (GitHub Pages / hosting compartido)
STATIC_EXPORT=1 npx next build   # salida en out/
```

## Apéndice — `.github/workflows/deploy-pages.yml` (contenido completo)

```yaml
name: Despliegue a GitHub Pages
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: STATIC_EXPORT=1 npx next build
      - uses: actions/upload-pages-artifact@v3
        with:
          path: out
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```
