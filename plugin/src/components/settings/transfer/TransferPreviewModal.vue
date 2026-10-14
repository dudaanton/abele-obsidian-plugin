<template>
  <ObsidianModal title="What will be sent" size="wide" @close="emit('close')">
    <div class="abele-transfer-preview">
      <p class="abele-transfer-preview__summary">{{ summary }}</p>

      <!-- A group a heading, a thing a row, as on the page it was ticked on. What exactly goes
           unfolds under its row: a settings block shown as it will travel, not summarised. -->
      <div v-for="group in groups" :key="group.section" class="abele-transfer-preview__group">
        <GroupHeading :label="group.label">{{ group.entries.length }}</GroupHeading>
        <div role="list">
          <EntryRow
            v-for="entry in group.entries"
            :key="key(entry)"
            role="listitem"
            :more="open.has(key(entry))"
            more-label="what goes"
            @update:more="fold(entry)"
          >
            {{ entry.label }}
            <template v-if="entry.secretIds?.some((id) => payload.secrets[id])" #codes>
              <Icon icon="key-round" :interactive="false" tooltip="Carries a key" />
            </template>
            <template v-if="open.has(key(entry))" #detail>
              <pre class="abele-transfer-preview__body">{{ shown(entry) }}</pre>
            </template>
          </EntryRow>
        </div>
      </div>

      <div v-if="keys.length" class="abele-transfer-preview__group">
        <GroupHeading label="Keys">{{ keys.length }}</GroupHeading>
        <div role="list">
          <EntryRow v-for="[id, value] in keys" :key="id" role="listitem">
            {{ id }}
            <template #meta>
              <span class="abele-transfer-preview__masked">{{ mask(value) }}</span>
            </template>
          </EntryRow>
        </div>
        <p class="abele-transfer-preview__note">
          Shown masked here; they travel in full, which is why the transfer is locked.
        </p>
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import ObsidianModal from '../../obsidian/Modal.vue'
import EntryRow from '../../obsidian/EntryRow.vue'
import GroupHeading from '../../obsidian/GroupHeading.vue'
import Icon from '../../obsidian/Icon.vue'
import { sectionLabel } from '@/transfer/entries'
import {
  TRANSFER_SECTIONS,
  type SectionId,
  type TransferEntry,
  type TransferPayload,
} from '@/transfer/types'

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

const key = (entry: TransferEntry) => `${entry.section}:${entry.id}`

/** By section, in the order the sending page lists them. */
const groups = computed(() => {
  const bySection = new Map<SectionId, TransferEntry[]>()
  for (const entry of props.payload.entries) {
    const list = bySection.get(entry.section) ?? []
    list.push(entry)
    bySection.set(entry.section, list)
  }
  return TRANSFER_SECTIONS.filter((section) => bySection.has(section)).map((section) => ({
    section,
    label: sectionLabel(section),
    entries: bySection.get(section) ?? [],
  }))
})

/** Which rows are unfolded; a short transfer opens with everything in sight. */
const open = ref(new Set(props.payload.entries.length === 1 ? props.payload.entries.map(key) : []))
const fold = (entry: TransferEntry) => {
  const next = new Set(open.value)
  if (!next.delete(key(entry))) next.add(key(entry))
  open.value = next
}

/**
 * Enough of a key to recognise which one it is, and not enough to be worth photographing.
 * The prefix is what tells `sk-proj-…` from `sk-ant-…`; the tail is what tells two of those
 * apart in a list.
 */
const mask = (value: string) =>
  value.length > 12
    ? `${value.slice(0, 3)}…${value.slice(-4)} (${value.length} characters)`
    : '••••'
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

.abele-transfer-preview__group {
  margin-top: var(--size-4-2);

  .abele-group-heading {
    margin-bottom: var(--size-2-2);
  }
}

.abele-transfer-preview__body {
  margin: var(--size-2-2) 0 0;
  padding: var(--size-4-2);
  max-height: 18em;
  border-radius: var(--radius-s);
  background-color: var(--background-secondary);
  font-family: var(--font-monospace);
  font-size: var(--font-smallest);
  user-select: text;
  -webkit-user-select: text;
  // A settings value can be a long path or a URL, and wrapping one mid-token makes it
  // unreadable — this block is deliberately a scroller, like a code block anywhere else.
  overflow: auto;
}

.abele-transfer-preview__masked {
  font-family: var(--font-monospace);
}

.abele-transfer-preview__note {
  margin: 0;
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
}
</style>
