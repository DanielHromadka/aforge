# Security

Reactor runs AI agents on your code, previews generated applications and can connect remote workers through a
relay. Please report vulnerabilities privately through GitHub's
[private vulnerability reporting](https://github.com/DanielHromadka/aforge/security/advisories/new), not in public issues.

Only the latest version on `main` is supported; fixes land there.

The local development accounts in `deploy/keycloak/aforge-realm.json` (`admin` / `admin`, `developer` / `developer`)
are for a local Keycloak only. Production generates its own configuration (`npm run production:config`).
