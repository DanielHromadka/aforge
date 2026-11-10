# CLAUDE.md

Reactor is a browser-based low-code AI studio (Czech UI, clean macOS Finder look): Figma design → epics and stories (Jira-like keys) → breakdown into FE / BE / test tasks per repository and an API contract → a team of agents (one per repository, in parallel) implements them for review → container preview with annotations (they become bugs) → Playwright tests (failures become bugs) → a wiki for people. Web, mobile, desktop, backend or library repositories. The approved UI direction is docs/ui-redesign.html. README.md (Czech) is the feature reference, docs/ARCHITECTURE.md the design.

## Commands

```bash
npm run dev            # server (tsx watch, :4310) + web (vite, :5310, proxies /api)
npm run typecheck      # tsc for packages/shared, apps/server, apps/web – the main gate
npm test               # vitest
npm run runtime:build  # docker image aforge-runtime used by preview
```

## Layout

- `packages/shared/src/index.ts` – the domain model and the zod schemas of the agent contract (`AgentReplySchema`, `OpSchema`), plus `applyOps`. A new op needs: the schema entry, a case in `applyOps`, a label in `describeOp` (web `components/AgentPanel.tsx`) and, for file ops, handling in the accept route (server `index.ts`).
- `apps/server/src` – Fastify routes in `application.ts`; `index.ts` takes the single-writer lease before importing any stateful services; `agents.ts` (consultant via API or `claude -p --json-schema`, implementation via `claude -p stream-json` / `codex exec --json`), `context.ts` (system prompt, context, canned intents), `generate.ts` (the generated steps: stories, architecture, implementation prompt), `build.ts` (spec + runtime contract), `preview.ts` (docker + injecting proxy), `inspector.ts`, `tests.ts`, `figma.ts`, `workspace.ts` (safePath, git), `store.ts`, `events.ts` (SSE bus).
- `packages/protocol` – hub ⇄ relay ⇄ worker wire format (framing as aFinder's relay), enrollment tokens, per-worker ChaCha20-Poly1305 envelopes, session handshake, chunking. `packages/runner` – headless Claude Code / Codex runs and git bundle helpers, shared by server and worker.
- `apps/server/src/tasks.ts` – task and bug lifecycle (run per repository, review, return, breakdown approval, contract). `store.ts` `mutateProject` serialises read-modify-write per project; the PUT route merges issues by `updatedAt`. Repositories: `repoDir` (main = workspace, others `repos/<id>`), every code route takes `?repo=`.
- Web editor: `App.tsx` `Studio` (header ladder, fixed layout per step), `components/Glyphs.tsx` (step colours/icons, Jira type icons, six status shapes), `components/Work.tsx`, `stages/OverviewStage|BoardStage|SplitStage|ImplementStage|WikiStage.tsx`.
- `apps/server/src/auth.ts` – Keycloak sign-in (server-side OIDC, cookie session), project roles (`members.json`) and the role check of every `/api` route. Web: `router.ts` (History API), `auth.tsx`, `home/Home.tsx` (sign-in, menu, Projekty / Agenti / Uživatelé / Nastavení); the editor is `/p/<id>`.
- Agentic IDE: `packages/shared/src/ide.ts` (trace, settings, `IdePlanSchema`, Scribe's `backlogChange`, `revertTrace`), server `ide.ts` (composer plan → tasks queued per repository via `tasks.ts` `startIssues`, ⌘K, trace revert/assign, Documenter after accepted IDE work), web `stages/IdeStage|IdeTrace|IdeImmersive.tsx` and `ide.css`. `Project.trace` is server-owned (the PUT route keeps it).
- `apps/server/src/hub.ts` (relay connection, worker sessions, job dispatch), `pipeline.ts` (orchestrator plan → tasks), `chat.ts` (consultant exchange, proposal decisions; serialized per project).
- `apps/relay` – Node `ws` relay, in-memory rooms (one replica). `apps/worker/src/cli.ts` – `aforge-worker enroll|run|status`.
- `apps/web/src` – `App.tsx` (window shell), `studio.tsx` (state, autosave, SSE), `stages/*`, `components/*`, `styles.css` (Finder tokens; light/dark via `prefers-color-scheme`).

## Conventions

- UI strings in Czech, written inline. Colours only through the CSS variables in `styles.css`.
- Spawn processes with argument arrays (`proc.ts`), never shell strings. Client paths go through `safePath`.
- The agent never edits the project directly – it returns proposals the user accepts.
- Default model `claude-opus-5-5` with adaptive thinking and server-side fallback (`fallbacks: 'default'`).
- Compact code, short comments explaining *why*.

Production deployment: `deploy/production/INSTALL.md`. Production agents run in a bounded tmpfs Docker workspace with read-only source/Git, verified file export and filtered outbound networking. Never pass the host environment or Docker socket into jobs. `npm run release` creates the tested deployable artifact.
