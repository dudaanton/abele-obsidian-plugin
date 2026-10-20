<template>
  <ObsidianModal
    :title="title"
    :size="size"
    :phone-sheet="!!details"
    :content-sized="!!details"
    close-in-footer
    @close="emit('close')"
  >
    <p v-for="(line, i) in lines" :key="i" class="abele-confirm__message">{{ line }}</p>
    <Disclosure
      v-if="details"
      v-model="expanded"
      :label="details.label"
      class="abele-confirm__details"
    >
      <p v-if="details.notice" class="abele-confirm__notice">{{ details.notice }}</p>
      <div class="abele-confirm__files" role="list" :aria-label="details.label" tabindex="0">
        <ListRow
          v-for="item in details.items"
          :key="item.path"
          :title="item.path"
          :icon="item.folder ? 'folder' : 'file'"
          class="abele-confirm__file"
          role="listitem"
        >
          <template #metadata
            ><Badge v-if="item.badge" :text="item.badge" color="orange"
          /></template>
        </ListRow>
      </div>
    </Disclosure>
    <template #footer>
      <Button :text="t('kit.cancel')" :tooltip="cancelTooltip" @click="emit('close')" />
      <Button
        :text="confirmText"
        :warning="!readOnly"
        :disabled="readOnly"
        :tooltip="confirmTooltip"
        @click="onConfirm"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, ref } from 'vue'
import ObsidianModal from './Modal.vue'
import Button from './Button.vue'
import type { ShellSize } from '@/modal/ShellModal'
import type { ConfirmationDetails } from './confirmationDetails'
import Disclosure from './Disclosure.vue'
import ListRow from './ListRow.vue'
import Badge from './Badge.vue'

/**
 * Asks before something is destroyed.
 *
 * Deliberately not `window.confirm`: that dialog is the operating system's, ignores the
 * theme, and blocks the whole app — including the separate window settings can open in.
 */
const props = withDefaults(
  defineProps<{
    title: string
    /** The shell's size; `tall` for a message as long as its data, a list of paths. */
    size?: ShellSize
    /** What will be lost, named. Each line is its own paragraph. */
    message: string
    details?: ConfirmationDetails
    confirmText?: string
    confirmTooltip?: string
    cancelTooltip?: string
    readOnly?: boolean
  }>(),
  {
    size: 'default',
    details: undefined,
    readOnly: false,
    confirmText: () => t('kit.delete'),
    confirmTooltip: () => t('kit.deleteTooltip'),
    cancelTooltip: () => t('kit.cancelTooltip'),
  }
)

const lines = computed(() => props.message.split('\n'))
const expanded = ref(false)

const emit = defineEmits<{
  (e: 'confirm'): void
  /** The same yes, for `confirmDialog()`, which awaits every kit dialog's answer alike. */
  (e: 'answer', value: true): void
  (e: 'close'): void
}>()

function onConfirm(): void {
  if (props.readOnly) return
  emit('confirm')
  emit('answer', true)
  emit('close')
}
</script>

<style lang="scss">
.abele-confirm__message {
  margin: 0;
  overflow-wrap: anywhere;
}
.abele-confirm__details {
  margin-top: var(--size-4-3);
}
.abele-confirm__notice {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
.abele-confirm__files {
  max-height: min(40vh, 20rem);
  overflow-y: auto;
}
.abele-confirm__file .abele-list-row__title-text {
  display: block;
  -webkit-line-clamp: unset;
  overflow: visible;
}
</style>
