# aForge

Low-code AI studio pro softwarový dům: **wireframy + user stories → model bloků → implementace přes Claude Code / Codex → běh v izolovaném Ubuntu kontejneru → Playwright testy**, s AI konzultantem v každé fázi. Vzhled macOS Finderu (tokeny tématu *Moderní (macOS)* z aFinderu), světlý i tmavý režim.

Zadání: [docs/PROMPT.md](docs/PROMPT.md) · Architektura: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)

## Požadavky

- Node.js 22+ a npm
- Docker (Docker Desktop / OrbStack) pro náhled a testy
- **Claude Code** (`claude`, přihlášený) – výchozí agent pro konzultace i implementaci; volitelně **Codex** (`codex`)
- volitelně `ANTHROPIC_API_KEY` – konzultant pak volá Anthropic API (Claude Opus 5.5, structured outputs) místo CLI

## Spuštění

```bash
npm install
npm run runtime:build   # jednou: image aforge-runtime (Ubuntu 24.04, Node 22, .NET 8 SDK, Python 3, Nginx)
npm run dev             # server :4310 + web :5310
```

Otevřete <http://localhost:5310>.

Produkčně: `npm run build` a `npm start -w @aforge/server` – server pak servíruje i sestavený web na <http://localhost:4310>.

## Fáze

| Fáze | Co dělá |
|---|---|
| **Design** | Editor wireframů (9 druhů prvků, tažení, změna velikosti, přichytávání k mřížce 8 px, inspektor, vazba na stories, poznámky), import rámců z Figmy přes REST API, vložený Figma náhled vedle plátna. |
| **Zadání** | Popis projektu, user stories *Jako / chci / abych*, akceptační kritéria, MoSCoW priorita, stav (koncept → připraveno → implementováno → ověřeno testy), vazba na obrazovky. |
| **Bloky** | Graf stránek, komponent, API, entit, workflow, integrací a jobů s vazbami (React Flow); agent ho vygeneruje ze stories. |
| **Build** | Volba stacku (.NET / Node / Python, React / Vue, Azure Container Apps / AKS / App Service / Static Web Apps) a agenta. Vygeneruje `AFORGE_SPEC.md` a pustí Claude Code nebo Codex v git repozitáři projektu, průběh živě. Režim *inkrementální* zapracuje otevřené anotace a padající testy. |
| **Kód** | Strom souborů, Monaco editor (⌘S), commit, historie buildů a změn agenta s diffy. |
| **Náhled** | Spustí aplikaci v kontejneru `aforge-runtime` (vlastní síť, limity CPU/RAM, workspace jen pro čtení) přes `.aforge/start.sh`; zobrazí ji v okně prohlížeče. **Anotace**: v režimu *Anotovat* klikněte na prvek běžící aplikace a připište poznámku – jde agentovi i do dalšího buildu. |
| **Testy** | Playwright testy z `e2e/` v oficiálním Playwright kontejneru proti běžící aplikaci; výsledky, chyby a screenshoty namapované na stories přes `[US-x]` v názvu testu. |

**Agent** (⌘J) je v každé fázi a vidí celý projekt (stories, wireframy, bloky, soubory, anotace, testy, aktuální výběr). Odpovídá strukturovanými **návrhy změn** (přijmout / odmítnout) a hlídá **konflikty** mezi stories, designem, bloky, anotacemi a testy. Rychlé akce: kontrola konzistence, návrh stories / wireframů, stories → bloky, zpracování anotací, rozbor testů.

Klávesy: ⌘1–⌘7 přepínají fáze, ⌘J agent, v designu šipky / ⇧šipky posun, ⌘D duplikát, Backspace smazání.

## Data

Vše leží v `data/projects/<id>/` (mimo git): `project.json` (model), `chat.json` (konverzace s agentem) a `workspace/` (vygenerovaná aplikace, vlastní git repozitář). Jiné umístění: `AFORGE_DATA=/cesta`.

## Proměnné prostředí

| Proměnná | Význam |
|---|---|
| `PORT` | port serveru (4310) |
| `AFORGE_DATA` | adresář s daty |
| `ANTHROPIC_API_KEY` | konzultant přes Anthropic API místo Claude Code CLI |
| `AFORGE_MODEL` | model pro API (výchozí `claude-opus-5-5`) |
| `AFORGE_CLI_MODEL` | model pro `claude -p` (výchozí `opus`) |
| `AFORGE_PASS_API_KEY` | předat `ANTHROPIC_API_KEY` i implementačnímu Claude Code (jinak běží na přihlášení) |
| `AFORGE_RUNTIME_IMAGE` | jiný runtime image |

## Bezpečnost (MVP)

Implementační agent zatím běží **na hostiteli** v pracovním adresáři projektu: Claude Code s `--permission-mode acceptEdits` a povolenými jen souborovými nástroji a `npm`/`npx`/`node`/`dotnet`/`git`/`python3`/`pip`; Codex v sandboxu `workspace-write`. Server poslouchá jen na `127.0.0.1`. Spuštění agenta uvnitř kontejneru je první položka roadmapy.
