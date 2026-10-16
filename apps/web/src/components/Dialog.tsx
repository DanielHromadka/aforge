import { useEffect, type ReactNode } from 'react'

export const Dialog = ({ onClose, children, width }: { onClose: () => void; children: ReactNode; width?: number }) => {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal style={width ? { width } : undefined}>
        {children}
      </div>
    </div>
  )
}
