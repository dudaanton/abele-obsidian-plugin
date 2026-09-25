<template>
  <div class="abele-keyboard-diagnostics" :style="FRAME" aria-hidden="true">
    <div v-for="line in lines" :key="line" class="abele-keyboard-diagnostics__line">
      {{ line }}
    </div>
    <div class="abele-keyboard-diagnostics__events">
      <div v-for="(entry, index) in events" :key="index" class="abele-keyboard-diagnostics__line">
        {{ entry }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * What the page reports about the on-screen keyboard, live, for a screenshot from a phone.
 *
 * No emulator raises the iPhone keyboard, and the iOS Simulator cannot run Obsidian, so a
 * dialog that the keyboard still covers there can only be understood from what the phone
 * itself says: how tall the page and the visual viewport are, what `--keyboard-height`
 * Obsidian has written, where the dialog and the focused field stand, and which keyboard
 * events arrived and when. Turned on in Settings → Other; never in the way of a tap.
 */
import { onBeforeUnmount, onMounted, ref, type CSSProperties } from 'vue'
import {
  KEYBOARD_EVENTS,
  KEYBOARD_VAR,
  keyboardRoomReport,
  keyboardVar,
} from '@/composables/useKeyboardRoom'

/** Inline, so that no stylesheet — a theme's, a snippet's — can make the panel take taps. */
const FRAME: CSSProperties = {
  position: 'fixed',
  top: '0',
  left: '0',
  right: '0',
  zIndex: '2147483647',
  pointerEvents: 'none',
}

/** Body classes that say what kind of screen this is and what the keyboard is doing. */
const TELLING = /keyboard|mobile|phone|tablet|toolbar|hidden-nav|animating/

const EVENTS_KEPT = 8

const lines = ref<string[]>([])
const events = ref<string[]>([])

const round = (n: number) => Math.round(n)
const rect = (el: Element | null): string => {
  if (!el) return '—'
  const r = el.getBoundingClientRect()
  return `top ${round(r.top)} bottom ${round(r.bottom)} h ${round(r.height)}`
}
const describe = (el: Element | null): string => {
  if (!el) return '—'
  const classes = [...el.classList]
    .slice(0, 2)
    .map((c) => `.${c}`)
    .join('')
  return `${el.tagName.toLowerCase()}${classes}`
}
const clock = () => {
  const now = new Date()
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`
}

const cssVar = (el: Element, name: string) =>
  getComputedStyle(el).getPropertyValue(name).trim() || '—'

function read(): string[] {
  const root = document.documentElement
  const viewport = window.visualViewport
  const containers = document.querySelectorAll('.modal-container')
  const container = containers.item(containers.length - 1)
  const modal = container?.querySelector('.modal') ?? null
  const active = document.activeElement
  const focused = active && active !== document.body ? active : null
  const report = keyboardRoomReport.last
  const out = [
    `inner ${window.innerWidth}×${window.innerHeight}  outer ${window.outerWidth}×${window.outerHeight}  client h ${root.clientHeight}`,
    viewport
      ? `visualViewport h ${round(viewport.height)} w ${round(viewport.width)} offsetTop ${round(viewport.offsetTop)} pageTop ${round(viewport.pageTop)}`
      : 'visualViewport none',
    `${KEYBOARD_VAR} inline ${root.style.getPropertyValue(KEYBOARD_VAR) || '—'} computed ${cssVar(root, KEYBOARD_VAR)} (${keyboardVar(document)})`,
    `safe-area top ${cssVar(document.body, '--safe-area-inset-top')} bottom ${cssVar(document.body, '--safe-area-inset-bottom')}  scrollY ${round(window.scrollY)}`,
    `body ${[...document.body.classList].filter((c) => TELLING.test(c)).join(' ') || '—'}`,
    `.modal-container ${rect(container)}${container?.classList.contains('abele-keyboard-room') ? ' FITTED' : ''}${container?.classList.contains('abele-keyboard-cover') ? ' COVERED' : ''}${container?.classList.contains('abele-keyboard-lift') ? ' LIFTED' : ''}`,
    `.modal ${rect(modal)}`,
    `focus ${describe(focused)} ${focused ? rect(focused) : ''}`,
  ]
  if (report) {
    const room = report.room ? `${round(report.room[0])}+${round(report.room[1])}` : 'none'
    out.push(
      `room ${room}  vvBottom ${report.viewportBottom === null ? '—' : round(report.viewportBottom)} kbTop ${report.keyboardTop === null ? '—' : round(report.keyboardTop)} kb ${round(report.keyboardHeight)} full ${round(report.fullHeight)} typing ${report.typing ? 'yes' : 'no'}${report.lift !== undefined ? ` lift ${round(report.lift)} cover ${round(report.cover ?? 0)}` : ''}`
    )
  }
  return out
}

const refresh = () => {
  lines.value = read()
}

const log = (text: string) => {
  events.value = [`${clock()} ${text}`, ...events.value].slice(0, EVENTS_KEPT)
  refresh()
}

const onKeyboard = (event: Event) => {
  const detail = event as Event & { keyboardHeight?: unknown; hasPhysicalKeyboard?: unknown }
  const extra = [
    detail.keyboardHeight !== undefined ? `h=${JSON.stringify(detail.keyboardHeight)}` : '',
    detail.hasPhysicalKeyboard !== undefined
      ? `physical=${JSON.stringify(detail.hasPhysicalKeyboard)}`
      : '',
  ]
    .filter(Boolean)
    .join(' ')
  log(`${event.type} ${extra}`.trim())
}
const onViewport = (event: Event) =>
  log(
    `vv.${event.type} h ${round(window.visualViewport?.height ?? 0)} top ${round(window.visualViewport?.offsetTop ?? 0)}`
  )
const onResize = () => log(`window.resize inner h ${window.innerHeight}`)
const onFocus = (event: FocusEvent) => log(`${event.type} ${describe(event.target as Element)}`)

let lastVar = ''
let lastClasses = ''
const observer = new MutationObserver(() => {
  const value = document.documentElement.style.getPropertyValue(KEYBOARD_VAR)
  if (value !== lastVar) {
    lastVar = value
    log(`${KEYBOARD_VAR} → ${value || '(removed)'}`)
  }
  const classes = [...document.body.classList].filter((c) => TELLING.test(c)).join(' ')
  if (classes !== lastClasses) {
    lastClasses = classes
    log(`body → ${classes || '—'}`)
  }
})

let timer = 0

onMounted(() => {
  lastVar = document.documentElement.style.getPropertyValue(KEYBOARD_VAR)
  lastClasses = [...document.body.classList].filter((c) => TELLING.test(c)).join(' ')
  for (const name of KEYBOARD_EVENTS) window.addEventListener(name, onKeyboard)
  window.visualViewport?.addEventListener('resize', onViewport)
  window.visualViewport?.addEventListener('scroll', onViewport)
  window.addEventListener('resize', onResize)
  document.addEventListener('focusin', onFocus)
  document.addEventListener('focusout', onFocus)
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['style'] })
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] })
  // Sizes change with no event at all — a dialog sliding in, a field scrolled — so the panel
  // also reads everything a few times a second.
  timer = window.setInterval(refresh, 250)
  refresh()
})

onBeforeUnmount(() => {
  for (const name of KEYBOARD_EVENTS) window.removeEventListener(name, onKeyboard)
  window.visualViewport?.removeEventListener('resize', onViewport)
  window.visualViewport?.removeEventListener('scroll', onViewport)
  window.removeEventListener('resize', onResize)
  document.removeEventListener('focusin', onFocus)
  document.removeEventListener('focusout', onFocus)
  observer.disconnect()
  window.clearInterval(timer)
})

// Read once before mounting too, so the first frame already says something.
refresh()
</script>

<style lang="scss">
.abele-keyboard-diagnostics {
  margin: 4px;
  /* Below the notch and the status bar, which would hide the first lines. */
  margin-top: calc(var(--safe-area-inset-top, 0px) + 4px);
  padding: 4px 6px;
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.78);
  color: #d8ffd8;
  font-family: var(--font-monospace, monospace);
  font-size: 10px;
  line-height: 1.3;
  white-space: pre-wrap;
  word-break: break-all;
  user-select: none;
}

.abele-keyboard-diagnostics__events {
  margin-top: 3px;
  padding-top: 3px;
  border-top: 1px solid rgba(255, 255, 255, 0.25);
  color: #ffe9a8;
}
</style>
