# Pracovní sessions a snapshoty

## Zpřesněné zadání

Rozšiř Reactor o pracovní sessions a historii uvnitř projektu. Každá session má vlastní kompletní flow **Design → Zadání → Build → Kód → Náhled → Testy**, včetně promptů, textů, konverzace, souborů a výsledků.

Umožni vytvořit novou prázdnou session a přepínat mezi sessions. Běhy, workspace, náhled a testy musí být oddělené, aby jedna session mohla pracovat, zatímco ve druhé připravuji zadání.

Umožni uložit pojmenovaný snapshot session a session archivovat. Snapshot zachytí obsah flow v daném okamžiku; pracovní session může pokračovat. Archivace uzamkne celou session. Snapshot i archiv jsou pouze pro čtení, včetně ochrany serverových API.

V projektu zobraz historii s názvem, časem a stavem. Po rozkliknutí zpřístupni uložené fáze, texty, kód a výsledky. Historický náhled ukazuje uložený stav, log, anotace a dostupné snímky z testů. Nespouští kontejner ani AI.

Snapshot pořizuj po skončení zápisových úloh, aby neobsahoval neúplné výsledky. Novou session musí jít vytvořit i během práce jiné session. Existující projekty zachovej jako jejich první session bez přesouvání nebo ztráty dat.

## Použití

- V projektu otevři **Sessions a historie** v navigaci nebo v liště pod hlavním záhlavím.
- **Prázdná pracovní session** vytvoří nové zadání, prompty, design, stories, workspace a konverzaci. Zachová se název projektu a preferovaný implementační agent.
- **Snapshot aktuální session** uloží pojmenovanou samostatnou kopii. Zdrojová session zůstane editovatelná.
- **Archivovat session** uzamkne model, soubory a akce. Pokud běží stabilní náhled, archivace ho zastaví a uloží jeho předchozí stav a log. Rozpracovaný agent/build/pipeline/test/nahrávání archivaci blokuje.
- Historie seskupuje snapshoty pod zdrojovou session. U pracovních sessions ukazuje aktuální běh. Lišta vždy uvádí otevřenou session a případný režim pouze pro čtení.
- Archiv zachovává prompty, zadání, stories, snímky Figmy a vrstvy, diagramy a jejich zdroje, implementační prompt a plán změn, zdrojový kód včetně necommitnutých změn a historie Git, konverzaci a návrhy, výsledky testů a jejich snímky, videa průchodů, logy a záznamy agentů.
- Živý proces ani iframe se nekopírují. Náhled archivu zobrazuje uložené podklady. Kopie neobsahuje `node_modules`, `bin`, `obj`, `.vite` a `.DS_Store`; symbolické odkazy odmítne, aby archiv nemohl záviset na dále měněných souborech.

## Uložení a izolace

Původní `data/projects/<projekt>/project.json` a `workspace/` zůstávají na místě jako **Session 1**. `sessions.json` obsahuje index sessions a snapshotů. Další sessions mají data v `sessions/<session>/`; snapshoty v `snapshots/<session>-<snapshot>/`. Publikování snapshotu i zápis indexu používá atomické přejmenování, neúplná kopie se nepublikuje.

Každá session má vlastní execution id (`<projekt>--<session>`); všechny stávající flow API, SSE, mapy běhů, kontejnery, sítě a workspace používají právě toto id. Snapshot používá `<projekt>--<session>--<snapshot>`. Server odvozuje stav pouze pro čtení z vlastního indexu, nikoli z klientem poslaného modelu.

Při ukládání snapshotu nebo archivaci je zdroj rezervovaný proti novým zápisům. Rozpracované HTTP zápisy i background jobs blokují zachycení. Založení nové session používá samostatný identifikátor a běžící práci neukončuje.

Události flow se od této verze zapisují do `events.jsonl`; staré nezaznamenané operace nelze zpětně rekonstruovat. Čtecí přehled zobrazí poslední zaznamenané události (maximálně 2000 v záznamu, 100 v přehledu aktivity); původní journal je součástí kopie. `session-record.json` zmrazí stav náhledu, poslední události a telemetrii agentů při zachycení. Zápisové API vrací pro archiv nebo snapshot HTTP 403, při běžící práci nebo rezervaci HTTP 409.

## Ověření

Integrační testy používají izolovaná data a skutečné routy Fastify. Ověřují zpětnou kompatibilitu, novou session během práce agenta, oddělené workspaces, kopii všech podkladů včetně necommitnutých souborů a médií, neměnnost po změně zdroje, ochranu zápisových a spouštěcích endpointů, souběžné zápisy, odmítnutí symbolických odkazů a pokračování práce po archivaci.
