# Architektura

```
apps/web (Vite + React 19)                 apps/server (Fastify, tsx)                    host / Docker
┌──────────────────────────────┐  /api    ┌──────────────────────────────┐
│ Finder shell: toolbar,       │ ───────▶ │ store.ts   project.json,     │
│ sidebar, statusbar           │          │            chat.json         │
│ stages/*  (7 fází)           │  SSE     │ workspace.ts git, soubory    │
│ AgentPanel (návrhy, konflikty)│ ◀─────── │ events.ts  build/preview/... │
│ studio.tsx  stav + autosave  │          │ agents.ts  ──────────────────┼─▶ Anthropic API  | claude -p --json-schema
└──────────────────────────────┘          │ build.ts   AFORGE_SPEC.md ───┼─▶ claude -p stream-json | codex exec --json
        ▲ postMessage                     │ preview.ts docker run ───────┼─▶ aforge-runtime (Ubuntu, Nginx :80)
        │                                 │            proxy + inspector │
  iframe náhledu ◀── proxy :random ───────┤ tests.ts   docker run ───────┼─▶ mcr.microsoft.com/playwright
                                          │ figma.ts   Figma REST        │
                                          └──────────────────────────────┘
packages/shared – doménový model + zod schémata (= JSON schéma odpovědi agenta) + applyOps
```

## Klíčová rozhodnutí

- **Jeden model projektu** (`Project` v `packages/shared`) sdílený všemi fázemi. Web ukládá celý model s 400ms debounce; server ho nikdy nemění „za zády“ bez události `project/changed` (build, testy, přijatý návrh).
- **Agent nemění projekt přímo.** Odpověď konzultanta je validovaná proti `AgentReplySchema` (zod → JSON Schema → `--json-schema` u Claude Code, resp. `output_config.format` u API). Změny jsou `ops` (`story.upsert`, `element.upsert`, `block.upsert`, `file.write`, …), které se aplikují až po přijetí (`applyOps` + zápis souborů + git commit).
- **Kontext** se skládá při každém dotazu (`context.ts`): celý model, seznam souborů, otevřené anotace, poslední testy, fokus uživatele (+ obsah otevřeného souboru) a posledních 12 zpráv.
- **Běhový kontrakt** generované aplikace (viz `build.ts`): `.aforge/start.sh` zkopíruje `/workspace` (ro) do `/app`, sestaví, spustí backend na :5000 a Nginx na :80 (`/` SPA, `/api/` proxy). Díky tomu je jedno, jestli je backend .NET, Node nebo Python.
- **Anotace jako v Lovable**: náhled jde přes vlastní proxy na náhodném portu, která do HTML vkládá `inspector.js`. Ten komunikuje s aForge jen přes `postMessage` (výběr prvku, změna route, zvýraznění anotace), takže nevyžaduje stejný origin.
- **Testy ↔ stories** přes `[US-x]` v názvu testu; prošlé testy posunou story do stavu *ověřeno*, padající ji vrátí na *implementováno*.
- **Procesy** se spouštějí s polem argumentů (`proc.ts`), nikdy přes shell řetězec; cesty z klienta jdou přes `safePath`.

## Roadmapa

1. Implementační agent uvnitř sandbox kontejneru (stejný `aforge-runtime` + připojený workspace), bez přístupu k hostiteli.
2. Nasazení: generování Bicep/Terraform + GitHub Actions / Azure DevOps pipeline pro zvolený hosting.
3. Více uživatelů (Entra ID), sdílené projekty, role (analytik, designér, vývojář, tester).
4. Vizuální regrese: screenshoty testů vs. wireframy, posouzení agentem s obrázky.
5. Obousměrná synchronizace s Figmou (plugin), komponentová knihovna firmy.
