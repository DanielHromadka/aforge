import { afterEach, expect, it, vi } from 'vitest'
afterEach(() => { vi.unstubAllEnvs(); vi.resetModules() })
const setup = () => {
  for (const [name, value] of Object.entries({ NODE_ENV: 'production', AFORGE_PUBLIC_URL: 'https://app.example.com', KEYCLOAK_URL: 'https://auth.example.com', AFORGE_PREVIEW_DOMAIN: 'preview.example.net', AFORGE_DATA: '/srv/reactor/data', AFORGE_AGENT_SANDBOX: 'docker', AFORGE_EGRESS_PROXY: 'reactor-egress', AFORGE_MEDIA_BUCKET: 'private-media', AFORGE_MEDIA_ENDPOINT: 'https://fixture.r2.cloudflarestorage.com', AFORGE_MEDIA_ACCESS_KEY_ID: 'fixture', AFORGE_MEDIA_SECRET_ACCESS_KEY: 'fixture' })) vi.stubEnv(name, value)
}
it('rejects insecure production configuration and a same-site preview domain', async () => {
  setup(); vi.stubEnv('AFORGE_AUTH', 'off')
  expect((await import('./config.js')).validateProduction).toThrow('přihlášení')
  vi.resetModules(); vi.stubEnv('AFORGE_AUTH', 'on'); vi.stubEnv('AFORGE_AGENT_SANDBOX', 'host')
  expect((await import('./config.js')).validateProduction).toThrow('SANDBOX')
  vi.resetModules(); vi.stubEnv('AFORGE_AGENT_SANDBOX', 'docker'); vi.stubEnv('AFORGE_PREVIEW_DOMAIN', 'preview.example.com')
  expect((await import('./config.js')).validateProduction).toThrow('registrované')
  vi.resetModules(); vi.stubEnv('AFORGE_PREVIEW_DOMAIN', 'preview.example.net')
  expect((await import('./config.js')).validateProduction).not.toThrow()
})
