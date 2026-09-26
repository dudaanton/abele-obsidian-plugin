<template>
  <FloatingButton
    v-if="!gone"
    ref="floating"
    icon="zap"
    label="Open the quick menu"
    :side="side"
    :tucked="tucked && !dragging && !menuOpen"
    :dragging="dragging"
    :expanded="menuOpen"
    @pointerdown="onDown"
    @pointermove="onMove"
    @pointerup="onUp"
    @pointercancel="onCancel"
    @click="onClick"
    @keydown.enter.prevent="openMenu"
    @keydown.space.prevent="openMenu"
  />
</template>

<script setup lang="ts">
/**
 * The quick button: a round button floating at the edge of a phone's screen that opens the
 * quick menu for whatever is in front — see `src/quickButton/`.
 *
 * A tap opens the menu. A drag moves the button: let go, it goes to the nearer edge and keeps
 * the height it was left at, above wherever it rests on each screen. Both are saved, so it is
 * where it was left on the next start and on the user's other devices.
 */
import { computed, ref } from 'vue'
import FloatingButton from '../obsidian/FloatingButton.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { AbeleConfig } from '@/services/AbeleConfig'
import { useQuickButton } from '@/quickButton/useQuickButton'
import { liftFor, sideFor } from '@/quickButton/placement'
import { openQuickMenu } from '@/quickButton/open'

const app = GlobalStore.getInstance().app
const config = AbeleConfig.getInstance()

const floating = ref<{ el?: HTMLElement } | null>(null)
const el = computed(() => floating.value?.el ?? null)
const { settings, gone, tucked, line, untuck } = useQuickButton(app, el)

const side = computed(() => settings.value.side)
const menuOpen = ref(false)
const dragging = ref(false)

/** How far a finger may wander and still be a tap rather than a drag. */
const SLOP = 8

let start: { x: number; y: number; top: number; id: number } | null = null
let top = 0
/** A press ended without a drag, so the click that follows it opens the menu. */
let tapped = false

const onDown = (event: PointerEvent) => {
  const button = el.value
  if (!button || event.button > 0) return
  start = {
    x: event.clientX,
    y: event.clientY,
    top: button.getBoundingClientRect().top,
    id: event.pointerId,
  }
  top = start.top
  button.setPointerCapture?.(event.pointerId)
}

const onMove = (event: PointerEvent) => {
  const button = el.value
  if (!start || !button || event.pointerId !== start.id) return
  const dx = event.clientX - start.x
  const dy = event.clientY - start.y
  if (!dragging.value && Math.hypot(dx, dy) < SLOP) return
  dragging.value = true
  const max = window.innerHeight - button.offsetHeight
  top = Math.min(max, Math.max(0, start.top + dy))
  button.style.setProperty('--abele-floating-button-top', `${Math.round(top)}px`)
  button.style.setProperty('--abele-floating-button-shift', `${Math.round(dx)}px`)
}

const onUp = (event: PointerEvent) => {
  const button = el.value
  if (!start || event.pointerId !== start.id) return
  const wasDrag = dragging.value
  start = null
  // The menu opens on the click that ends the tap, not here: a touch is followed by mouse
  // events, and a menu shown now had its backdrop under them and closed at once.
  tapped = !wasDrag
  if (!wasDrag || !button) return
  const rect = button.getBoundingClientRect()
  const gap = parseFloat(getComputedStyle(document.body).getPropertyValue('--size-4-3')) || 12
  const next = {
    ...settings.value,
    side: sideFor(rect.left + rect.width / 2, window.innerWidth),
    lift: liftFor({ top, line: line.value, size: button.offsetHeight, gap }),
  }
  button.style.removeProperty('--abele-floating-button-shift')
  dragging.value = false
  config.quickButton = next
  void config.saveSettings()
}

const onClick = () => {
  if (!tapped) return
  tapped = false
  openMenu()
}

const onCancel = () => {
  tapped = false
  start = null
  dragging.value = false
  el.value?.style.removeProperty('--abele-floating-button-shift')
}

const openMenu = () => {
  const button = el.value
  if (!button || menuOpen.value) return
  untuck()
  menuOpen.value = true
  const rect = button.getBoundingClientRect()
  openQuickMenu(app, { x: rect.left, y: rect.top }, () => {
    menuOpen.value = false
  })
}
</script>
