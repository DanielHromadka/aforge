// Import of epics and stories from Jira over its REST API. Jira Cloud signs in with e-mail + API token
// (v3, enhanced JQL search, descriptions in ADF); Jira Data Center with a personal access token (v2,
// wiki markup). Jira is the source of the imported items: a re-import updates them by the remembered
// Jira key, keeps what Reactor adds (screens, status, tasks) and never brings back what was deleted here.
import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'
import { nextKeys, usedKeys, type Epic, type JiraLink, type Project, type Story } from '@aforge/shared'

export interface JiraAuth { url: string; email?: string; token: string }

/** One Jira issue reduced to what an epic or a story needs. */
export interface JiraItem {
  key: string
  epic: boolean
  title: string
  description: string
  priority?: string
  done: boolean
  epicKey?: string
  acceptance?: string
}

const MAX_ITEMS = 1000

const privateAddress = (ip: string) =>
  /^(10\.|127\.|0\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(ip) ||
  /^(::1?$|f[cd]|fe80:|::ffff:(10|127|169\.254|192\.168)\.)/i.test(ip)

/** The server fetches a URL a project editor typed: internal hosts only when JIRA_HOSTS names them. */
export const jiraBase = async (raw: string): Promise<URL> => {
  let url: URL
  try { url = new URL(raw.trim()) } catch { throw new Error('Neplatná adresa Jiry') }
  const allowed = (process.env.JIRA_HOSTS ?? '').split(',').map((h) => h.trim().toLowerCase()).filter(Boolean)
  const listed = allowed.includes(url.hostname.toLowerCase())
  if (allowed.length && !listed) throw new Error(`Jira ${url.hostname} není mezi povolenými (JIRA_HOSTS).`)
  if (url.protocol !== 'https:' && !listed) throw new Error('Jira musí běžet na https://')
  if (!listed) {
    const addresses = isIP(url.hostname) ? [url.hostname] : (await lookup(url.hostname, { all: true }).catch(() => [])).map((a) => a.address)
    if (!addresses.length) throw new Error(`Server ${url.hostname} neznám.`)
    if (addresses.some(privateAddress)) throw new Error(`Interní Jiru ${url.hostname} povolte v JIRA_HOSTS na serveru.`)
  }
  url.pathname = url.pathname.replace(/\/(jira\/)?(browse|projects|secure|plugins)\/.*$/, '').replace(/\/+$/, '')
  url.search = ''
  url.hash = ''
  return url
}

const request = async <T>(base: URL, path: string, auth: JiraAuth): Promise<T> => {
  const authorization = auth.email ? `Basic ${Buffer.from(`${auth.email}:${auth.token}`).toString('base64')}` : `Bearer ${auth.token}`
  const res = await fetch(`${base.href.replace(/\/$/, '')}${path}`, { headers: { authorization, accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(30_000) })
  if (res.status === 401 || res.status === 403) throw new Error('Jira odmítla přihlášení: zkontrolujte e-mail a token.')
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { errorMessages?: string[] } | null
    throw new Error(`Jira vrátila ${res.status}${body?.errorMessages?.length ? `: ${body.errorMessages.join(' ')}` : ''}`)
  }
  return res.json() as Promise<T>
}

// ---- text: ADF (Cloud) and wiki markup (Data Center) to Markdown -------------------------------

interface AdfNode { type: string; text?: string; attrs?: { level?: number }; content?: AdfNode[] }

export const adfToMarkdown = (node: AdfNode | null | undefined): string => {
  if (!node) return ''
  const inner = (n: AdfNode) => (n.content ?? []).map((c) => adfToMarkdown(c)).join('')
  const list = (n: AdfNode, mark: (i: number) => string) => (n.content ?? []).map((item, i) =>
    `${mark(i)}${(item.content ?? []).map((c) => adfToMarkdown(c).trim()).join('\n').replace(/\n/g, '\n  ')}`).join('\n') + '\n\n'
  switch (node.type) {
    case 'text': return node.text ?? ''
    case 'hardBreak': return '\n'
    case 'paragraph': return `${inner(node)}\n\n`
    case 'heading': return `${'#'.repeat(node.attrs?.level ?? 2)} ${inner(node)}\n\n`
    case 'bulletList': return list(node, () => '- ')
    case 'orderedList': return list(node, (i) => `${i + 1}. `)
    case 'codeBlock': return `\`\`\`\n${inner(node)}\n\`\`\`\n\n`
    case 'blockquote': return inner(node).trim().split('\n').map((l) => `> ${l}`).join('\n') + '\n\n'
    case 'rule': return '---\n\n'
    case 'mention': case 'emoji': case 'inlineCard': return node.text ?? ''
    default: return inner(node)
  }
}

export const wikiToMarkdown = (text: string): string => text
  .replace(/\r/g, '')
  // Wiki markup numbers lists with #, it has no # headings; this runs before the h1. rewrite adds them.
  .replace(/^(#+)\s+(?=\S)/gm, (_, s: string) => `${'  '.repeat(s.length - 1)}1. `)
  .replace(/^h([1-6])\.\s*/gm, (_, n: string) => `${'#'.repeat(Number(n))} `)
  .replace(/^(\*+)\s+/gm, (_, s: string) => `${'  '.repeat(s.length - 1)}- `)
  .replace(/\{code(?::[^}]*)?\}/g, '```')
  .replace(/\{noformat\}/g, '```')

const textOf = (value: unknown): string =>
  typeof value === 'string' ? wikiToMarkdown(value).trim() : value && typeof value === 'object' && 'type' in value ? adfToMarkdown(value as AdfNode).trim() : ''

// ---- the story inside the text ---------------------------------------------------------------

const STORY_FORMS = [
  /\bas an?\s+(.+?),?\s+I (?:want|need|would like)(?: to)?\s+(.+?)(?:,?\s+so that\s+(.+?))?\s*(?:\.(?:\s|$)|\n|$)/i,
  /\bjako\s+(.+?),?\s+(?:chci|potřebuji|bych chtěl[a]?)\s+(.+?)(?:,?\s+(?:abych|abychom|aby|abys)\s+(.+?))?\s*(?:\.(?:\s|$)|\n|$)/i,
]

export const parseStoryText = (title: string, description: string) => {
  for (const text of [description, title]) for (const re of STORY_FORMS) {
    const m = text.replace(/\*\*|__/g, '').match(re)
    if (m) return { asA: m[1]!.trim(), iWant: m[2]!.trim(), soThat: m[3]?.trim() ?? '' }
  }
  return { asA: 'uživatel', iWant: title, soThat: '' }
}

const LIST_ITEM = /^\s*(?:[-*+]|\d+[.)]|\[[ x]\])\s+(.*\S)/i

/** List items of a dedicated field, or of the description's section headed Acceptance criteria. */
export const parseAcceptance = (field: string | undefined, description: string): string[] => {
  const items = (lines: string[]) => lines.map((l) => l.match(LIST_ITEM)?.[1]?.replace(/^\[[ x]\]\s*/i, '').trim()).filter((x): x is string => !!x)
  if (field?.trim()) {
    const listed = items(field.split('\n'))
    return listed.length ? listed : field.split('\n').map((l) => l.trim()).filter(Boolean)
  }
  const lines = description.split('\n')
  const start = lines.findIndex((l) => /accept|akceptač/i.test(l) && l.trim().length < 80)
  if (start < 0) return []
  const section: string[] = []
  for (const line of lines.slice(start + 1)) {
    if (/^#{1,6}\s/.test(line) || (/^\S.*:\s*$/.test(line) && !LIST_ITEM.test(line) && section.length)) break
    section.push(line)
  }
  return items(section)
}

const PRIORITY: [RegExp, Story['priority']][] = [[/highest|blocker|critical|high|vysok|kritick/i, 'must'], [/lowest|trivial|nejnižš/i, 'wont'], [/low|nízk/i, 'could']]
const priorityOf = (name?: string): Story['priority'] => PRIORITY.find(([re]) => name && re.test(name))?.[1] ?? 'should'

// ---- fetching ---------------------------------------------------------------------------------

interface RawIssue {
  key: string
  fields: Record<string, unknown> & {
    summary?: string
    description?: unknown
    issuetype?: { name?: string; subtask?: boolean; hierarchyLevel?: number }
    priority?: { name?: string } | null
    status?: { statusCategory?: { key?: string } }
    parent?: { key: string; fields?: { issuetype?: { name?: string; hierarchyLevel?: number } } }
  }
}
const isEpicType = (t?: { name?: string; hierarchyLevel?: number }) => t?.hierarchyLevel === 1 || /^epi[ck]/i.test(t?.name ?? '')

export const fetchJira = async (auth: JiraAuth, jql: string): Promise<JiraItem[]> => {
  const base = await jiraBase(auth.url)
  const v = auth.email ? 3 : 2
  const fields = await request<{ id: string; name: string }[]>(base, `/rest/api/${v}/field`, auth)
  const epicLink = fields.find((f) => f.name === 'Epic Link')?.id
  const acceptance = fields.find((f) => /accept|akceptač/i.test(f.name))?.id
  const wanted = ['summary', 'description', 'issuetype', 'priority', 'status', 'parent', epicLink, acceptance].filter(Boolean).join(',')
  const raw: RawIssue[] = []
  // Cloud pages with nextPageToken, Data Center with startAt.
  for (let token: string | undefined, startAt = 0; raw.length < MAX_ITEMS;) {
    const q = new URLSearchParams({ jql, fields: wanted, maxResults: '100', ...(v === 3 ? (token ? { nextPageToken: token } : {}) : { startAt: String(startAt) }) })
    const page = await request<{ issues: RawIssue[]; nextPageToken?: string; isLast?: boolean; total?: number }>(base, `/rest/api/${v}/search${v === 3 ? '/jql' : ''}?${q}`, auth)
    raw.push(...page.issues)
    startAt += page.issues.length
    token = page.nextPageToken
    if (!page.issues.length || (v === 3 ? page.isLast !== false || !token : startAt >= (page.total ?? 0))) break
  }
  return raw.filter((i) => !i.fields.issuetype?.subtask).slice(0, MAX_ITEMS).map((i) => {
    const f = i.fields
    const parentEpic = f.parent && (isEpicType(f.parent.fields?.issuetype) || !f.parent.fields) ? f.parent.key : undefined
    return {
      key: i.key,
      epic: isEpicType(f.issuetype),
      title: f.summary?.trim() || i.key,
      description: textOf(f.description),
      priority: f.priority?.name,
      done: f.status?.statusCategory?.key === 'done',
      epicKey: (epicLink && typeof f[epicLink] === 'string' ? (f[epicLink] as string) : undefined) ?? parentEpic,
      acceptance: acceptance ? textOf(f[acceptance]) || undefined : undefined,
    }
  })
}

// ---- merging into the project -----------------------------------------------------------------

export interface JiraImport { project: Project; added: number; updated: number; skipped: number }

export const mergeJira = (project: Project, items: JiraItem[], link: Omit<JiraLink, 'items' | 'syncedAt'>, base: string): JiraImport => {
  const map = { ...project.jira?.items }
  const deleted = new Set(project.deletedKeys ?? [])
  let p = project
  let added = 0, updated = 0, skipped = 0
  const browse = (key: string) => `${base.replace(/\/$/, '')}/browse/${key}`
  // Epics first, so the stories can point at their new keys.
  for (const item of [...items.filter((i) => i.epic), ...items.filter((i) => !i.epic)]) {
    const known = map[item.key]
    if (known && deleted.has(known)) { skipped++; continue }
    const description = `${item.description}\n\n[${item.key} v Jiře](${browse(item.key)})`.trim()
    const exists = known && (item.epic ? p.epics?.some((e) => e.id === known) : p.stories.some((s) => s.id === known))
    const id = exists ? known : !usedKeys(p).includes(item.key) ? item.key : nextKeys(p)[0]!
    map[item.key] = id
    if (item.epic) {
      const epic: Epic = { id, title: item.title, description, screenIds: [] }
      p = { ...p, epics: exists ? p.epics!.map((e) => (e.id === id ? { ...e, title: epic.title, description } : e)) : [...(p.epics ?? []), epic] }
    } else {
      const epicId = item.epicKey ? map[item.epicKey] ?? (p.epics?.some((e) => e.id === item.epicKey) ? item.epicKey : undefined) : undefined
      const acceptance = parseAcceptance(item.acceptance, item.description)
      const fromJira = { title: item.title, description, epicId, priority: priorityOf(item.priority), ...parseStoryText(item.title, item.description) }
      p = exists
        ? { ...p, stories: p.stories.map((s) => (s.id === id ? { ...s, ...fromJira, acceptance: acceptance.length ? acceptance : s.acceptance } : s)) }
        : { ...p, stories: [...p.stories, { id, ...fromJira, acceptance, status: item.done ? 'verified' : 'ready', screenIds: [] }] }
    }
    if (exists) updated++
    else added++
  }
  return {
    project: { ...p, storyRevision: (p.storyRevision ?? 0) + 1, jira: { ...link, items: map, syncedAt: new Date().toISOString() } },
    added, updated, skipped,
  }
}
