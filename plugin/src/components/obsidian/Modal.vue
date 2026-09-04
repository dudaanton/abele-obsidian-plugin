<template>
  <Teleport v-if="wrapper" :to="wrapper">
    <slot :id="id" class="abele-modal" />
  </Teleport>
</template>

<script setup lang="ts">
import { genid } from '@/helpers/vueUtils'
import { dialogBand } from '@/helpers/dialogBand'
import { GlobalStore } from '@/stores/GlobalStore'
import { App, Modal } from 'obsidian'
import { onBeforeMount, onMounted, onUnmounted, ref, shallowRef } from 'vue'

const props = defineProps<{
  title?: string
  /**
   * `wide` for a form that needs more than Obsidian's default column; `tall` for a body that
   * fills the height the dialog is allowed and scrolls inside it rather than growing it.
   */
  size?: 'default' | 'wide' | 'tall'
}>()

const modal = ref<Modal | null>(null)

/**
 * The band a tall dialog may stand in, written onto the dialog as two lengths.
 *
 * Measured rather than assumed: see `dialogBand`. The container is asked how tall it is *now*
 * and `visualViewport` which part of that can be seen *now*, so the answer holds whether the
 * platform shrinks the page under the keyboard or leaves it alone. Written from here because
 * CSS cannot ask either question — there is no unit for "the part of the window that is not
 * behind the keyboard".
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

  /**
   * The window as it stands with nothing over it.
   *
   * Remembered rather than read, because on a platform that shrinks the page for the keyboard
   * `innerHeight` shrinks with it — and then "how much of the window is covered" answers zero
   * and the keyboard is taken off a second time. The tallest this window has been at this
   * width is the honest answer, and it cannot be poisoned by the order two events arrive in.
   * The width is what resets it: a keyboard never changes that, and a rotation always does.
   */
  let full = view.innerHeight || visible.height
  let width = view.innerWidth

  readViewport = () => {
    if (view.innerWidth !== width) {
      width = view.innerWidth
      full = view.innerHeight || full
    } else {
      full = Math.max(full, view.innerHeight || 0)
    }

    const styles = view.getComputedStyle(el)
    // Obsidian's own, kept up to date by the app on mobile and `0px` everywhere else.
    const keyboard = parseFloat(styles.getPropertyValue('--keyboard-height')) || 0

    const band = dialogBand({
      container: el.parentElement?.clientHeight || visible.height,
      visible: visible.height,
      visibleTop: visible.offsetTop,
      keyboard,
      window: full,
    })
    el.style.setProperty('--abele-dialog-height', `${band.height}px`)
    el.style.setProperty('--abele-dialog-bottom', `${band.bottom}px`)
  }
  readViewport()

  // `scroll` as well as `resize`: iOS moves the visible band without resizing it whenever it
  // brings a focused field up, and a dialog that only heard `resize` would stay where it was.
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

onBeforeMount(() => {
  const { app } = GlobalStore.getInstance()

  modal.value = new ObsidianModal(app)

  if (props.size === 'wide') {
    modal.value.modalEl.addClass('abele-modal_wide')
  }
  if (props.size === 'tall') {
    // `mod-lg` is Obsidian's own, and asking for it is the point: on a phone their rules make
    // it the sheet they draw for every big dialog of theirs — full width, pinned to the bottom
    // of the screen, its top edge below the notch and its close button with it. A geometry of
    // our own put that button under the status bar once already.
    modal.value.modalEl.addClass('abele-modal_tall')
    modal.value.modalEl.addClass('mod-lg')
  }

  const contentEl = modal.value.contentEl
  // Through `doc.win`, not the bare global: the global factory is bound to the main window's
  // document, and the mount point has to belong to the window the modal opened in.
  const el = contentEl.doc.win.createDiv()
  el.id = id.value
  // Named, not just numbered: a stylesheet reaching this element as `.modal-content > div`
  // would tie every rule to the shape of the DOM this component happens to build.
  el.addClass('abele-modal__body')
  contentEl.appendChild(el)
  wrapper.value = el
  if (props.title) {
    modal.value.setTitle(props.title)
  }

  modal.value.open()

  // After `open()`, which is when the dialog is in a document and has a container to measure.
  if (props.size === 'tall') trackViewport(modal.value.modalEl)
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
 * A tall dialog: the body fills the dialog and scrolls inside it.
 *
 * Obsidian's `.modal` is already a flex column capped at `--dialog-max-height`, and `mod-lg`
 * on a phone already makes it their bottom sheet. What is missing is that the boxes between
 * that height and the content — the content element and the mount point this component
 * appends — are not columns, so a child asking to scroll grows the dialog instead and pushes
 * whatever follows it off the bottom. That, and the dialog scrolling itself, which scrolls a
 * composer out of sight.
 */
.abele-modal_tall {
  overflow: hidden;
}

.abele-modal_tall .modal-content,
.abele-modal_tall .abele-modal__body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
}

/**
 * The on-screen keyboard, which is the one thing Obsidian's own sizing does not take off a
 * dialog: `--dialog-max-height` is the *window*, and the last rows of a full-height sheet —
 * the composer, always — end up behind the keyboard. That was the 1.16.0 report from a phone.
 *
 * The two lengths are measured and written by the script above; see `dialogBand` for why they
 * are not `--keyboard-height`. `100%` and `0px` are the fallback, which is every case with no
 * keyboard to account for — a desktop, a tablet, a window with no `visualViewport` at all.
 */
body.is-phone .modal.abele-modal_tall {
  height: calc(var(--abele-dialog-height, 100%) - var(--safe-area-inset-top));
  margin-bottom: var(--abele-dialog-bottom, 0px);
  /**
   * A floor, and the reason for it: the height above is arithmetic over numbers a platform
   * reports, and the way that goes wrong is a sheet too short to hold anything — which is
   * exactly what a phone saw in 1.17.2, a white dialog with the header and nothing under it.
   * Standing too tall is a thing a person can read and scroll; standing empty is not.
   */
  min-height: min(100%, 16em);
  /* Their sheet has no vertical padding at all; the home indicator needs the bottom of it. */
  padding-bottom: var(--safe-area-inset-bottom);
}
</style>
