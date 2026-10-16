// Monaco bundled with the app (no CDN), with the editor, TypeScript and JSON workers.
import * as monaco from 'monaco-editor'
import { loader } from '@monaco-editor/react'
import EditorWorker from 'monaco-editor/editor/editor.worker?worker'
import TsWorker from 'monaco-editor/language/typescript/ts.worker?worker'
import JsonWorker from 'monaco-editor/language/json/json.worker?worker'

self.MonacoEnvironment = {
  getWorker: (_id: string, label: string) => {
    if (label === 'typescript' || label === 'javascript') return new TsWorker()
    if (label === 'json') return new JsonWorker()
    return new EditorWorker()
  },
}

loader.config({ monaco })

const EXT: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript', mjs: 'javascript', cjs: 'javascript',
  json: 'json', css: 'css', scss: 'scss', html: 'html', vue: 'html', md: 'markdown', cs: 'csharp', csproj: 'xml',
  sln: 'plaintext', xml: 'xml', yml: 'yaml', yaml: 'yaml', sh: 'shell', py: 'python', sql: 'sql', conf: 'plaintext',
  dockerfile: 'dockerfile', bicep: 'plaintext', tf: 'hcl', razor: 'razor', cshtml: 'razor',
}

export const languageOf = (path: string) => {
  const name = path.split('/').pop()!.toLowerCase()
  if (name === 'dockerfile') return 'dockerfile'
  return EXT[name.split('.').pop() ?? ''] ?? 'plaintext'
}

export const darkMode = () => window.matchMedia('(prefers-color-scheme: dark)').matches
