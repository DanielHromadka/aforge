import { useEffect, useRef, type ReactNode } from 'react'

export const Dialog = ({ onClose, children, width, label }: { onClose: () => void; children: ReactNode; width?: number; label?: string }) => {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null
    const dialog = ref.current!
    if (!dialog.contains(document.activeElement)) dialog.querySelector<HTMLElement>('input, button, textarea, select')?.focus()
    const trap = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return
      const controls = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href]')]
      const first = controls[0], last = controls[controls.length - 1]
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus() }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus() }
    }
    dialog.addEventListener('keydown', trap)
    return () => { dialog.removeEventListener('keydown', trap); previous?.focus() }
  }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} className="dialog" role="dialog" aria-modal aria-label={label} style={width ? { width } : undefined}>
        {children}
      </div>
    </div>
  )
}
