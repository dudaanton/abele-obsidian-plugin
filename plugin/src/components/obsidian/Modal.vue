<template>
  <Teleport v-if="wrapper" :to="wrapper">
    <slot :id="id" class="abele-modal" />
  </Teleport>
  <Teleport v-if="footer" :to="footer">
    <slot name="footer" />
  </Teleport>
</template>

<script setup lang="ts">
import { genid } from '@/helpers/vueUtils'
import { GlobalStore } from '@/stores/GlobalStore'
import { App, Modal } from 'obsidian'
import { onBeforeMount, onMounted, onUnmounted, ref, shallowRef, useSlots } from 'vue'
import { useKeyboardRoom } from '@/composables/useKeyboardRoom'

const props = defineProps<{
  title?: string
  /**
   * `wide` for a form that needs more than Obsidian's default column; `tall` for a body that
   * fills the height the dialog is allowed and scrolls inside it rather than growing it;
   * `full` for something that wants every bit of room a dialog may have, a diagram viewed
   * full screen.
   */
  size?: 'default' | 'wide' | 'tall' | 'full'
}>()

const modal = ref<Modal | null>(null)

const id = ref(genid())
// Teleport by element, not by selector: a modal opened from the settings window
// lives in that window's document, which `document.querySelector` never sees.
const wrapper = shallowRef<HTMLElement | null>(null)
/**
 * The row under the body, for a form's buttons: the body scrolls and this stays in sight. Given
 * as the `footer` slot; a dialog without one has no row and scrolls the way it always did.
 */
const footer = shallowRef<HTMLElement | null>(null)
const slots = useSlots()

// Every dialog of the plugin stands above the on-screen keyboard while one of its fields is
// being typed into — the date dialog was the one reported, the script forms and chat setup
// have the same fields.
useKeyboardRoom(wrapper)

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
  if (props.size === 'full') {
    // Their big dialog as well, for the same reason as `tall`: on a phone that is the sheet
    // with its top edge and close button placed by their rules.
    modal.value.modalEl.addClass('abele-modal_full')
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
  if (slots.footer) {
    const row = contentEl.doc.win.createDiv()
    row.addClass('abele-modal__footer')
    contentEl.appendChild(row)
    footer.value = row
    modal.value.modalEl.addClass('abele-modal_footed')
  }
  if (props.title) {
    modal.value.setTitle(props.title)
  }

  modal.value.open()
})

onMounted(() => {
  emit('expose-id', id.value)
})

onUnmounted(() => {
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
}

/**
 * The content element clips nothing: it stands exactly where the content does — on the desktop
 * it has no padding of its own — so anything that reaches past the content by design, the focus
 * ring a field draws outside its box, was cut at its edge (2026-09-05, twice).
 */
.abele-modal_tall .modal-content {
  overflow: visible;
}

/**
 * The body is what scrolls, when what it holds is taller than the dialog. A body that fills it
 * — a list under a search field, tabs over a panel — scrolls inside itself and this never has
 * anything to scroll; a form that simply runs long, the MCP server with its fetched tools, was
 * cut off at the dialog's edge instead, Save and all, with nothing to scroll it (2026-09-26).
 *
 * A scrolling box clips at its padding edge, so the padding is room for a field's focus ring,
 * pulled back by the same margin so the content stands where it would.
 */
.abele-modal_tall .abele-modal__body,
.abele-modal_footed .abele-modal__body {
  overflow-y: auto;
  padding: var(--size-2-2);
  margin: calc(-1 * var(--size-2-2));
}

/**
 * The dialog stands at Obsidian's own cap, whatever the tab holds. A height that followed the
 * content jumped from tab to tab — a short Tools tab under a tall Skills one — and on a phone
 * one that followed the keyboard did worse: `--keyboard-height` changes with no event to hear
 * it by, so a height computed from it once, when a search field took focus, stayed computed
 * after the keyboard had gone, and every tab showed a sheet cut off at the height of a
 * keyboard that was not there (1.19.1, from the phone). This dialog has no composer to keep
 * above the keyboard; a list whose bottom the keyboard covers scrolls, which is what every
 * list on the platform does. The cap is theirs, so it is never taller than the screen.
 */
.modal.abele-modal_tall {
  height: var(--dialog-max-height);
}

/**
 * A full dialog is as large as Obsidian lets any dialog be, in both directions, and its body is
 * a column whose one child takes whatever height is left under the title.
 */
.modal.abele-modal_full {
  width: var(--dialog-max-width);
  height: var(--dialog-max-height);
  overflow: hidden;
}

.abele-modal_full .modal-content,
.abele-modal_full .abele-modal__body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}

/**
 * A dialog with buttons under its body: the body scrolls between the title and the buttons, and
 * the dialog itself no longer does, so the buttons never scroll away with what is above them.
 */
.modal.abele-modal_footed {
  overflow: hidden;
}

.abele-modal_footed .modal-content {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow: visible;
}

.abele-modal_footed .abele-modal__body {
  flex: 1 1 auto;
  min-height: 0;
}

.abele-modal__footer {
  flex: 0 0 auto;
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
  justify-content: flex-end;
  padding-top: var(--size-4-3);
  margin-top: var(--size-4-2);
  border-top: 1px solid var(--background-modifier-border);
}

body.is-phone .modal.abele-modal_full,
body.is-phone .modal.abele-modal_tall {
  /* Their sheet has no vertical padding at all; the home indicator needs the bottom of it. */
  padding-bottom: var(--safe-area-inset-bottom);
}
</style>
