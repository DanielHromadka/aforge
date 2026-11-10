// Reactor website: scroll reveals, the pinned IDE story, the mode picker and the shortcut keys for the visitor's
// platform. No scroll listeners: everything that reacts to scrolling uses IntersectionObserver.

const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches
const mac = /Mac|iPhone|iPad/.test(navigator.userAgentData?.platform ?? navigator.platform ?? '')

if (!mac) for (const kbd of document.querySelectorAll('kbd[data-key="mod"]')) kbd.textContent = 'Ctrl'

// ---- modes ----------------------------------------------------------------------------------------

const NOTES = {
  hero: 'The whole flow, from the design to the wiki, story by story.',
  ide: 'Editor, composer and one agent per repository; the backlog is written behind it.',
  ponor: 'Only the running app and one prompt line, dark in both themes.',
  dark: 'Every view follows the system, light or dark.',
}
const ALT = { hero: 'Reactor in the Studio', ide: 'Reactor in the agentic IDE', ponor: 'Reactor in the immersive mode', dark: 'The agentic IDE in dark mode' }

function setupModes() {
  const section = document.getElementById('modes')
  const tabs = [...section.querySelectorAll('[role="tab"]')]
  const shot = document.getElementById('mode-shot')
  const note = document.getElementById('mode-note')
  const select = (tab, focus) => {
    for (const t of tabs) {
      const on = t === tab
      t.setAttribute('aria-selected', String(on))
      t.tabIndex = on ? 0 : -1
    }
    if (focus) tab.focus()
    const id = tab.dataset.shot
    const next = new Image()
    next.srcset = `img/${id}-1280.webp 1280w, img/${id}.webp 2400w`
    next.sizes = shot.sizes
    shot.classList.add('swapping')
    const swap = () => {
      shot.srcset = next.srcset
      shot.src = `img/${id}.webp`
      shot.alt = ALT[id]
      note.textContent = NOTES[id]
      shot.classList.remove('swapping')
    }
    next.decode().then(swap, swap)
  }
  tabs.forEach((tab, i) => {
    tab.tabIndex = i === 0 ? 0 : -1
    tab.addEventListener('click', () => select(tab, false))
    tab.addEventListener('keydown', (e) => {
      const step = { ArrowRight: 1, ArrowLeft: -1 }[e.key]
      const target = step ? tabs[(i + step + tabs.length) % tabs.length] : e.key === 'Home' ? tabs[0] : e.key === 'End' ? tabs.at(-1) : null
      if (!target) return
      e.preventDefault()
      select(target, true)
    })
  })
}

// ---- the IDE story ----------------------------------------------------------------------------------

function setupStory() {
  const steps = [...document.querySelectorAll('.step')]
  const shots = [...document.querySelectorAll('.story-stage img')]
  const activate = (step) => {
    for (const s of steps) s.classList.toggle('active', s === step)
    const index = Number(step.dataset.shot)
    shots.forEach((img, i) => img.classList.toggle('active', i === index))
  }
  activate(steps[0])
  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) if (entry.isIntersecting) activate(entry.target)
    },
    { rootMargin: '-45% 0px -45% 0px' }
  )
  steps.forEach((s) => observer.observe(s))
}

// ---- reveals and the navigation border ---------------------------------------------------------------

function setupReveals() {
  if (reduceMotion) {
    document.querySelectorAll('.reveal').forEach((el) => el.classList.add('in'))
  } else {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue
          entry.target.classList.add('in')
          observer.unobserve(entry.target)
        }
      },
      { rootMargin: '0px 0px -12% 0px' }
    )
    document.querySelectorAll('.reveal').forEach((el) => observer.observe(el))
  }
  // The nav gets its hairline once the hero's top edge has scrolled away.
  const nav = document.querySelector('.nav')
  new IntersectionObserver(([entry]) => nav.classList.toggle('scrolled', !entry.isIntersecting)).observe(document.querySelector('.hero h1'))
}

setupReveals()
setupModes()
setupStory()
