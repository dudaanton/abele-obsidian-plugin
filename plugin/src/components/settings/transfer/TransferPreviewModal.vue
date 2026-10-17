<template>
  <ObsidianModal
    :title="t('settings.transfer.TransferPreviewModal.what_will_be_sent.86f3f00c')"
    size="wide"
    @close="emit('close')"
  >
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
            :more-label="t('settings.transfer.TransferPreviewModal.what_goes.39dde11f')"
            @update:more="fold(entry)"
          >
            {{ transferLabel(entry) }}
            <template v-if="entry.secretIds?.some((id) => payload.secrets[id])" #codes>
              <Icon
                icon="key-round"
                :interactive="false"
                :tooltip="t('settings.transfer.TransferPreviewModal.carries_a_key.0d090cb4')"
              />
            </template>
            <template v-if="open.has(key(entry))" #detail>
              <pre class="abele-transfer-preview__body">{{ shown(entry) }}</pre>
            </template>
          </EntryRow>
        </div>
      </div>

      <div v-if="keys.length" class="abele-transfer-preview__group">
        <GroupHeading :label="t('settings.transfer.TransferPreviewModal.keys.f0d66a79')">{{
          keys.length
        }}</GroupHeading>
        <div role="list">
          <EntryRow v-for="[id, value] in keys" :key="id" role="listitem">
            {{ id }}
            <template #meta>
              <span class="abele-transfer-preview__masked">{{ mask(value) }}</span>
            </template>
          </EntryRow>
        </div>
        <p class="abele-transfer-preview__note">
          {{ t('settings.transfer.TransferPreviewModal.shown_masked_here_they_travel.6de2d018') }}
        </p>
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { settingsCount } from '@/i18n/settingsCounts'
import { settingsLabel, transferLabel } from '@/i18n/settingsLabels'
import { t } from '@/i18n'
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
  const parts = [items === 1 ? settingsCount('item', 1) : settingsCount('item', items)]
  if (keys.value.length)
    parts.push(
      keys.value.length === 1 ? settingsCount('key', 1) : settingsCount('key', keys.value.length)
    )
  parts.push(props.codes === 1 ? settingsCount('code', 1) : settingsCount('code', props.codes))

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
    label: settingsLabel(sectionLabel(section)),
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
    ? t('settings.transfer.TransferPreviewModal.value_value_value_characters.3394d986', {
        value0: String(value.slice(0, 3)),
        value1: String(value.slice(-4)),
        value2: String(value.length),
      })
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
