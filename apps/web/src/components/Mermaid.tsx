// Renders Mermaid source to SVG. Mermaid is large, so it loads on the first diagram; a syntax error shows
// the message instead of the picture, so a broken diagram can be fixed in its text.
import { useEffect, useId, useState } from 'react'

type MermaidApi = typeof import('mermaid').default

let loading: Promise<MermaidApi> | null = null
let theme = ''

const load = (dark: boolean): Promise<MermaidApi> => {
  loading ??= import('mermaid').then((m) => m.default)
  return loading.then((mermaid) => {
    const want = dark ? 'dark' : 'neutral'
    if (theme !== want) {
      mermaid.initialize({ startOnLoad: false, theme: want, securityLevel: 'strict', fontFamily: 'inherit' })
      theme = want
    }
    return mermaid
  })
}

const useDark = () => {
  const [dark, setDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)
  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = () => setDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return dark
}

export const Mermaid = ({ source }: { source: string }) => {
  const id = `mmd-${useId().replace(/[^a-z0-9]/gi, '')}`
  const dark = useDark()
  const [svg, setSvg] = useState('')
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    load(dark)
      .then((m) => m.render(id, source))
      .then((r) => {
        if (!live) return
        setSvg(r.svg)
        setError('')
      })
      .catch((e: Error) => {
        if (!live) return
        setError(e.message)
        // A failed render leaves its error box in the body.
        document.getElementById(`d${id}`)?.remove()
      })
    return () => {
      live = false
    }
  }, [source, dark, id])
  if (error) return <pre className="mermaid-error">{error}</pre>
  // Mermaid's output with securityLevel "strict" is sanitized SVG.
  return <div className="mermaid-view" dangerouslySetInnerHTML={{ __html: svg }} />
}
