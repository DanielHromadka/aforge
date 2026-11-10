# Workflow pracovních sessions

## Zadání a návrh

Každá session má vlastní workflow. Hlavička ukazuje žebřík propojených kroků s ikonou a barvou kroku; je zároveň navigací. Pořadí slouží k orientaci, neblokuje přístup k dalším krokům. Výběr vedle sledu kroků otevírá předvolby a editor.

| Předvolba | Kroky |
| --- | --- |
| Vibe coding | Prompt → Náhled |
| Developer | Prompt → Kód → Náhled → Testy |
| Enterprise | Přehled → Design → Stories → Rozpad → Implementace → Náhled → Testy → Wiki |

Vlastní workflow vznikne úpravou předvolby: změnou názvů nebo pořadí, odebráním kroku, přidáním vestavěného kroku či vlastního promptového kroku. Vestavěný typ může být ve workflow jednou; vlastních promptových kroků může být více. Každý má stabilní ID a vlastní volitelný prompt. Workflow obsahuje 1 až 24 kroků.

Promptové kroky nabízejí konzultaci s agentem a přímou implementaci aplikace. Implementace používá stejný backend a běhový kontrakt jako Enterprise Build. AI se spouští až příslušným tlačítkem. Spuštění/restart kontejneru a zobrazení logů zůstává samostatnou operací bez AI.

## Ukládání a kontext

`Project.workflow` ukládá předvolbu, aktivní kroky a odložené kroky. Odebrání nebo výměna předvolby nemaže prompty ani existující projektové výsledky. Odložený krok lze vrátit v editoru; jeho prompt se nepředává jako aktivní pokyn agentovi. Nový vlastní krok dostane nové ID, obnovení odloženého kroku jeho původní ID.

Vestavěné prompty se při čtení staršího projektu převezmou z `Project.prompts`; staré sessions dostanou Enterprise bez přesouvání dat a dřívější Enterprise (Design → … → Testy) se přečte jako nový i s prompty. Build si ponechává také dva podrobnější prompty pro bloky a implementační plán. Aktivní workflow a prompty se předávají konzultantovi, generování a implementaci. Přímé spuštění z promptového kroku předá i ID právě prováděného kroku a jeho název se objeví v přehledu běhů.

Workflow je součástí `project.json`, tedy i snapshotů a archivů. V archivu je editor i prompt pouze pro čtení a backend odmítá změny. Nová čistá session převezme strukturu workflow základní session projektu s prázdnými prompty; další úpravy jsou nezávislé.

## Ověření

Automatické testy pokrývají migraci, změnu předvolby se zachováním textů a identit, nezávislé vlastní kroky, prázdné prompty, neplatná workflow, předávání kontextu, nezávislost sessions a neměnnost snapshotů.
