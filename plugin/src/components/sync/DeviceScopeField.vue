<template>
  <!-- What this device syncs of one connection: the Share picker's pills and field, the whole vault
       to start with, and one quiet line saying what the choice means. -->
  <div class="abele-device-scope">
    <SharePicker
      :model-value="modelValue"
      :choices="choices"
      :notes="notes"
      :members="members"
      vault-gives-way
      :vault-note="t('sync.deviceScope.default')"
      :disabled="disabled"
      :placeholder="narrowed ? t('sync.deviceScope.addBack') : undefined"
      :full-text="t('sync.deviceScope.limit', { count: SHARE_LIMIT })"
      @update:model-value="emit('update:modelValue', $event)"
    />
    <p class="setting-item-description abele-device-scope__line" role="status">{{ line }}</p>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { t } from '@/i18n'
import SharePicker from './SharePicker.vue'
import { SHARE_LIMIT, itemName, shareSetSource, type ShareItem } from '@/sync/shareSets'

const props = defineProps<{
  modelValue: ShareItem[]
  choices: ShareItem[]
  /** The token opens only `choices`: what is not chosen can come back, nothing more. */
  narrowed?: boolean
  /** As chosen before, in a connection's window: the line then says what a change does. */
  saved?: ShareItem[]
  notes?: Record<string, { text: string; faint?: boolean }>
  disabled?: boolean
}>()
const emit = defineEmits<{ 'update:modelValue': [items: ShareItem[]] }>()

const members = computed(() => shareSetSource.value?.members)
const ids = (items: ShareItem[]) => new Set(items.map((one) => one.id))
const line = computed(() => {
  const now = props.modelValue
  if (!now.length) return t('sync.deviceScope.choose')
  if (props.saved) {
    const before = ids(props.saved),
      after = ids(now)
    const added = now.filter((one) => !before.has(one.id))
    const dropped = props.saved.some((one) => !after.has(one.id))
    if (dropped) return t('sync.deviceScope.retains')
    if (added.length === 1) return t('sync.deviceScope.addedOne', { name: itemName(added[0]) })
    if (added.length) return t('sync.deviceScope.addedMany', { count: added.length })
  }
  if (now.some((one) => one.kind === 'vault')) return t('sync.deviceScope.every')
  if (props.narrowed) return t('sync.deviceScope.accessOnly')
  return props.saved ? t('sync.deviceScope.onlyDevice') : t('sync.deviceScope.onlyScanned')
})
</script>

<style lang="scss">
.abele-device-scope {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
  min-width: 0;
}
.abele-device-scope__line {
  margin: 0;
}
</style>
