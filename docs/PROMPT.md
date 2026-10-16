# aForge – zpřesněné zadání

> Přepracovaná verze původního diktovaného zadání. Slouží jako brief pro vývoj (lidi i AI agenty).

## Kontext

Navrhni a implementuj **aForge**: webovou low-code platformu, ve které IT software house navrhuje, generuje, spouští a ověřuje webové aplikace s pomocí AI agentů (Claude Code, OpenAI Codex).

Cílové aplikace mají typicky:

- **backend** v .NET (ASP.NET Core Minimal API / Web API), případně Node.js nebo Python,
- **frontend** v Reactu nebo Vue,
- **hosting** v Azure: Container Apps, AKS (Kubernetes), App Service nebo Static Web Apps, s Ubuntu kontejnery.

Platforma běží v prohlížeči (desktopová Electron verze je možná později) a má vzhled **macOS Finderu** (stejné tokeny jako téma *Moderní (macOS)* v aFinderu: šedý sidebar, sjednocená lišta, modré výběrové „pilulky“, světlý i tmavý režim podle systému).

## Pracovní tok (fáze)

Každá fáze je samostatná obrazovka; projekt je jeden sdílený model, takže změna v jedné fázi je vidět ve všech.

1. **Design** – uživatel kreslí wireframy v jednoduchém editoru (obrazovky, prvky: kontejner, text, tlačítko, vstup, obrázek, navigace, seznam, tabulka, karta; přesun, změna velikosti, inspektor vlastností, vazba prvku na user story). Alternativně **import z Figmy** (REST API, osobní token, převod rámců na wireframe prvky) a **vložený Figma náhled** (embed) přímo v aplikaci.
2. **Zadání (user stories)** – strukturované příběhy *Jako … chci … abych …* s akceptačními kritérii, prioritou (MoSCoW), stavem a vazbou na obrazovky. Volný textový popis projektu.
3. **Bloky / workflow** – agent převede stories + design na model bloků (stránky, komponenty, API endpointy, entity, workflow kroky, integrace, joby) a vazeb mezi nimi; zobrazení jako editovatelný graf.
4. **Build (implementace)** – platforma vygeneruje implementační specifikaci (`AFORGE_SPEC.md`) a předá ji vybranému agentovi (**Claude Code** nebo **Codex**) v pracovním git repozitáři projektu. Průběh se streamuje do UI, po dokončení se commitne.
5. **Kód** (pokročilý pohled) – strom souborů a **Monaco editor**; úpravy se ukládají do pracovního repozitáře.
6. **Náhled (běh)** – aplikace (backend + frontend + Nginx) se spustí izolovaně v **Ubuntu kontejneru** (Docker) a zobrazí se v části stránky. Uživatel si ji proklikává.
   **Anotace jako v Lovable**: v režimu výběru klikne na libovolný prvek běžící aplikace, napíše poznámku; anotace se vrací agentovi jako vstup.
7. **Testy a ověření** – agent vygeneruje Playwright testy z akceptačních kritérií (`[US-x]` v názvu testu), spustí je v kontejneru proti běžící aplikaci a výsledky (včetně screenshotů) se namapují zpět na stories.

## AI konzultant ve všech fázích

V každé fázi je k dispozici panel **Agent** s plným kontextem projektu (stories, wireframy, bloky, strom souborů, anotace, výsledky testů, aktuální fáze a výběr). Agent:

- odpovídá na dotazy a na základě návrhů uživatele **navrhuje konkrétní změny** jako strukturované *návrhy* (přidat/upravit/smazat story, prvek wireframu, blok, vazbu, soubor),
- uživatel každý návrh **přijme nebo odmítne**; teprve přijetí změní projekt,
- průběžně hlídá **konzistenci**: aby stories dávaly smysl, nebyly v konfliktu mezi sebou, s designem, s bloky ani s anotacemi; konflikty zobrazuje se závažností.

## Nefunkční požadavky

- Agent poskytovatelé za rozhraním: Claude Code CLI (výchozí, bez API klíče), Anthropic API (`ANTHROPIC_API_KEY`), Codex CLI.
- Generovaný kód je vždy v gitu (historie, diff, rollback).
- Běh aplikací je izolovaný (kontejner, vlastní síť); agent nikdy nedostane tajné klíče platformy.
- Projekt je verzovatelný JSON + pracovní repozitář; žádná proprietární databáze pro MVP.
- UI česky, macOS Finder vzhled, světlý/tmavý režim, klávesové zkratky.

## Mimo rozsah MVP (roadmapa)

Více uživatelů a role, SSO (Entra ID), spouštění agenta uvnitř sandbox kontejneru místo na hostiteli, nasazení do Azure (Bicep/Terraform + GitHub Actions/Azure DevOps pipeline), obousměrná synchronizace s Figmou, vizuální regresní testy proti wireframům.
