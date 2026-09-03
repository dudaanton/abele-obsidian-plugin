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
 * A sheet: the body fills the dialog and scrolls inside it.
 *
 * Nothing here sets a height. Obsidian already sizes `.modal` — capped on the desktop, the
 * whole screen on a phone, and shrunk by the on-screen keyboard when one opens. What is
 * missing is that its boxes are not columns, so a child asking to scroll grows the dialog
 * instead and pushes whatever follows it off the bottom. Three boxes stand between that
 * height and the content: the modal, its content element, and the mount point this component
 * appends — the last is ours, and it is why this rule cannot live in the screen above.
 */
.abele-modal_sheet {
  display: flex;
  flex-direction: column;
}

.abele-modal_sheet .modal-content,
.abele-modal_sheet .modal-content > div {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
}
</style>
