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
import { ShellModal, type ShellSize } from '@/modal/ShellModal'
import { onBeforeMount, onMounted, onUnmounted, ref, shallowRef, useSlots } from 'vue'

/**
 * A dialog: the shell (`ShellModal`) with its body and its pinned row as slots. The body scrolls
 * between the title and the `footer` slot, the dialog fits the screen, and the field being typed
 * into stays above a phone's keyboard — for every dialog alike.
 */
const props = defineProps<{
  title?: string
  /**
   * `wide` for a form that needs more than Obsidian's default column; `tall` for a body that
   * fills the height the dialog is allowed and scrolls inside it rather than growing it;
   * `full` for something that wants every bit of room a dialog may have, a diagram viewed
   * full screen.
   */
  size?: ShellSize
  /**
   * Obsidian's own `mod-lg` and nothing else, for a short dialog that should still be their sheet
   * on a phone — full width, pinned to the bottom, its top edge and close button placed by their
   * rules. Every rule they have for `mod-lg` is a phone rule, so on a desktop the dialog stays
   * sized to what it holds; `tall` and `full` ask for it already.
   */
  phoneSheet?: boolean
}>()

const modal = ref<ShellModal | null>(null)

const id = ref(genid())
// Teleport by element, not by selector: a modal opened from the settings window
// lives in that window's document, which `document.querySelector` never sees.
const wrapper = shallowRef<HTMLElement | null>(null)
/**
 * The row under the body, for a form's buttons: the body scrolls and this stays in sight. Given
 * as the `footer` slot; a dialog without one has no row.
 */
const footer = shallowRef<HTMLElement | null>(null)
const slots = useSlots()

onBeforeMount(() => {
  const { app } = GlobalStore.getInstance()

  modal.value = new (class extends ShellModal {
    onClose(): void {
      super.onClose()
      emit('close')
    }
  })(app, { title: props.title, size: props.size ?? 'default', footer: !!slots.footer })

  if (props.phoneSheet) modal.value.modalEl.addClass('mod-lg')
  const el = modal.value.bodyEl
  el.id = id.value
  wrapper.value = el
  footer.value = modal.value.footerEl

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
 * A dialog’s answer row stays visible while the body scrolls.
 * A dialog's answer row, `abele-modal__actions` on the element that holds its buttons: kept at
 * the bottom of the dialog while what is above it scrolls. A list of twenty long paths or three
 * choices with a name field under them is taller than a phone, and the buttons at the end of it
 * were under the bottom edge — on a desktop too, for the long list — where nobody looks for them.
 * Obsidian scrolls the dialog itself, so the row sticks to the bottom of that, the way the script
 * form's does. Only inside a dialog: the same block on a settings tab scrolls with the tab.
 *
 * The offset is the dialog's own bottom padding, which text would otherwise show through as it
 * scrolls past; the row reaches the edge and carries the padding itself. Their phone sheet has
 * none, and the home indicator's inset instead.
 */
.abele-modal__body .abele-modal__actions {
  position: sticky;
  bottom: calc(var(--size-4-4) * -1);
  z-index: 1;
  padding: var(--size-4-3) 0 var(--size-4-4);
  border-top: 1px solid var(--background-modifier-border);
  background-color: var(--modal-background, var(--background-primary));
}

body.is-phone .modal.mod-lg .abele-modal__body .abele-modal__actions {
  bottom: 0;
  padding-bottom: max(var(--size-4-4), var(--safe-area-inset-bottom));
}

</style>
