// The Reactor mark: the eight steps of the workflow, in their colours and order, as a ring around the core
// where the work comes together. Gradient ids are unique per instance, so several marks can share a page.
import { useId } from 'react'

const STEPS = ['#af52de', '#007aff', '#30b0c7', '#5e5ce6', '#ff9500', '#28cd41', '#ff2d55', '#a2845e']
const R = 18.5
const C = 2 * Math.PI * R
const WIDTH = 5.5
const GAP = 2.4
// Round caps add half the stroke width at each end, so the dash is shortened by one width.
const DASH = C / STEPS.length - GAP - WIDTH

export const Logo = ({ size = 24, title = 'Reactor' }: { size?: number; title?: string }) => {
  const id = useId().replace(/:/g, '')
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title}>
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#2a2a3c" /><stop offset="1" stopColor="#0e0e16" /></linearGradient>
        <radialGradient id={`${id}g`} cx="32" cy="32" r="15" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#fff" stopOpacity=".95" /><stop offset=".45" stopColor="#8fb8ff" stopOpacity=".55" /><stop offset="1" stopColor="#5e5ce6" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" rx="14.5" fill={`url(#${id}t)`} />
      <rect x=".5" y=".5" width="63" height="63" rx="14" fill="none" stroke="#fff" strokeOpacity=".08" />
      {STEPS.map((color, i) => (
        <circle key={color} cx="32" cy="32" r={R} fill="none" stroke={color} strokeWidth={WIDTH} strokeLinecap="round"
          strokeDasharray={`${DASH} ${C - DASH}`} transform={`rotate(${-90 + i * 45 + ((GAP + WIDTH) / 2 / C) * 360} 32 32)`} />
      ))}
      <circle cx="32" cy="32" r="15" fill={`url(#${id}g)`} />
      <circle cx="32" cy="32" r="6.2" fill="#fff" />
    </svg>
  )
}
