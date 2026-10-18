<template>
  <ObsidianModal
    :title="
      items.length === 1
        ? t('streamC.717a83ab80f40085')
        : t('streamC.97052c552b777c97', { v1: String(items.length) })
    "
    size="tall"
    close-in-footer
    @close="emit('close')"
  >
    <p>{{ t('streamC.89b61e26dae647e0') }}</p>
    <p>{{ t('streamC.b925122c694f1b9a') }}</p>
    <div v-for="item in items" :key="item.cfi">
      <strong>{{ item.label || t('streamC.3dcb92f3da02b21a') }}</strong>
      <p>“{{ item.text }}”</p>
      <p>{{ context(item) }}</p>
      <p v-if="!item.anchored">{{ t('streamC.eab3f0db4321c66e') }}</p>
    </div>
    <template #footer>
      <Button
        :text="t('kit.cancel')"
        :tooltip="t('streamC.2780538dbb1fb5e5')"
        @click="emit('close')"
      />
      <Button
        :text="
          items.length === 1
            ? t('streamC.03874ef999610800')
            : t('streamC.3743f57ab36b0081', { v1: String(items.length) })
        "
        :tooltip="t('streamC.e40dc1400c761e2e')"
        accent
        @click="repair"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'

import ObsidianModal from '@/components/obsidian/Modal.vue'
import Button from '@/components/obsidian/Button.vue'
import type { HighlightRepairCandidate } from '@/reader/highlightRepair'

/**
 * The highlights whose links would move, each with its chapter, its words and the text around
 * where they were found. Only the button repairs; every other way out leaves the links alone.
 */
defineProps<{ items: HighlightRepairCandidate[] }>()

const emit = defineEmits<{
  (e: 'answer', value: true): void
  (e: 'close'): void
}>()

const context = ({ context: { pre, match, post } }: HighlightRepairCandidate) =>
  `${pre.slice(-70)}${match}${post.slice(0, 70)}`

function repair(): void {
  emit('answer', true)
  emit('close')
}
</script>
