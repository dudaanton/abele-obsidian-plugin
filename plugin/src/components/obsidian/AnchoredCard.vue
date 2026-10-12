<template>
  <!-- A card standing by a place in the text, as a link's preview stands by the link: under the
       line it belongs to, above it when there is no room below, never off the screen. -->
  <Teleport :to="to">
    <div
      ref="card"
      v-bind="$attrs"
      class="abele-anchored-card"
      role="dialog"
      :aria-label="label"
      :style="place"
      @keydown.esc.stop.prevent="emit('close')"
    >
      <slot />
    </div>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue'

/** Where the place in the text is on the screen, in the window's pixels. */
export type CardAnchor = { left: number; top: number; bottom: number }

// The card is drawn into the window, so what the caller sets on it goes on the card itself.
defineOptions({ inheritAttrs: false })

const props = defineProps<{
  anchor: CardAnchor
  label: string
  /** Pressing outside the card closes it, unless this says no (a save still running). */
  canClose?: () => boolean | Promise<boolean>
  to?: string | HTMLElement
}>()
const emit = defineEmits<{ close: [] }>()

const to = computed(() => props.to ?? 'body')
const card = ref<HTMLElement>()
const height = ref(0)

const GAP = 6
const place = computed(() => {
  const win = card.value?.ownerDocument.defaultView ?? window
  const width = Math.min(card.value?.offsetWidth ?? 0, win.innerWidth - 2 * GAP)
  const left = Math.max(GAP, Math.min(props.anchor.left, win.innerWidth - width - GAP))
  const below = props.anchor.bottom + GAP
  const fits = below + height.value <= win.innerHeight - GAP
  const top = fits ? below : Math.max(GAP, props.anchor.top - GAP - height.value)
  return { left: `${left}px`, top: `${top}px` }
})

const measure = () => {
  height.value = card.value?.offsetHeight ?? 0
}
let resize: ResizeObserver | undefined

const outside = async (e: PointerEvent) => {
  if (card.value?.contains(e.target as Node)) return
  // A menu opened from inside the card lives outside it, and is still part of it.
  if ((e.target as HTMLElement | null)?.closest?.('.menu, .modal-container')) return
  if (props.canClose && !(await props.canClose())) return
  emit('close')
}

onMounted(async () => {
  await nextTick()
  measure()
  resize = new ResizeObserver(measure)
  if (card.value) resize.observe(card.value)
  card.value?.ownerDocument.addEventListener('pointerdown', outside, true)
})
onBeforeUnmount(() => {
  resize?.disconnect()
  card.value?.ownerDocument.removeEventListener('pointerdown', outside, true)
})
</script>

<style lang="scss">
// Obsidian's own floating surface: the note's background, a hairline, its popover shadow.
.abele-anchored-card {
  position: fixed;
  z-index: var(--layer-popover);
  display: flex;
  flex-direction: column;
  box-sizing: border-box;
  width: min(26rem, calc(100vw - var(--size-4-3)));
  max-height: min(32rem, 60vh);
  padding: var(--size-4-3);
  overflow: hidden;
  background: var(--background-primary);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-l);
  box-shadow: var(--shadow-l);
}
</style>
