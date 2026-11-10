import { mkdir, writeFile, readFile, readdir, stat } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { parseEnv } from 'node:util'
import { spawnSync } from 'node:child_process'
import { getDomain } from 'tldts'
const [command, ...args] = process.argv.slice(2)
const flag = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined }
const secret = () => randomBytes(32).toString('hex')
const run = (cmd, argv) => { const result = spawnSync(cmd, argv, { encoding: 'utf8', env: process.env }); if (result.status !== 0) throw new Error(`${cmd} failed: ${result.stderr?.slice(0, 200)}`); return result.stdout.trim() }
try {
  if (command === 'init') {
    const hosts = Object.fromEntries(['app', 'auth', 'relay', 'preview'].map((key) => [key, flag(key)]))
    for (const [key, host] of Object.entries(hosts)) if (!host || !/^[a-z0-9][a-z0-9.-]+$/.test(host) || !getDomain(host)) throw new Error(`Missing/invalid --${key} hostname`)
    if (getDomain(hosts.app) === getDomain(hosts.preview)) throw new Error('Preview must use a different registered domain')
    const dir = resolve(flag('out') ?? '.releases/production-config')
    await mkdir(dir, { recursive: true, mode: 0o700 })
    const uid = flag('uid') ?? '1001'
    if (!/^\d+$/.test(uid)) throw new Error('Invalid --uid')
    const env = {
      NODE_ENV: 'production', PORT: '4310', AFORGE_DATA: '/srv/reactor/data', REACTOR_CONFIG_DIR: '/srv/reactor/config',
      APP_HOST: hosts.app, AUTH_HOST: hosts.auth, RELAY_HOST: hosts.relay,
      AFORGE_PUBLIC_URL: `https://${hosts.app}`, AFORGE_PREVIEW_DOMAIN: hosts.preview,
      KEYCLOAK_URL: `https://${hosts.auth}`, KEYCLOAK_INTERNAL_URL: 'http://127.0.0.1:8080', KEYCLOAK_REALM: 'aforge', KEYCLOAK_CLIENT_ID: 'aforge',
      KEYCLOAK_BOOTSTRAP_ADMIN: 'reactor-bootstrap', KEYCLOAK_BOOTSTRAP_PASSWORD: secret(), POSTGRES_PASSWORD: secret(),
      AFORGE_AGENT_SANDBOX: 'docker', AFORGE_AGENT_IMAGE: 'reactor-agent:latest', AFORGE_EGRESS_PROXY: 'reactor-egress',
      DOCKER_HOST: `unix:///run/user/${uid}/docker.sock`, DOCKER_CONFIG: '/srv/reactor/docker-config', AFORGE_RELAY: `wss://${hosts.relay}`, AFORGE_MAX_JOBS: '2', AFORGE_PROJECT_MAX_JOBS: '1',
      AFORGE_JOB_TIMEOUT_MS: '1800000', AFORGE_PROJECT_DAILY_RUNS: '100', AFORGE_MAX_PREVIEWS: '1', AFORGE_PREVIEW_IDLE_MINUTES: '30',
      AFORGE_DATA_BYTES: String(50 * 1024 ** 3), AFORGE_PROJECT_BYTES: String(10 * 1024 ** 3), AFORGE_PROJECT_ATTACHMENT_BYTES: String(1024 ** 3),
      AFORGE_MEDIA_BUCKET: 'reactor-media', AFORGE_MEDIA_ENDPOINT: 'REPLACE_WITH_R2_S3_ENDPOINT',
      AFORGE_MEDIA_ACCESS_KEY_ID: 'REPLACE_WITH_R2_KEY_ID', AFORGE_MEDIA_SECRET_ACCESS_KEY: 'REPLACE_WITH_R2_SECRET',
      ANTHROPIC_API_KEY: 'REPLACE_WITH_ANTHROPIC_API_KEY', OPENAI_API_KEY: 'REPLACE_WITH_OPENAI_API_KEY_OR_REMOVE',
    }
    await writeFile(join(dir, 'production.env'), Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n') + '\n', { flag: 'wx', mode: 0o600 })
    const realm = JSON.parse(await readFile(new URL('../deploy/keycloak/aforge-realm.json', import.meta.url), 'utf8'))
    delete realm.users
    realm.sslRequired = 'external'; realm.registrationAllowed = false; realm.resetPasswordAllowed = false; realm.bruteForceProtected = true
    realm.failureFactor = 5; realm.waitIncrementSeconds = 60; realm.maxFailureWaitSeconds = 900
    realm.ssoSessionIdleTimeout = 1800; realm.ssoSessionMaxLifespan = 43200; realm.accessTokenLifespan = 300
    realm.eventsEnabled = true; realm.eventsExpiration = 604800
    realm.clients = realm.clients.map((c) => ({ ...c, redirectUris: [`https://${hosts.app}/api/auth/callback`], webOrigins: [`https://${hosts.app}`], attributes: { ...c.attributes, 'post.logout.redirect.uris': `https://${hosts.app}/`, 'backchannel.logout.url': `https://${hosts.app}/api/auth/backchannel-logout`, 'backchannel.logout.session.required': 'true' } }))
    await writeFile(join(dir, 'realm.json'), JSON.stringify(realm, null, 2) + '\n', { flag: 'wx', mode: 0o644 })
    // On Azure restic reaches Blob storage with the VM's managed identity, so no backup key is stored.
    const azure = flag('backup-azure')
    if (azure !== undefined && !/^[a-z0-9]{3,24}$/.test(azure)) throw new Error('Invalid --backup-azure storage account')
    const repo = azure ? `RESTIC_REPOSITORY=azure:reactor-backups:/\nAZURE_ACCOUNT_NAME=${azure}\n` : 'RESTIC_REPOSITORY=s3:REPLACE_WITH_R2_ENDPOINT/reactor-backups\nAWS_ACCESS_KEY_ID=REPLACE_WITH_BACKUP_KEY_ID\nAWS_SECRET_ACCESS_KEY=REPLACE_WITH_BACKUP_SECRET\n'
    await writeFile(join(dir, 'backup.env'), `${repo}RESTIC_PASSWORD=${secret()}\n`, { flag: 'wx', mode: 0o600 })
    await writeFile(join(dir, 'tunnel.env'), 'TUNNEL_TOKEN=REPLACE_WITH_NAMED_TUNNEL_TOKEN\n', { flag: 'wx', mode: 0o600 })
    console.log(`Configuration generated in ${dir}. Fill credentials before production:check; secrets were not printed.`)
  } else if (command === 'check') {
    const env = parseEnv(await readFile(resolve(flag('env') ?? '/etc/reactor/production.env'), 'utf8'))
    if (Object.values(env).some((v) => /REPLACE_WITH/.test(v))) throw new Error('Configuration still contains placeholders')
    Object.assign(process.env, env)
    if (flag('image')) process.env.AFORGE_AGENT_IMAGE = flag('image')
    if (process.env.NODE_ENV !== 'production') throw new Error('NODE_ENV must be production')
    const { validateProduction } = await import('../apps/server/src/config.ts'); validateProduction()
    const security = JSON.parse(run('docker', ['info', '--format', '{{json .SecurityOptions}}']))
    if (!security.some((s) => s.includes('rootless'))) throw new Error('Use a rootless Docker daemon for production jobs')
    if (run('docker', ['info', '--format', '{{.CgroupVersion}} {{.MemoryLimit}} {{.CPUCfsQuota}} {{.PidsLimit}}']) !== '2 true true true') throw new Error('Docker must enforce memory/CPU/PID limits with cgroups v2')
    run('docker', ['image', 'inspect', process.env.AFORGE_AGENT_IMAGE, process.env.AFORGE_RUNTIME_IMAGE ?? 'aforge-runtime:latest', process.env.AFORGE_TEST_IMAGE ?? 'reactor-playwright:latest', process.env.AFORGE_INGRESS_IMAGE ?? 'reactor-ingress:latest', process.env.AFORGE_MODEL_GATEWAY_IMAGE ?? 'reactor-model-gateway:latest'])
    if (run('docker', ['inspect', '-f', '{{.State.Running}}', process.env.AFORGE_EGRESS_PROXY]) !== 'true') throw new Error('Egress proxy is not running')
    const config = await fetch(`${process.env.KEYCLOAK_INTERNAL_URL}/realms/${process.env.KEYCLOAK_REALM}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json())
    if (config.issuer !== `${process.env.KEYCLOAK_URL}/realms/${process.env.KEYCLOAK_REALM}`) throw new Error('OIDC issuer mismatch')
    const { S3Client, HeadBucketCommand } = await import('@aws-sdk/client-s3')
    const s3 = new S3Client({ endpoint: env.AFORGE_MEDIA_ENDPOINT, region: 'auto', credentials: { accessKeyId: env.AFORGE_MEDIA_ACCESS_KEY_ID, secretAccessKey: env.AFORGE_MEDIA_SECRET_ACCESS_KEY } })
    await s3.send(new HeadBucketCommand({ Bucket: env.AFORGE_MEDIA_BUCKET }))
    await stat(process.env.AFORGE_DATA)
    console.log('Production prerequisites passed (config, rootless Docker, images, egress, OIDC, private media bucket, data directory).')
  } else if (command === 'claim-legacy') {
    const dir = process.env.AFORGE_DATA
    const owner = flag('owner')
    if (!dir || !owner) throw new Error('Set AFORGE_DATA and --owner <Keycloak user ID>')
    for (const name of await readdir(join(dir, 'projects'))) {
      const file = join(dir, 'projects', name, 'members.json')
      let members = {}; try { members = JSON.parse(await readFile(file, 'utf8')) } catch (e) { if (e.code !== 'ENOENT') throw e }
      if (Object.keys(members).length) continue
      await writeFile(file, JSON.stringify({ [owner]: 'owner' }, null, 2), { mode: 0o600 })
      console.log(`Assigned owner: ${name}`)
    }
  } else throw new Error('Usage: production.mjs init --app HOST --auth HOST --relay HOST --preview OTHER_DOMAIN [--uid UID] [--backup-azure ACCOUNT] [--out DIR] | check --env FILE | claim-legacy --owner ID')
} catch (e) { console.error(e.message); process.exitCode = 1 }
