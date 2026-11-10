# Reactor website

Static page, no build step: `index.html`, `style.css`, `site.js` and the WebP screenshots in `img/`. The design system
(Geist and Geist Mono, one accent, 10px buttons and 16px panels, light or dark with the system) is the one of the
aFinder website. `.github/workflows/pages.yml` publishes this folder to GitHub Pages
(https://danielhromadka.github.io/aforge/) on every push to `main` that changes it.

```bash
python3 -m http.server 8765 -d website    # http://localhost:8765/
```

## Screenshots

Every image comes from the running app on a generated demo project (a bakery e-shop), so no real project, host or
person shows up. The screenshot script answers the agents' runs, their log and the running preview itself, so no
agent or container runs.

```bash
node website/scripts/demo-project.mjs /tmp/reactor-demo
AFORGE_AUTH=off AFORGE_DATA=/tmp/reactor-demo npm run dev
npm i --no-save playwright && npx playwright install chromium
node website/scripts/screenshots.cjs          # all images, or a name prefix: ide, trace
website/scripts/optimize.sh                   # raw PNGs → img/*.webp (needs cwebp)
```

Motion is limited to scroll reveals, the pinned IDE story and the mode picker, and switches off under
`prefers-reduced-motion`. Fonts (Fontsource) and icons (Phosphor) load from jsDelivr and unpkg at pinned versions.
