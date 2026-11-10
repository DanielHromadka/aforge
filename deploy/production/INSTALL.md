# Reactor: produkční beta na Linuxu za Cloudflare

Konfigurace je určená pro **jeden Linux server, jednu instanci aplikace, pozvané uživatele a rootless Docker**. JSON úložiště má zámek proti druhému procesu; není podporováno více replik ani sdílený NFS. Každý agent má vlastní kontejner a interní síť, omezené CPU/RAM/PID/čas, vstupní repozitář i adresář `.git` pouze pro čtení; pracovní kopie má tmpfs 1 GB a výstup nejvýše 512 MB a žádný Docker socket ani tajné klíče aplikace. Odchozí HTTP(S) jde přes Squid, který odmítá privátní a link-local adresy. Preview má samostatnou síť na session. Pro nedůvěryhodné veřejné zákazníky je další vrstvou samostatný worker/VM na zákazníka; kontejnery sdílejí kernel. Tato konfigurace neprohlašuje izolaci na úrovni virtuálního stroje.

## Hosting a náklady

Dev prostředí na Azure (Terraform, VM s auto-shutdownem): `deploy/azure/README.md`.

Cloudflare zajišťuje DNS, HTTPS a named Tunnel; aplikace, Git, agenti, preview a Keycloak běží na VPS. Cloudflare Containers mají standardně dočasný disk, proto se tento model na ně nenasazuje bez změny persistence. Zálohy a privátní média jsou v oddělených R2 bucketech. Plán Cloudflare Free má cenu $0; R2 Standard zahrnuje 10 GB-měsíc, 1 milion operací A a 10 milionů B měsíčně, další spotřeba se účtuje. AI API, domény a VPS se platí zvlášť. Přesnou cenu serveru je potřeba potvrdit při objednání; tento balíček žádné prostředky neobjednává. Pro omezenou betu začít s 4 vCPU / 16 GB RAM a SSD alespoň 100 GB. Výchozí produkční konfigurace dovolí 2 modelové běhy celkem, 1 na projekt a 1 preview; při souběhu testů lze paměť spotřebovat i nad 8 GB.

Zdroje ověřené 2026-10-18:
- https://www.cloudflare.com/plans/free/
- https://developers.cloudflare.com/containers/faq/
- https://developers.cloudflare.com/r2/pricing/
- https://developers.cloudflare.com/tunnel/get-started/
- https://docs.docker.com/engine/security/rootless/
- https://www.keycloak.org/server/configuration-production

## 1. Server a účty

Na čistém Debian/Ubuntu Linuxu nainstalovat Node.js 22, npm, Git, rootless Docker Engine + Compose plugin, Caddy, cloudflared, restic, curl, openssl a util-linux. Instalační příkazy pro systémové balíčky se řídí konkrétní distribucí; cloudové prostředky ani balíčky tento repozitář sám nekupuje/neinstaluje.

Založit systémového uživatele `reactor` s domovem a UID, které zůstane stabilní. Pod ním zprovoznit rootless Docker podle dokumentace Dockeru, zapnout `loginctl enable-linger reactor` a ověřit socket `/run/user/<UID>/docker.sock`. Nedávat uživatele do skupiny rootového Dockeru. SSH jen přes klíče, běžné aktualizace OS a firewall: žádné veřejné aplikační porty; Tunnel navazuje spojení odchozím směrem. Rootless Docker musí vynucovat paměť/CPU přes cgroups v2, ověřit `docker info`.

Aplikace běží jako hostitelská systemd služba, aby loopback porty rootless kontejnerů byly dostupné orchestrátoru. Generovaný kód se na hostiteli nespouští. Správa Dockeru z aplikace je důvěryhodná část systému a účet `reactor` musí být vyhrazený pro tuto instalaci.

## 2. Konfigurace bez testovacích účtů

V checkoutu sestavení:

```bash
npm ci
npm run production:config -- --app app.example.com --auth auth.example.com --relay relay.example.com --preview example-preview.net --uid 1001 --out /bezpecna/cesta/reactor-config
```

Preview musí být na **jiné registrované doméně** než aplikace (např. `example-preview.net` versus `app.example.com`). Ne jen jiná subdoména stejné domény. Pro levnou variantu použít přímo základ druhé domény (`p-….example-preview.net`), aby wildcard odpovídal bezplatnému Universal SSL. Hlubší názvy typu `p-….preview.example.net` potřebují jiné pokrytí certifikátem. Produkční start to kontroluje. Prohlížeč pak odděluje cookies aplikace od generovaného kódu. Preview vyžaduje jednorázový vstupní ticket a oddělenou host-only cookie; podporuje partitioned cookie pro iframe. Starší prohlížeč blokující všechny cookies třetích stran může vyžadovat otevření náhledu v novém okně.

Generátor vytvoří nové náhodné heslo PostgreSQL, bootstrap správce Keycloaku a šifrovací heslo resticu; nevypisuje je. Nikdy nepřepisuje existující soubory. Zkopírovat do `/etc/reactor`, vlastník root, adresář 700, env soubory 600. `realm.json` neobsahuje tajné údaje. Deploy ho kopíruje do `/srv/reactor/config/realm.json` s právy 644, aby ho mohl připojit rootless Docker; tajné env soubory zůstávají v `/etc/reactor` s právy 600. Bootstrap realm **neobsahuje žádné uživatele** a registrace je vypnutá.

Doplnit všechny `REPLACE_WITH…` hodnoty, skutečný UID Dockeru a API klíče. Produkční provoz používá explicitní API klíče uložené pouze v bráně modelu; agent dostane jen náhradní hodnotu a adresu brány. Každá brána má nejvýše 100 modelových požadavků a omezuje výstupní tokeny; nepřebírají přihlášení, historii ani konfigurační soubory z vývojářova počítače. Nepoužívaný provider odstranit. Podle potřeby použít vlastní agent image rozšířený např. o .NET SDK; výchozí image obsahuje Node/Python/Git a obě CLI.

R2: vytvořit **privátní** bucket `reactor-media` a jiný `reactor-backups`, pro každý samostatné omezené přístupové údaje. Nepovolovat `r2.dev` ani veřejný custom domain médií. Aplikace po kontrole role vydává S3 odkazy platné 120 sekund. Média zůstávají i lokálně pro historii/snapshoty a kompletní zálohu. Pro média nastavit lifecycle podle skutečné retenční politiky; automaticky nemažeme přílohy potřebné pro historii. Backup token smí jen do backup bucketu. `RESTIC_PASSWORD` uložit i mimo server; bez něj není záloha obnovitelná.

## 3. Sestavení a nasazení

```bash
npm run release
# Přenést .releases/reactor-<verze>.tar.gz a odpovídající .sha256 na server.
sudo bash deploy/production/deploy.sh /cesta/reactor-<verze>.tar.gz
```

Deploy ověří checksum, rozbalí novou release do `/opt/reactor/releases`, nainstaluje zamčené závislosti bez install skriptů, sestaví job/runtime/relay image, při upgradu udělá zálohu, přepne symlink `/opt/reactor/current`, nainstaluje systemd služby a zkontroluje readiness. Pokud nová aplikace neprojde readiness, vrací předchozí kód. **Databáze se tím nevrací**; budoucí nekompatibilní migrace vyžadují explicitní obnovu dat. Vygenerovaný runtime `start.sh` je nyní omezen kontejnerem; starší projekty ověřit po upgradu.

První deploy ještě nemá restic repozitář. Na serveru jako root načíst důvěryhodné env soubory (`set -a; source …; set +a`), spustit `restic init`, potom `systemctl start reactor-backup.service`. Před upgrady je funkční zálohování povinné. První vytvoření infrastruktury může trvat několik minut; Keycloak se musí nejdřív inicializovat.

```bash
cd /opt/reactor/current
sudo node --import tsx scripts/production.mjs check --env /etc/reactor/production.env
sudo systemctl start reactor-backup.service
sudo bash deploy/production/restore-test.sh
```

Pro restore-test je nutné mít v prostředí i `/etc/reactor/backup.env` a `DOCKER_HOST` z produkčního env. Produkční preflight ověří konfiguraci, rootless daemon, image, egress, issuer Keycloaku a přístup do R2. Nespouští placený model.

## 4. Cloudflare

Vytvořit named Tunnel, token dát do `/etc/reactor/tunnel.env` jako `TUNNEL_TOKEN=…`. Publikované hostnames:

| Hostname | Lokální služba |
|---|---|
| `app.example.com` | `http://127.0.0.1:8088` |
| `auth.example.com` | `http://127.0.0.1:8088` |
| `relay.example.com` | `http://127.0.0.1:8088` |
| `*.example-preview.net` | `http://127.0.0.1:8088` |

Zachovat původní Host; v dashboardu nenastavovat jiný HTTP Host Header pro všechny aplikace. U wildcard hostnames doplnit wildcard DNS záznam pro Tunnel podle dashboardu. Doména preview musí být přidaná v Cloudflare účtu. Zapnout WebSockets a HTTPS přesměrování; pro `/api/*`, auth a preview **bypass cache**, žádné Cache Everything ani přepisování HTML/JS. Služby vydávají pro citlivé odpovědi `no-store`. Preview ani relay nepoužívat přes development Quick Tunnel. Pro video/velké soubory nepoužívat obecný CDN proxy místo R2.

```bash
sudo systemctl enable --now reactor-tunnel
```

Přístup k administraci Keycloaku je veřejně blokovaný v Caddy. Správce ji používá přes SSH forward na `127.0.0.1:8080` a lokální DNS/host mapování odpovídající `AUTH_HOST`, případně přes samostatnou chráněnou administrátorskou cestu. Přes Keycloak bootstrap správce založit první skutečný účet, dát mu realm roli `aforge-admin`; nastavit MFA a povinnou změnu hesla. Bootstrap účet potom odstranit a jeho heslo z provozní konfigurace odebrat (po prvním importu není potřeba). Další uživatele zvát přes Keycloak; samoobslužná registrace je vypnutá.

## 5. Stará data, provoz a monitoring

Staré projekty bez členů jsou nyní dostupné jen administrátorovi. Po záloze a se zastavenou aplikací přidělit vlastníka:

```bash
AFORGE_DATA=/srv/reactor/data node scripts/production.mjs claim-legacy --owner KEYCLOAK_USER_ID
```

API `/health/live` je liveness, `/health/ready` readiness úložiště. `/api/operations` je přehled dostupný pouze administrátorovi (požadavky, chyby, RSS, velikost úložiště, limity). Strukturované logy jsou v journald; cookies, authorization a query stringy se nelogují. Nastavit retenci journald, externí kontrolu dostupnosti z jiné sítě a skutečný alert webhook `REACTOR_ALERT_WEBHOOK` v production.env. Minutový monitor hlídá readiness a stáří poslední zálohy; loguje chybu a pokud je webhook nastavený, odešle provozní alert. Tento skript se spouští až na serveru.

Záloha denně v 03:15 ±10 minut **pozastaví aplikaci, běžící generování i Keycloak**, vytvoří konzistentní dump a šifrovanou zálohu dat+konfigurace do R2. To znamená plánované servisní okno; přerušené běhy se po startu označí jako přerušené a mohou vyžadovat opakování. Retence: 7 denních, 4 týdenní, 6 měsíčních; poté `restic check`. Journály session rotují po 20 MB (aktuální + předchozí soubor). Uložení zálohy ověřit pomocí restore-testu před otevřením bety a pak pravidelně.

Obnova havárie: zastavit aplikaci a Keycloak, `restic restore <snapshot> --target /bezpecny/restored`, ověřit obsah skriptem verify-backup, obnovit `/srv/reactor/data` a vlastníka `reactor`, potřebné `/etc/reactor` soubory a dump PostgreSQL do čisté databáze, znovu spustit preflight, služby a smoke test. Nepřepisovat běžící data ani nevkládat starý dump do neprázdné DB. Restore-test automaticky kontroluje JSON, `git fsck` a **skutečně obnoví PostgreSQL do dočasného kontejneru** bez veřejné sítě; nesahá do produkční DB.

## Před pozváním prvních uživatelů

- Zelená CI, preflight, záloha a test obnovy na cílovém Linuxu.
- HTTPS login/logout a první skutečný správce, testovací účty nepřítomné, druhý uživatel nevidí cizí projekt.
- V prohlížeči projít skutečného placeného agenta → revizi → preview přes oddělenou doménu → test → video z R2, včetně příloh a obnovení stránky.
- Ověřit restart služby, výpadek workera, časový limit, odmítnutí quota a odchozího přístupu na metadata/privátní IP.
- Potvrdit rozpočet a limity v konzolích AI providerů a Cloudflare. Počet běhů/čas/tokeny omezují aplikaci; nejsou zárukou přesného finančního stropu.

Tento repozitář připravuje nasazení; skutečná doména, cloudové účty, klíče, Linux server a cílové ověření se musí dodat před zveřejněním.

## Automatické nasazení z GitHub Actions

Workflow `Deploy production` se spouští ručně (`workflow_dispatch`), ověří kód a předá release na připravený server. V GitHub environment `production` nastavit `PRODUCTION_HOST`, `PRODUCTION_SSH_USER`, `PRODUCTION_SSH_KEY` a `PRODUCTION_KNOWN_HOSTS` (ověřený SSH host key získaný důvěryhodnou cestou). SSH účet musí mít oprávnění k nasazení přes uvedený `sudo` skript; jde o důvěryhodný release účet, nikoli účet zákazníka. Konfigurace aplikace a API klíče zůstávají na serveru. Workflow neprovádí automatické SSH přijetí neznámého host key. CI nikdy nevolá placené modely.

## Samostatné workery

Produkční `deploy/aforge-worker.service` vyžaduje `/etc/aforge/worker.env` s rootless `DOCKER_HOST`, dostupným `AFORGE_EGRESS_PROXY`, cestou k Docker konfiguraci v povoleném stavovém adresáři a klíči používaných providerů. Na workeru sestavit stejné agent/model-gateway/egress image a spustit egress. Enrollment udělat pod účtem `aforge` s `AFORGE_WORKER_HOME=/var/lib/aforge-worker/config`; stavový adresář musí vlastnit tento uživatel. Úlohy jsou v `/var/lib/aforge-worker/jobs`, aby je Docker daemon viděl i při izolaci služby. Produkční workery používají bránu s API klíčem; vývojové subscription přihlášení na hostiteli zůstává dostupné mimo produkční režim. Po aktualizaci přeregistrace není nutná, ale je potřeba restart a ověření schopností/image. Worker i hub mají časový limit a zrušení běžící konzultace i implementace.
