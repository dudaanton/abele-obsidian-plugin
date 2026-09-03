<template>
  <Teleport v-if="wrapper" :to="wrapper">
    <slot :id="id" class="abele-modal" />
  </Teleport>
</template>

<script setup lang="ts">
import { genid } from '@/helpers/vueUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { App, Modal } from 'obsidian'
import { onBeforeMount, onMounted, onUnmounted, ref, shallowRef } from 'vue'

const props = defineProps<{
  title?: string
  /**
   * `wide` for a form that needs more than Obsidian's default column; `sheet` for a body that
   * fills the dialog's height and scrolls inside it rather than growing it.
   */
  size?: 'default' | 'wide' | 'sheet'
}>()

const modal = ref<Modal | null>(null)

const id = ref(genid())
// Teleport by element, not by selector: a modal opened from the settings window
// lives in that window's document, which `document.querySelector` never sees.
const wrapper = shallowRef<HTMLElement | null>(null)

class ObsidianModal extends Modal {
  constructor(app: App) {
    super(app)
  }

  onClose(): void {
    super.onClose()
    emit('close')
  }
}

/**
 * The visible viewport, written onto the dialog as two lengths.
 *
 * Obsidian sizes a modal against the window — `100vh` on a phone, `85vh` on the desktop — and
 * the window does not shrink when the on-screen keyboard comes up. A sheet sized that way goes
 * on growing behind the keyboard and the field a person is typing in is the first row to go
 * under it, which is what a phone reported of 1.16.0. `visualViewport` is the only thing that
 * says how much of the window is actually being looked at: its `height` is the band left over
 * and its `offsetTop` is where that band starts once iOS has scrolled a focused field into
 * view. Both go onto the dialog element, and the stylesheet below caps the sheet with them.
 *
 * Written from here rather than from a rule because CSS has no way to ask: there is no unit
 * for the visible viewport that the keyboard moves. `100dvh` is the closest, and it is the
 * fallback the rules carry for the desktop and for anything without a `visualViewport`.
 */
let viewport: VisualViewport | null = null
let readViewport: (() => void) | null = null

function trackViewport(el: HTMLElement): void {
  // From the element's own window, not the bare global: a modal opened from the settings
  // window belongs to that window, and its viewport is not the main one's.
  const view = el.ownerDocument.defaultView
  const visible = view?.visualViewport
  if (!visible) return

  viewport = visible
  readViewport = () => {
    el.style.setProperty('--abele-sheet-height', `${visible.height}px`)
    el.style.setProperty('--abele-sheet-offset', `${visible.offsetTop}px`)
  }
  readViewport()

  // `scroll` as well as `resize`: iOS moves the visible band without resizing it whenever it
  // brings a focused field up, and a sheet that only heard `resize` would stay where it was.
  visible.addEventListener('resize', readViewport)
  visible.addEventListener('scroll', readViewport)
}

function untrackViewport(): void {
  if (viewport && readViewport) {
    viewport.removeEventListener('resize', readViewport)
    viewport.removeEventListener('scroll', readViewport)
  }
  viewport = null
  readViewport = null
}

onBeforeMount(() => {
  const { app } = GlobalStore.getInstance()

  modal.value = new ObsidianModal(app)

  if (props.size === 'wide') {
    modal.value.modalEl.addClass('abele-modal_wide')
  }
  if (props.size === 'sheet') {
    modal.value.modalEl.addClass('abele-modal_sheet')
  }

  const contentEl = modal.value.contentEl
  // Through `doc.win`, not the bare global: the global factory is bound to the main window's
  // document, and the mount point has to belong to the window the modal opened in.
  const el = contentEl.doc.win.createDiv()
  el.id = id.value
  // Named, not just numbered: the sheet's stylesheet has to reach this element, and the id is
  // a fresh one per dialog. Reaching it as `.modal-content > div` would tie every rule to the
  // shape of the DOM this component happens to build.
  el.addClass('abele-modal__body')
  contentEl.appendChild(el)
  wrapper.value = el
  if (props.title) {
    modal.value.setTitle(props.title)
  }

  modal.value.open()

  // After `open()`, which is when the dialog is in a document and has a window to ask.
  if (props.size === 'sheet') trackViewport(modal.value.modalEl)
})

onMounted(() => {
  emit('expose-id', id.value)
})

onUnmounted(() => {
  // Before the dialog goes: a listener left on the viewport is a leak per dialog opened, and
  // it would go on writing lengths onto an element nobody is looking at.
  untrackViewport()
  modal.value?.close()
  modal.value = null
})

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'expose-id', id: string): void
}>()
</script>

<style lang="scss">
/**
 * Obsidian's default modal is a reading-width column. A form with its own navigation needs
 * more, but never more than the window it opens in — settings can be a 900px window of its
 * own, and on a phone the modal is the whole screen.
 */
.abele-modal_wide {
  width: min(52rem, 92vw);
  max-width: min(52rem, 92vw);
}

/**
 * A sheet: the body fills the dialog and scrolls inside it.
 *
 * Obsidian sizes `.modal` at `max-height: var(--dialog-max-height)` — `85vh` on the desktop,
 * `calc(100vh - var(--safe-area-inset-top))` on a phone. Both are the *window*, and the
 * window is not what a person can see once the keyboard is up. So the cap is the smaller of
 * Obsidian's own and the band `visualViewport` reported, which the script above writes here.
 * `100dvh` is the fallback: the nearest CSS has to the same idea, and right wherever there is
 * no keyboard to account for.
 *
 * The other half is that Obsidian's boxes are not columns, so a child asking to scroll grows
 * the dialog instead and pushes whatever follows it off the bottom. Three boxes stand between
 * that height and the content: the modal, its content element, and the mount point this
 * component appends as `.abele-modal__body` — the last is ours, and it is why these rules
 * cannot live in the screen above.
 */
.abele-modal_sheet {
  display: flex;
  flex-direction: column;
  max-height: min(var(--dialog-max-height, 100%), var(--abele-sheet-height, 100dvh));
  /**
   * The one scroller in a sheet is the body's. `.modal` is `overflow: auto`, and a dialog that
   * scrolls itself scrolls the composer out of sight, which is the defect this rule is about.
   */
  overflow: hidden;
  /**
   * Obsidian pads `.modal` at `var(--size-4-4)` and then zeroes the vertical half of it on a
   * phone (`.is-phone .modal` keeps only the left and right insets). Nothing of theirs puts
   * the top of a dialog below the notch or its bottom above the home indicator, so the sheet
   * asks for both — never less than the padding a dialog has anyway.
   *
   * `--safe-area-inset-*` first, `env()` second: Obsidian defines the variables from `env()`
   * at `:root` and overrides them under `body.emulate-mobile`, which is the only way a
   * desktop build can be made to show the insets at all.
   */
  padding-top: max(var(--size-4-4), var(--safe-area-inset-top, env(safe-area-inset-top, 0px)));
  padding-bottom: max(
    var(--size-4-4),
    var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))
  );
}

/**
 * On a phone the sheet *is* the visible band, top to bottom.
 *
 * Three of Obsidian's rules have to be answered here and nowhere else.
 *
 * `.modal-container` centres its dialog and spans the whole window, so a sheet merely capped
 * at the visible height would sit in the middle of the window with half of it behind the
 * keyboard; pinned to the top of the band instead, and given the band's height, it ends where
 * the keyboard begins. `--dialog-max-height` is `calc(100vh - var(--safe-area-inset-top))` on
 * a phone, which takes the notch out of the *box* — but the box is the background, and taking
 * it out twice leaves a strip of window showing at the bottom; the padding above is what keeps
 * the content clear of the notch, so here the band alone is the cap. And `.is-phone .modal`
 * sets `padding: 0 …` with two class names, which outweighs the rule above: the vertical half
 * has to be asked for again from a selector that can win.
 *
 * The desktop keeps Obsidian's centred dialog — there the cap is all that is wanted.
 */
body.is-phone .abele-modal_sheet {
  align-self: flex-start;
  margin-top: var(--abele-sheet-offset, 0px);
  height: var(--abele-sheet-height, 100dvh);
  max-height: var(--abele-sheet-height, 100dvh);
  padding-top: max(var(--size-4-4), var(--safe-area-inset-top, env(safe-area-inset-top, 0px)));
  padding-bottom: max(
    var(--size-4-4),
    var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))
  );
}

.abele-modal_sheet .modal-content,
.abele-modal_sheet .abele-modal__body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  /* Same reason as the dialog's own: whatever scrolls in a sheet, it is not the frame. */
  overflow: hidden;
}
</style>
