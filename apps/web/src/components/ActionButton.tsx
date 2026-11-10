// A button that shows something started: from the click until the request returns, and for as long as the
// server reports the work as running (`busy`), it spins and says what is happening.
import { useEffect, useRef, useState, type ReactNode } from 'react'

export const Spinner = () => <span className="spinner" aria-hidden />

export const ActionButton = ({ onClick, busy, busyLabel, icon, children, className = 'btn', disabled, title, type = 'button' }: {
  onClick?: () => unknown
  busy?: boolean
  busyLabel?: ReactNode
  icon?: ReactNode
  children: ReactNode
  className?: string
  disabled?: boolean
  title?: string
  type?: 'button' | 'submit'
}) => {
  const [pending, setPending] = useState(false)
  const mounted = useRef(true)
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  const working = pending || !!busy
  return (
    <button
      type={type}
      className={`${className} ${working ? 'is-busy' : ''}`}
      disabled={disabled || working}
      aria-busy={working}
      title={title}
      onClick={type === 'submit' || !onClick ? undefined : async () => {
        setPending(true)
        try { await onClick() } finally { if (mounted.current) setPending(false) }
      }}
    >
      {working ? <Spinner /> : icon}
      {working && busyLabel ? busyLabel : children}
    </button>
  )
}
