# Reactor

Low-code AI studio pro softwarový dům: **design z Figmy → epicy a stories → rozpad na tasky FE / BE do repozitářů → implementace týmem agentů (Claude Code / Codex, agent na repozitář) → náhled v izolovaném kontejneru → Playwright testy → wiki pro lidi**. Pro web, mobil, desktop, backend i knihovny. Vzhled macOS Finderu v *čistém vzhledu* aFinderu (jedno světlé pozadí bez dělicích čar, panely jako zaoblené karty, měkké ovládací prvky) – výchozí a jediný styl, ne volba. Světlý i tmavý režim.

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
npm run keycloak        # Keycloak :8380 s realmem aforge (deploy/keycloak), nechte běžet
npm run dev             # server :4310 + web :5310
```

Otevřete <http://localhost:5310> a přihlaste se: `admin` / `admin` (administrátor) nebo `developer` / `developer`. Bez Keycloaku: `AFORGE_AUTH=off npm run dev` (jeden lokální administrátor).

## Přihlášení, aplikace a role

Přihlášení běží přes Keycloak (OIDC code flow s PKCE na serveru, prohlížeč drží jen httpOnly cookie, takže SSE, obrázky i videa fungují beze změny). Po přihlášení je aplikace s menu **Projekty** (otevření projektu vede do editoru na `/p/<id>`), **Agenti** (workery a běhy), **Uživatelé** (jen administrátor: role uživatelů v projektech) a **Nastavení** (účet, kde běží agenti, relay).

Administrátor je uživatel s realm rolí `aforge-admin` a vidí vše. Role v projektu (`Vlastník`, `Editor`, `Čtenář`) ukládá Reactor v `data/projects/<id>/members.json` a platí pro všechny sessions projektu: čtenář má editor jen pro čtení, editor mění, vlastník navíc spravuje členy. Zakladatel projektu je jeho vlastník. Projekt bez členů je přístupný jen administrátorovi; stará data mají explicitní migraci vlastníka.

Produkčně: `npm run build` a `npm start -w @aforge/server` – server pak servíruje i sestavený web na <http://localhost:4310>.

## Editor projektu

Práce je řazená jako v Jiře: **epic → story → task / bug** (a sub-task), s klíči projektu jako `RZ-12` ve společném číslování. Hlavička editoru je karta se **žebříkem kroků**, který je zároveň navigací; každý krok má jednu barvu a ikonu, stejnou na kartách, u tasků i u agentů. Stav ukazuje šest tvarů ikon (čeká, pracuje, ke schválení, hotovo, selhalo, blokováno). Pevná rozložení, žádné dokovací panely.

| Krok | Co dělá |
|---|---|
| **Přehled** | Kolik stories je v kterém kroku, co čeká na vás (rozpad a kontrakt ke schválení, tasky k revizi, bugy, změny wiki) a kdo z týmu na čem pracuje. |
| **Design** | Synchronizace z Figmy (rámce = obrazovky, vrstvy), výběr vrstev, poznámky, vazby na stories a příznak rozpracování. Vrstvy vlevo, plátno, inspektor vpravo. |
| **Stories** | Board: řádek = epic, sloupec = krok (Story, Rozpad, Implementace, Náhled, Testy, Hotovo). Karta má typ a klíč, náhled obrazovky a stopu tasků (barva = vrstva, tvar = stav). **Analytik** navrhne epicy a stories z designu a zadání. Detail story spojuje design, zadání a kritéria s výsledky testů, vlastní konzultaci a tasky a bugy. |
| **Rozpad** | **Architekt** rozpadne stories na tasky (frontend, backend, testy, ostatní) do repozitářů projektu a navrhne **API kontrakt** (OpenAPI), který dostane každý repozitář jako `contract/openapi.yaml`. Rozpad se schvaluje po stories. Repozitáře mají platformu: web, mobil, desktop, backend, knihovna. Druhá záložka: architektura v diagramech a implementační prompt. |
| **Implementace** | Tasky a bugy po repozitářích. **Každý repozitář má svého agenta** (FE vývojář, BE vývojář, Tester podle vrstvy) a repozitáře běží souběžně, v jednom repozitáři postupně. Průběh agenta jako časová osa, výsledek čeká na revizi: změněné soubory, *Přijmout*, nebo *Vrátit* s komentářem (agent pokračuje). Záložka Kód: soubory a Git po repozitářích. |
| **Náhled** | Aplikace v kontejneru `aforge-runtime`: vedlejší repozitáře (backend) startují z `/repos/<id>`, hlavní repozitář servíruje port 80. Každá **anotace** z náhledu je zároveň bug. Mobil a desktop náhled zatím nemají. |
| **Testy** | Playwright testy proti náhledu, namapované na stories přes `[KLÍČ-n]` v názvu testu. **Selhaný test založí bug** pod svou story ve správném repozitáři; když test znovu projde, bug se uzavře. Průchody aplikací na video. |
| **Wiki** | Po zelených testech **Dokumentarista** navrhne změny wiki pro lidi: stránka o aplikaci a jedna na epic, krátce co funkce umí, jak na to a pravidla. Změny se přijímají nebo zahazují, starší verze zůstávají. |

**Workflow**: Enterprise má všechny kroky výše, Developer Prompt → Kód → Náhled → Testy, **Vibe coding** Prompt → Náhled ve stejném UI (aplikace hned vedle promptu). Kroky jdou upravit a přidat vlastní promptové. **Prompt kroku** (tužka v hlavičce) je volitelný pokyn, který čtou všichni agenti v kroku.

**Konzultant** (⌘J) vidí celý projekt a odpovídá **návrhy změn** k přijetí nebo odmítnutí, včetně nových tasků a bugů, a hlídá konflikty. Konzultace k jedné story běží přímo v jejím detailu.

Ve **Stories** je vlevo sbalitelná struktura epic → story → task / bug → podúkol, včetně testů. Používá stejné typové ikony jako board. Položky lze hledat a otevřít jejich detail vpravo. Epic a story se upravují přímo v detailu, tasky, bugy a testy přes **Upravit**. **Smazat** vyžaduje přesné opsání názvu a předem vypíše dopad: smazání epicu ponechá stories bez epicu; smazání story odstraní její tasky, podúkoly a samostatné testy se skripty a videi. Sdílené testy zůstanou u ostatních stories. Běžící práci je nutné nejdřív zastavit.

**Analyzovat a reorganizovat** připraví revizi vybraných stories před implementací, v rozsahu projektu nebo epicu. Rozpracované a hotové stories slouží pouze jako kontext. Návrh ukáže sloučení, rozdělení, přesun, upřesnění nebo ponechání včetně zadání před/po a přiřazení každého původního kritéria. Skupiny lze upravit, přijmout nebo odmítnout jednotlivě; samotná analýza backlog nemění. Po přijetí změny se původní stories a rozpad uchovají v historii, výsledné stories dostanou nové klíče a čekají na nový rozpad. Změna zadání, designu či tasků během analýzy vyžaduje novou revizi. **Navrhnout stories** nadále generuje podklady z projektového zadání a designu přímo do boardu.

Klávesy: ⌘1–⌘8 přepínají kroky, ⌘J konzultant.

### Plánování pro lidi

Epicy, stories, tasky, bugy, podúkoly a testy mají společné **Plánování pro tým**: vlastní odhad v hodinách a více poznámek, upozornění nebo omezení s volitelným časem připomenutí a deadlinem. Plánování neovlivňuje implementaci a jeho údaje se nepředávají žádnému agentovi. Odhady se zobrazují také na boardu, ve stromu a v seznamech tasků. Změny chrání verze proti přepsání jiným uživatelem.

**Zvonek** v hlavičce i v hlavní navigaci sbírá splatná upozornění ze všech přístupných aktivních sessions. Aplikace kontroluje časy během otevření a znovu po návratu do okna; když byla zavřená, čekající upozornění ukáže při dalším otevření. Jde o upozornění uvnitř aplikace, ne e-mail nebo systémový push. Přečtení je osobní, vyřízení poznámky je společné pro tým. Deadline vyvolá nové upozornění i po přečteném dřívějším připomenutí. Při reorganizaci se poznámky a termíny přenesou na výsledné stories; po rozdělení je potřeba odhady znovu stanovit.

### Markdown, historie a přílohy

Popisy epiců a stories se běžně zobrazují jako formátovaný Markdown s bezpečným HTML. **Editovat** otevře původní zdroj a toolbar pro tučné písmo, kurzívu, podtržení (`<u>`), přeškrtnutí, nadpisy, seznamy včetně checklistů, citace, kód, tabulky, odkazy a obrázky. Skripty, event handlery a aktivní vložené stránky se nevykreslují. **Historie** uchovává změněné verze s autorem a časem, včetně změn agentem; obnovení staršího textu vytvoří novou verzi.

**Připojit soubor** i přetažení podporují více souborů, každý do 20 MB. Obrázky PNG/JPEG/GIF/WebP se vloží do textu, ostatní soubory jako odkazy ke stažení. Přílohy se ukládají samostatně a zůstávají dostupné starším verzím i snapshotům. Textové podklady dostávají analytici v kontextu; binární podklady a obrázky se před implementací zkopírují do `.aforge/attachments/` každého repozitáře a cestují i v Git bundlech na workery. Reference se zachovají také při sloučení nebo rozdělení stories.

## Distribuovaní agenti (workery na subscription)

Konzultace, buildy i orchestrace mohou běžet na jiných serverech, kde je přihlášený Claude Code / Codex na subscription:

```
Reactor (hub) ──wss──▶ relay (internet) ◀──wss── aforge-worker (server A: claude, štítky orchestrator,review)
                                       ◀──wss── aforge-worker (server B: claude+codex, štítek build)
```

- **Relay** (`apps/relay`) přeposílá rámce mezi hubem a workery v místnosti hubu (= SHA-256 jeho tajemství, takže ji nikdo nepřevezme). Vychází z relaye aFinderu. Obsah je šifrovaný end-to-end (ChaCha20-Poly1305, klíč pro každého workera), relay vidí jen id workera. Spuštění: `npm run relay` (port 8787), produkčně kontejner `apps/relay/Dockerfile` – viz [deploy/containerapp-relay.md](deploy/containerapp-relay.md).
- **Worker** (`apps/worker`): v Reactoru *Agenti a pipeline → Přidat worker* vytvoří jednorázový token, na serveru pak
  ```bash
  npx aforge-worker enroll <token> --name build-01 --labels build,review --max-jobs 1
  npx aforge-worker run          # nebo systemd: deploy/aforge-worker.service
  ```
  Worker se připojuje jen odchozím spojením, ohlásí schopnosti (claude, codex, docker, git) a štítky, a běží na přihlášení CLI (subscription).
- **Režim** *Lokálně / Vzdálení workeři* v Reactoru určuje, kde běží konzultace a buildy. Build na workeru dostane git bundle repozitáře a vrátí bundle s novými commity, které se do workspace fast-forwardnou.
- **Pipeline**: cíl + *Spustit pipeline* → orchestrátor (worker se štítkem `orchestrator`) z celého kontextu sestaví plán úloh po fázích (stories, design, bloky, review, build, testy) se závislostmi; hub ho vykoná a nezávislé úlohy rozdělí paralelně na volné workery podle schopností, štítků a vytížení. Návrhy změn modelu čekají na schválení (volitelně se přijímají automaticky), kód vždy na člověka.

### Přehled běhů a spotřeby

*Agenti a pipeline* zobrazuje společný seznam lokálních a vzdálených běhů napříč projekty, jejich model, worker/hostitel, konkrétní krok, čas spuštění, trvání a stav. Lze hledat a filtrovat aktuální projekt nebo aktivní běhy. U workerů jsou rozepsané přiřazené úlohy včetně názvu pipeline tasku.

Tokeny jsou skutečně hlášené údaje, nikoli odhad délky promptu. **Kontext** je poslední hlášený požadavek, **tokeny celkem** kumulativní spotřeba běhu včetně cache. Claude Code hlásí spotřebu a orientační cenu přes [stream-json](https://code.claude.com/docs/en/headless). [Codex exec JSONL](https://developers.openai.com/codex/noninteractive) hlásí souhrn tokenů; aktuální kontext a model se doplňují z jeho vlastního session souboru, výhradně pro `thread_id` tohoto procesu. Pokud CLI údaj neposkytne, přehled zobrazí neznámou hodnotu. Některé údaje přijdou až po dokončení.

V rozbalení *Sazby a kontextová okna modelů* lze nastavit přesné id modelu, velikost okna a sazby USD / milion tokenů (vstup, cache, výstup). Hlášená cena a velikost okna mají přednost. Vypočtená cena je označená jako odhad; bez známé sazby se nevymýšlí. U předplatného jde o orientační hodnotu práce, nikoli skutečně účtovanou částku. Cena se neodhaduje pro zápisy do cache bez hlášené ceny (záleží na TTL).

Historie v `data/agent-runs.json` drží posledních 200 dokončených běhů a všechny aktivní; nastavení sazeb je v `data/agent-models.json`. Při restartu serveru se nedokončené záznamy označí jako přerušené. Sběr začíná touto verzí, starší běhy se zpětně nedopočítávají. **Vzdálené workery aktualizujte a restartujte**; přehled upozorní na připojené starší workery bez telemetrie.

## Sessions a historie projektu

V **Sessions a historie** lze založit novou prázdnou pracovní session, uložit pojmenovaný snapshot a archivovat dokončenou session. Každá session má vlastní flow, workspace, konverzaci a běhy, takže jednu lze připravovat během práce jiné. Snapshot i archiv lze procházet po fázích pouze pro čtení; zápisové a spouštěcí akce chrání také server. Stávající projekty zůstávají jako Session 1. Podrobnosti, zpřesněné zadání a omezení uloženého náhledu: [Pracovní sessions a snapshoty](docs/session-snapshots.md).

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
| `AFORGE_AUTH` | `off` vypne přihlášení |
| `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID` | Keycloak (výchozí `http://localhost:8380`, `aforge`, `aforge`) |
| `KEYCLOAK_CLIENT_SECRET` | jen pro důvěrného klienta; výchozí je veřejný klient s PKCE |
| `KEYCLOAK_ADMIN_ROLE` | realm role administrátora (`aforge-admin`) |
| `AFORGE_PUBLIC_URL` | veřejná adresa pro redirect z Keycloaku, pokud ji nelze odvodit z hlaviček proxy |
| `AFORGE_MODEL_METRICS` | JSON objekt podle přesného id modelu s `contextWindow`, `inputUsdPerMillion`, `cachedInputUsdPerMillion`, `outputUsdPerMillion`; má přednost před sazbami v UI |

## Produkční provoz a Cloudflare

Kompletní postup: [deploy/production/INSTALL.md](deploy/production/INSTALL.md). Levná výchozí varianta je jeden Linux VPS s rootless Dockerem za Cloudflare Tunnel, samostatná registrovaná doména pro náhledy a privátní Cloudflare R2 pro média a šifrované zálohy. `npm run production:config` připraví konfiguraci bez testovacích uživatelů; `npm run release` ověří kód a vytvoří balíček s checksumem. CI sestavuje a testuje; ručně spuštěný deployment workflow nasazuje přes ověřený SSH host. Bez cílového serveru, domén a klíčů aplikace nic nezveřejňuje.

Produkce vyžaduje přihlášení, HTTPS, rootless Docker sandbox agentů, filtr odchozího provozu, oddělené preview a R2. Agent pracuje v omezeném dočasném souborovém systému, vstupní repozitář a Git metadata má pouze pro čtení; ověřené běžné soubory se exportují po dokončení. Nemá Docker socket, hostitelské přihlášení ani tajné údaje aplikace; k modelu přistupuje přes samostatnou bránu omezenou na jednu úlohu; skutečný API klíč zůstává v bráně. Symbolické odkazy a speciální soubory se neexportují. Běhy, délka, paměť, CPU, počet souborů, velikost výstupu, přílohy a úložiště mají limity. Přesný peněžní strop je potřeba nastavit i u poskytovatelů AI.

Data obsluhuje právě jeden proces chráněný zámkem. `/health/live` a `/health/ready` slouží pro kontrolu provozu, `/api/operations` je pro administrátory. Systemd zajišťuje restart, denní konzistentní zálohy s údržbovým oknem a monitoring stáří zálohy. Skript obnovy ověřuje JSON/Git a zkouší obnovení Keycloaku do dočasného PostgreSQL kontejneru. Před otevřením bety je nutné cílové ověření domény, rootless runtime, přihlášení, skutečného agenta, preview/testů, R2 a obnovy.

Při lokálním vývoji může agent nadále používat přihlášené CLI na hostiteli. Tento režim produkční start odmítne.
