<template>
  <div
    v-if="state.showKeys"
    class="abele-book-eink__keys"
    role="status"
    aria-live="polite"
    data-ignore-swipe="true"
  >
    <template v-if="state.heard">
      <span class="abele-book-eink__key">{{ state.heard.key || '(no name)' }}</span>
      <span>code {{ state.heard.code || '(empty)' }}</span>
      <span>keyCode {{ state.heard.keyCode }}</span>
      <span>{{ whereText }}</span>
      <span>{{ wayText }}</span>
    </template>
    <span v-else>Press a key or a page button: what the reader hears shows here.</span>
  </div>
  <div
    v-if="flash"
    class="abele-book-eink__flash"
    :class="`abele-book-eink__flash_${flash}`"
    aria-hidden="true"
  />
</template>

<script setup lang="ts">
/**
 * What e-ink mode (`src/reader/eink.ts`) puts over the page: the last key the reader heard, while
 * the keys are shown — so the owner of a reader can tell what its page buttons send — and the
 * black-then-white flash every so many pages that clears an e-ink screen's ghosting. Its
 * stylesheet is the mode's whole look, hung off the book tab's `abele-book_eink` class.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { eink, flashDue } from '@/reader/eink'
import type { BookModel } from '@/reader/model'

const props = defineProps<{ model: BookModel }>()

const state = eink()

const whereText = computed(
  () =>
    ({ page: 'on the page', tab: 'in the tab', app: 'in the app' })[state.heard?.where ?? ''] ??
    state.heard?.where
)
const wayText = computed(() => {
  switch (state.heard?.way) {
    case 'next':
      return 'turned forward'
    case 'prev':
      return 'turned back'
    case 'left':
      return 'turned left'
    case 'right':
      return 'turned right'
    default:
      return 'turned nothing'
  }
})

/** The flash showing now: the ink, then the paper, then gone. */
const flash = ref<'ink' | 'paper' | null>(null)
let timer = 0
const FLASH_MS = 150
watch(
  () => props.model.turns,
  (turns) => {
    if (!state.on || !flashDue(turns, state.refreshEvery)) return
    window.clearTimeout(timer)
    flash.value = 'ink'
    timer = window.setTimeout(() => {
      flash.value = 'paper'
      timer = window.setTimeout(() => (flash.value = null), FLASH_MS)
    }, FLASH_MS)
  }
)
onBeforeUnmount(() => window.clearTimeout(timer))
</script>

<style lang="scss">
.abele-book-eink__keys {
  position: absolute;
  inset-block-start: var(--size-4-2);
  inset-inline: var(--size-4-4);
  z-index: 3;
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--size-2-1) var(--size-4-3);
  padding: var(--size-4-1) var(--size-4-2);
  border: var(--border-width) solid var(--text-normal);
  border-radius: var(--radius-s);
  background-color: var(--background-primary);
  color: var(--text-normal);
  font-size: var(--font-ui-small);
  font-family: var(--font-monospace);
  pointer-events: none;
}

.abele-book-eink__key {
  font-weight: var(--font-bold);
}

.abele-book-eink__flash {
  position: absolute;
  inset: 0;
  z-index: 4;
  pointer-events: none;

  &_ink {
    background-color: var(--text-normal);
  }

  &_paper {
    background-color: var(--background-primary);
  }
}

/* E-ink mode, on the book tab and nothing outside it: black on white whatever the theme — the
   platform's own paper and ink under a light scheme, which an e-ink screen shows as they are —
   nothing grey or faint, lines drawn thicker, nothing that moves, fades or casts a shadow. */
.view-content.abele-book_eink {
  color-scheme: light;
  --text-normal: CanvasText;
  --text-muted: CanvasText;
  --text-faint: CanvasText;
  --text-accent: CanvasText;
  --text-accent-hover: CanvasText;
  --icon-color: CanvasText;
  --icon-color-hover: CanvasText;
  --icon-color-active: CanvasText;
  --icon-opacity: 1;
  --interactive-accent: CanvasText;
  --background-primary: Canvas;
  --background-secondary: Canvas;
  --background-modifier-border: CanvasText;
  --background-modifier-hover: transparent;
  --abele-eink-rule: calc(var(--border-width) * 2);

  color: var(--text-normal);
  background-color: var(--background-primary);

  &,
  & * {
    transition: none !important;
    animation: none !important;
    scroll-behavior: auto !important;
    box-shadow: none !important;
  }

  &:focus {
    outline: none;
  }

  .abele-book-reader__foot,
  .abele-book-selection {
    border-top: var(--abele-eink-rule) solid var(--text-normal);
  }

  .abele-book-reader__panel {
    border-inline-end: var(--abele-eink-rule) solid var(--text-normal);
  }

  .abele-book-reader__panel-head {
    border-bottom: var(--abele-eink-rule) solid var(--text-normal);
  }

  /* A PDF's pages on the paper, edged by a line rather than a shadow. */
  .abele-book__engine_pdf::part(filter) {
    outline: var(--border-width) solid var(--text-normal);
  }

  /* Pressed is drawn inverted, not in a pale tint. */
  .abele-obsidian-icon_active {
    background-color: var(--text-normal);
    color: var(--background-primary);
    --icon-color: Canvas;
  }

  /* The highlight colours, drawn as the shape each takes on the page, around a sample. */
  .abele-book-selection__shape .abele-obsidian-icon__text {
    padding: 0 var(--size-2-1);
    line-height: 1.2;
    font-weight: var(--font-bold);
  }

  .abele-book-selection__shape_underline .abele-obsidian-icon__text {
    border-bottom: var(--abele-eink-rule) solid currentColor;
  }

  .abele-book-selection__shape_double .abele-obsidian-icon__text {
    border-bottom: calc(var(--border-width) * 4) double currentColor;
  }

  .abele-book-selection__shape_dashed .abele-obsidian-icon__text {
    border-bottom: var(--abele-eink-rule) dashed currentColor;
  }

  .abele-book-selection__shape_over-under .abele-obsidian-icon__text {
    border-block: var(--abele-eink-rule) solid currentColor;
  }

  .abele-book-selection__shape_box .abele-obsidian-icon__text {
    border: var(--abele-eink-rule) solid currentColor;
  }

  .abele-book-selection__shape_dashed-box .abele-obsidian-icon__text {
    border: var(--abele-eink-rule) dashed currentColor;
  }
}
</style>
