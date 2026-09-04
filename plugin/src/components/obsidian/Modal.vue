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
   * `wide` for a form that needs more than Obsidian's default column; `tall` for a body that
   * fills the height the dialog is allowed and scrolls inside it rather than growing it.
   */
  size?: 'default' | 'wide' | 'tall'
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
  overflow: hidden;
}

/**
 * The on-screen keyboard, which is the one thing Obsidian's own sizing does not take off a
 * dialog: `--dialog-max-height` is `calc(100vh - var(--safe-area-inset-top))` and the window
 * does not shrink when the keyboard comes up, so the last rows of a full-height sheet — the
 * composer, always — end up behind it. That was the 1.16.0 report from a phone.
 *
 * `--keyboard-height` is Obsidian's own variable, kept up to date by the app and `0px`
 * everywhere else; their mobile toolbar rides on it. Taking it *and* the notch off the height
 * and then pushing the sheet up by it leaves the dialog exactly the band that can be seen:
 * top edge under the notch, bottom edge on the keyboard.
 */
body.is-phone .modal.abele-modal_tall {
  height: calc(100% - var(--keyboard-height) - var(--safe-area-inset-top));
  margin-bottom: var(--keyboard-height);
  /* Their sheet has no vertical padding at all; the home indicator needs the bottom of it. */
  padding-bottom: var(--safe-area-inset-bottom);
}

</style>
