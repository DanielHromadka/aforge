# CLAUDE.md

aForge is a browser-based low-code AI studio (Czech UI, macOS Finder look): wireframes + user stories → blocks → Claude Code / Codex implementation → isolated container preview with Lovable-style annotations → Playwright tests, with a consultant agent in every stage. README.md (Czech) is the feature reference, docs/ARCHITECTURE.md the design.

## Commands

```bash
npm run dev            # server (tsx watch, :4310) + web (vite, :5310, proxies /api)
npm run typecheck      # tsc for packages/shared, apps/server, apps/web – the main gate
npm test               # vitest
npm run runtime:build  # docker image aforge-runtime used by preview
```

## Layout

- `packages/shared/src/index.ts` – the domain model and the zod schemas of the agent contract (`AgentReplySchema`, `OpSchema`), plus `applyOps`. A new op needs: the schema entry, a case in `applyOps`, a label in `describeOp` (web `components/AgentPanel.tsx`) and, for file ops, handling in the accept route (server `index.ts`).
- `apps/server/src` – Fastify routes in `index.ts`; `agents.ts` (consultant via API or `claude -p --json-schema`, implementation via `claude -p stream-json` / `codex exec --json`), `context.ts` (system prompt, context, canned intents), `build.ts` (spec + runtime contract), `preview.ts` (docker + injecting proxy), `inspector.ts`, `tests.ts`, `figma.ts`, `workspace.ts` (safePath, git), `store.ts`, `events.ts` (SSE bus).
- `apps/web/src` – `App.tsx` (window shell), `studio.tsx` (state, autosave, SSE), `stages/*`, `components/*`, `styles.css` (Finder tokens; light/dark via `prefers-color-scheme`).

## Conventions

- UI strings in Czech, written inline. Colours only through the CSS variables in `styles.css`.
- Spawn processes with argument arrays (`proc.ts`), never shell strings. Client paths go through `safePath`.
- The agent never edits the project directly – it returns proposals the user accepts.
- Default model `claude-opus-5-5` with adaptive thinking and server-side fallback (`fallbacks: 'default'`).
- Compact code, short comments explaining *why*.
