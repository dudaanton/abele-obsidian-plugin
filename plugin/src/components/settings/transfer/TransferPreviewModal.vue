<template>
  <ObsidianModal title="What will be sent" size="wide" @close="emit('close')">
    <div class="abele-transfer-preview">
      <p class="abele-transfer-preview__summary">{{ summary }}</p>

      <div v-for="entry in payload.entries" :key="`${entry.section}:${entry.id}`">
        <div class="abele-transfer-preview__head">
          <span class="abele-transfer-preview__name">{{ entry.label }}</span>
          <Badge :text="sectionLabel(entry.section)" />
        </div>
        <!-- A settings block is what it is: shown as it will travel, not summarised. -->
        <pre class="abele-transfer-preview__body">{{ shown(entry) }}</pre>
      </div>

      <template v-if="keys.length">
        <div class="abele-transfer-preview__head">
          <span class="abele-transfer-preview__name">Keys</span>
          <Badge :text="String(keys.length)" />
        </div>
        <pre class="abele-transfer-preview__body">{{ keysShown }}</pre>
        <p class="abele-transfer-preview__note">
          Shown masked here; they travel in full, which is why the transfer is locked.
        </p>
      </template>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import ObsidianModal from '../../obsidian/Modal.vue'
import Badge from '../../obsidian/Badge.vue'
import { sectionLabel } from '@/transfer/entries'
import type { TransferEntry, TransferPayload } from '@/transfer/types'

const props = defineProps<{
  payload: TransferPayload
  /** How many QR codes it comes to, so the count is not a separate thing to work out. */
  codes: number
}>()

const emit = defineEmits<{ (e: 'close'): void }>()

const keys = computed(() => Object.entries(props.payload.secrets))

const summary = computed(() => {
  const items = props.payload.entries.length
  const parts = [items === 1 ? '1 item' : `${items} items`]
  if (keys.value.length) parts.push(keys.value.length === 1 ? '1 key' : `${keys.value.length} keys`)
  parts.push(props.codes === 1 ? '1 code' : `${props.codes} codes`)

  return parts.join(' · ')
})

const shown = (entry: TransferEntry) => JSON.stringify(entry.data, null, 2)

/**
 * Enough of a key to recognise which one it is, and not enough to be worth photographing.
 * The prefix is what tells `sk-proj-…` from `sk-ant-…`; the tail is what tells two of those
 * apart in a list.
 */
const mask = (value: string) =>
  value.length > 12
    ? `${value.slice(0, 3)}…${value.slice(-4)} (${value.length} characters)`
    : '••••'

const keysShown = computed(() =>
  keys.value.map(([id, value]) => `${id}: ${mask(value)}`).join('\n')
)
</script>

<style lang="scss">
.abele-transfer-preview {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}

.abele-transfer-preview__summary {
  margin: 0;
  color: var(--text-muted);
}

.abele-transfer-preview__head {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  margin-top: var(--size-4-2);
}

.abele-transfer-preview__name {
  font-weight: var(--font-semibold);
}

.abele-transfer-preview__body {
  margin: var(--size-2-2) 0 0;
  padding: var(--size-4-2);
  max-height: 18em;
  border-radius: var(--radius-s);
  background-color: var(--background-secondary);
  font-family: var(--font-monospace);
  font-size: var(--font-smallest);
  // A settings value can be a long path or a URL, and wrapping one mid-token makes it
  // unreadable — this block is deliberately a scroller, like a code block anywhere else.
  overflow: auto;
}

.abele-transfer-preview__note {
  margin: 0;
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}
</style>
