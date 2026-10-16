// SF Symbols–like line icons (1.5px strokes, 16px grid).
import type { ReactNode } from 'react'

const I = ({ children, size = 16 }: { children: ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
    {children}
  </svg>
)

export const Icon = {
  design: () => (
    <I>
      <rect x="2" y="2.5" width="12" height="11" rx="2" />
      <path d="M2 5.5h12M5 8h3M5 10.5h6" />
    </I>
  ),
  stories: () => (
    <I>
      <path d="M4 2.5h6l2.5 2.5v8.5H4z" />
      <path d="M6 7h4.5M6 9.5h4.5M6 12h2.5" />
    </I>
  ),
  blocks: () => (
    <I>
      <rect x="1.8" y="2" width="5" height="4" rx="1" />
      <rect x="9.2" y="10" width="5" height="4" rx="1" />
      <rect x="9.2" y="2" width="5" height="4" rx="1" />
      <path d="M6.8 4h2.4M11.7 6v4" />
    </I>
  ),
  build: () => (
    <I>
      <path d="M9.5 2.5 13.5 6.5 7 13l-4-4z" />
      <path d="M2.5 13.5 5 11" />
    </I>
  ),
  code: () => (
    <I>
      <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3 7 13" />
    </I>
  ),
  preview: () => (
    <I>
      <rect x="1.5" y="2.5" width="13" height="10" rx="1.8" />
      <path d="M1.5 5.5h13" />
      <circle cx="3.6" cy="4" r=".3" fill="currentColor" />
    </I>
  ),
  tests: () => (
    <I>
      <path d="M3 8.5 6.2 11.5 13 4.5" />
    </I>
  ),
  folder: () => (
    <I>
      <path d="M1.8 4.2c0-.7.5-1.2 1.2-1.2h3l1.4 1.5H13c.7 0 1.2.5 1.2 1.2v6.6c0 .7-.5 1.2-1.2 1.2H3c-.7 0-1.2-.5-1.2-1.2z" />
    </I>
  ),
  file: () => (
    <I>
      <path d="M4 1.8h5l3 3v9.4H4z" />
      <path d="M9 1.8v3h3" />
    </I>
  ),
  screen: () => (
    <I>
      <rect x="2" y="2.5" width="12" height="9" rx="1.5" />
      <path d="M6 14h4" />
    </I>
  ),
  plus: () => (
    <I>
      <path d="M8 3v10M3 8h10" />
    </I>
  ),
  sparkles: ({ size }: { size?: number } = {}) => (
    <I size={size}>
      <path d="M7 1.8 8.3 5.7 12.2 7 8.3 8.3 7 12.2 5.7 8.3 1.8 7 5.7 5.7z" />
      <path d="M12.5 10.5 13 12l1.5.5-1.5.5-.5 1.5-.5-1.5-1.5-.5 1.5-.5z" />
    </I>
  ),
  send: () => (
    <I size={14}>
      <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
    </I>
  ),
  play: () => (
    <I>
      <path d="M5 3.2v9.6L12.5 8z" fill="currentColor" stroke="none" />
    </I>
  ),
  stop: () => (
    <I>
      <rect x="4" y="4" width="8" height="8" rx="1.2" fill="currentColor" stroke="none" />
    </I>
  ),
  cursor: () => (
    <I>
      <path d="M3.5 2.5 12 8.2 8.2 9 6.4 12.6z" />
    </I>
  ),
  refresh: () => (
    <I>
      <path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.5V5h-2.5" />
    </I>
  ),
  trash: () => (
    <I>
      <path d="M2.8 4.2h10.4M6.2 4V2.6h3.6V4M4 4.2l.7 9.3h6.6l.7-9.3" />
    </I>
  ),
  check: () => (
    <I size={14}>
      <path d="M3 8.5 6.2 11.5 13 4.5" />
    </I>
  ),
  x: () => (
    <I size={14}>
      <path d="M4 4l8 8M12 4l-8 8" />
    </I>
  ),
  search: () => (
    <I size={14}>
      <circle cx="7" cy="7" r="4.3" />
      <path d="m10.2 10.2 3.3 3.3" />
    </I>
  ),
  sidebar: () => (
    <I>
      <rect x="1.8" y="2.5" width="12.4" height="11" rx="2" />
      <path d="M6 2.5v11" />
    </I>
  ),
  figma: () => (
    <I>
      <path d="M8 2H6a2 2 0 0 0 0 4h2zM8 6H6a2 2 0 0 0 0 4h2zM8 2h2a2 2 0 0 1 0 4H8zM8 10H6a2 2 0 1 0 2 2z" />
      <circle cx="10" cy="8" r="2" />
    </I>
  ),
  warn: () => (
    <I size={14}>
      <path d="M8 2.2 14.3 13.3H1.7z" />
      <path d="M8 6.5v3M8 11.3v.2" />
    </I>
  ),
  history: () => (
    <I>
      <path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2.5v2.5H5" />
      <path d="M8 5v3l2 1.5" />
    </I>
  ),
  pin: () => (
    <I>
      <path d="M8 14s4.5-4.2 4.5-7.5a4.5 4.5 0 1 0-9 0C3.5 9.8 8 14 8 14z" />
      <circle cx="8" cy="6.5" r="1.5" />
    </I>
  ),
}

export type IconName = keyof typeof Icon
