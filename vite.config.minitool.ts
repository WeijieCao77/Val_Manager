/**
 * The 小红书 小工具 build: the same game, as an offline zip.
 *
 * The container is a WebView that loads `index.html` out of a zip with no
 * network behind it, and its CSP is stricter than a browser's. Three things
 * follow, and this file is where each one is dealt with:
 *
 *  1. No ES modules. `<script type="module">` is refused and a relative
 *     `import` has no directory server to resolve against, so the whole app
 *     ships as one classic IIFE script — hence `format: 'iife'` and
 *     `inlineDynamicImports`, which folds the lazy routes back in.
 *  2. No network. `net.ts` and `telemetry.ts` are aliased to versions that
 *     contain no `fetch` / `sendBeacon` at all, because the container's
 *     checklist is grepped against the shipped bundle and an unreachable
 *     banned call still counts as one.
 *  3. No clipboard, no external links, nothing to open in a new tab. Those
 *     sites read `__MINITOOL__`, which is a constant here so the branch is
 *     gone from the output rather than merely untaken.
 *
 * Build with:  npx vite build --config vite.config.minitool.ts
 * Package with: npx tsx scripts/pack_minitool.ts
 */
import { readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

const at = (p: string) => fileURLToPath(new URL(p, import.meta.url))

/**
 * What the container needs in the document that Vite will not put there.
 *
 * `viewport-fit=cover` plus the safe-area padding is what keeps the bottom bar
 * off an iPhone's home indicator; the touch rules are the ones the cross-platform
 * guide asks for. Inline `<style>` is allowed by the container CSP — inline
 * *script* is not, which is why the script tags are rewritten rather than added to.
 */
function minitoolHtml(): Plugin {
  const VIEWPORT =
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, ' +
    'maximum-scale=1.0, user-scalable=no, viewport-fit=cover" />'

  const STYLE = `<style>
  html { touch-action: manipulation; }
  body {
    -webkit-tap-highlight-color: transparent;
    -webkit-touch-callout: none;
    -webkit-user-select: none;
    user-select: none;
    overscroll-behavior-y: contain;
  }
  /* the account id is meant to be selected and copied by hand — there is no
     clipboard API in here, so this is the only way it leaves the screen
     other than a screenshot */
  input, textarea, .acct-id, .mono { -webkit-user-select: text; user-select: text; }
  /* home indicator / rounded corners: the container gives the simulator the
     custom properties and the phone the real env() values */
  .advance-bar { padding-bottom: var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px)); }
  .toast    { bottom: calc(20px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))); }
  .support-fab, .unlock { bottom: calc(16px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))); }
  .tut-card.side { bottom: calc(24px + var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))); }
  [class*="scroll"], .cm-body { -webkit-overflow-scrolling: touch; overscroll-behavior-y: contain; }
</style>`

  return {
    name: 'minitool-html',
    // post, so this runs after Vite has injected its own script and link tags
    transformIndexHtml: {
      order: 'post',
      handler(html) {
        let out = html
          .replace(/<meta name="viewport"[^>]*>/, VIEWPORT)
          // a classic script: no module type, and no crossorigin to ask a
          // non-existent origin about
          .replace(/\s+type="module"/g, '')
          .replace(/\s+crossorigin(?==|\s|>)/g, '')

        // A classic script is not deferred the way a module is, so left in
        // <head> it runs before #root exists and the app mounts into nothing.
        // The container's own template puts it last in <body>; so do we.
        const script = out.match(/\s*<script src="[^"]+"><\/script>/)
        if (!script) throw new Error('minitool: no entry script found in index.html')
        out = out.replace(script[0], '')
          .replace('</body>', `  <script src="./${FACES_JS}"></script>\n    ${script[0].trim()}\n  </body>`)

        return out.replace('</head>', `  ${STYLE}\n  </head>`)
      },
    },
  }
}

/**
 * Swap a module for its offline twin, by where it resolves to rather than by
 * how it was spelled.
 *
 * A `resolve.alias` matches the import specifier, so `./engine/telemetry` from
 * main.tsx and `../engine/telemetry` from a component are two different
 * patterns and it is one forgotten spelling between a clean build and a
 * bundle that still carries the network layer. Resolving first and comparing
 * the file makes the spelling irrelevant.
 */
function offlineModules(swaps: Record<string, string>): Plugin {
  const resolved = Object.entries(swaps).map(([from, to]) => [at(from), at(to)] as const)
  return {
    name: 'minitool-offline-modules',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      const r = await this.resolve(source, importer, { ...options, skipSelf: true })
      if (!r) return null
      const hit = resolved.find(([from]) => from === r.id)
      return hit ? hit[1] : null
    },
  }
}

/** Where the portrait table lands, and what defines it. */
const FACES_JS = 'assets/faces.js'

/**
 * Ship public/faces as one lookup table rather than 539 files.
 *
 * The container caps a package at 200 files. The portraits alone are 539, and
 * cutting them is not on the table — every player in this game is a real
 * person and the photograph is the point. They are all <img src> and the
 * container allows data: for images, so the directory becomes a table of
 * data: URIs that faceUrl() reads.
 *
 * This costs the zip nothing: base64 inflates by a third, and deflate takes
 * essentially all of it back — one stream over the whole set compresses
 * slightly better than 539 separately stored entries did (4.26 MB vs 4.29 MB
 * measured). What it buys is 539 files becoming one.
 *
 * A classic script assigning a global, not a JSON import: the bundle is an
 * IIFE with no module loader, and the table has to be there before the first
 * render asks for a face.
 */
function embedFaces(): Plugin {
  return {
    name: 'minitool-embed-faces',
    // after the public dir has been copied, so removing it sticks
    closeBundle() {
      const src = at('./public/faces')
      const outDir = at('./dist-minitool')
      const files = readdirSync(src).filter((f) => f.endsWith('.webp')).sort()
      const rows = files.map((f) => {
        const b64 = readFileSync(join(src, f)).toString('base64')
        return `${JSON.stringify(f)}:"data:image/webp;base64,${b64}"`
      })
      mkdirSync(join(outDir, 'assets'), { recursive: true })
      writeFileSync(join(outDir, FACES_JS), `window.__VM_FACES={${rows.join(',')}};\n`)
      rmSync(join(outDir, 'faces'), { recursive: true, force: true })
      this.info(`${files.length} portraits inlined into ${FACES_JS}`)
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    offlineModules({
      './src/engine/net.ts': './src/engine/net.offline.ts',
      './src/engine/telemetry.ts': './src/engine/telemetry.offline.ts',
    }),
    minitoolHtml(),
    embedFaces(),
  ],
  base: './',
  define: { __MINITOOL__: 'true' },
  build: {
    outDir: 'dist-minitool',
    emptyOutDir: true,
    sourcemap: false,
    // otherwise Vite folds the stylesheet into the bundle as a string and
    // injects it at runtime, which paints once unstyled on a cold start
    cssCodeSplit: false,
    // .map files are not an allowed type inside the zip, and a preload link
    // would emit a modulepreload the container cannot honour
    modulePreload: false,
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      output: {
        format: 'iife',
        // IIFE cannot code-split; the lazy routes and records.json fold in
        inlineDynamicImports: true,
        entryFileNames: 'assets/app.js',
        chunkFileNames: 'assets/[name].js',
        assetFileNames: 'assets/[name][extname]',
      },
    },
  },
})
