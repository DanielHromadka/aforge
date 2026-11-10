import { getDomain } from 'tldts'

export const production = process.env.NODE_ENV === 'production'
export const limit = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback)
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${name} musí být kladné celé číslo.`)
  return value
}
export const publicUrl = process.env.AFORGE_PUBLIC_URL?.replace(/\/$/, '')
export const previewDomain = process.env.AFORGE_PREVIEW_DOMAIN?.toLowerCase()
export const limits = {
  jobs: limit('AFORGE_MAX_JOBS', production ? 4 : 64), projectJobs: limit('AFORGE_PROJECT_MAX_JOBS', production ? 2 : 32),
  projects: limit('AFORGE_MAX_PROJECTS', 100), attachmentBytes: limit('AFORGE_PROJECT_ATTACHMENT_BYTES', 1024 ** 3),
  projectBytes: limit('AFORGE_PROJECT_BYTES', 10 * 1024 ** 3), dataBytes: limit('AFORGE_DATA_BYTES', 50 * 1024 ** 3),
  previews: limit('AFORGE_MAX_PREVIEWS', 2), previewMinutes: limit('AFORGE_PREVIEW_IDLE_MINUTES', 30),
}

export const validateProduction = () => {
  if (!production) return
  if (process.env.AFORGE_AUTH === 'off') throw new Error('Produkce vyžaduje přihlášení.')
  if (!publicUrl || new URL(publicUrl).protocol !== 'https:') throw new Error('AFORGE_PUBLIC_URL musí být HTTPS adresa.')
  if (!process.env.KEYCLOAK_URL?.startsWith('https://')) throw new Error('Produkce vyžaduje HTTPS KEYCLOAK_URL.')
  if (process.env.AFORGE_AGENT_SANDBOX !== 'docker') throw new Error('Produkce vyžaduje AFORGE_AGENT_SANDBOX=docker.')
  if (!previewDomain || !/^[a-z0-9.-]+$/.test(previewDomain) || !getDomain(previewDomain) || getDomain(previewDomain) === getDomain(new URL(publicUrl).hostname))
    throw new Error('AFORGE_PREVIEW_DOMAIN musí být na jiné registrované doméně než aplikace.')
  if (!process.env.AFORGE_EGRESS_PROXY) throw new Error('Produkce vyžaduje filtr odchozího provozu AFORGE_EGRESS_PROXY.')
  if (!process.env.AFORGE_MEDIA_BUCKET || !process.env.AFORGE_MEDIA_ENDPOINT || !process.env.AFORGE_MEDIA_ACCESS_KEY_ID || !process.env.AFORGE_MEDIA_SECRET_ACCESS_KEY) throw new Error('Produkce vyžaduje privátní R2/S3 pro videa a přílohy.')
  if (!process.env.AFORGE_DATA) throw new Error('Produkce vyžaduje explicitní AFORGE_DATA na trvalém disku.')
}
