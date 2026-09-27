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
