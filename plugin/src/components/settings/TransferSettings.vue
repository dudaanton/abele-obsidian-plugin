<template>
  <div class="abele-transfer">
    <Section
      title="Send to another device"
      desc="Tick what should travel. What you pick becomes a QR code — or a short series of them, shown one after another — for the other device to read."
    >
      <Setting
        name="Include keys"
        desc="API keys travel with whatever needs them. A transfer carrying a key is locked behind a one-time code, shown here and typed on the other device."
      >
        <Checkbox :is-enabled="withKeys" @toggle="withKeys = !withKeys" />
      </Setting>

      <div v-for="group in groups" :key="group.section" class="abele-transfer__group">
        <div class="abele-transfer__group-head">
          <Checkbox :is-enabled="allChosen(group)" @toggle="toggleGroup(group)" />
          <span class="abele-transfer__group-name">{{ group.label }}</span>
          <Badge :text="String(group.entries.length)" />
        </div>

        <div
          v-for="entry in group.entries"
          :key="key(entry)"
          class="abele-transfer__entry"
          role="button"
          tabindex="0"
          @click="toggle(entry)"
          @keydown.enter="toggle(entry)"
          @keydown.space.prevent="toggle(entry)"
        >
          <Checkbox :is-enabled="chosen.has(key(entry))" @toggle="toggle(entry)" />
          <span class="abele-transfer__entry-name">{{ entry.label }}</span>
          <Icon
            v-if="withKeys && (entry.secretIds?.length || entry.sensitive)"
            icon="key-round"
            no-hover
            class="abele-transfer__entry-key"
          />
        </div>
      </div>

      <EmptyState v-if="!groups.length" text="Nothing here can be transferred yet." />

      <Setting :name="summary" :desc="codesSummary">
        <Button
          text="Show QR"
          accent
          :disabled="!chosen.size"
          :tooltip="
            chosen.size
              ? 'Show what you ticked as a QR code to read on the other device'
              : 'Tick something to send first'
          "
          @click="show"
        />
      </Setting>
    </Section>

    <Section
      title="Receive from another device"
      desc="Read the codes the other device is showing. Nothing is written until you have seen what arrived."
    >
      <Setting name="Read a transfer" desc="Camera, a photo of the code, or the text itself.">
        <Button
          text="Scan"
          tooltip="Read a transfer from another device"
          @click="scanning = true"
        />
      </Setting>
    </Section>

    <TransferShowModal
      v-if="sending"
      :frames="sending.frames"
      :code="sending.code"
      @close="sending = null"
    />

    <TransferScanModal v-if="scanning" @close="scanning = false" @applied="onApplied" />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Notice } from 'obsidian'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Button from '../obsidian/Button.vue'
import Badge from '../obsidian/Badge.vue'
import Icon from '../obsidian/Icon.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import TransferShowModal from './transfer/TransferShowModal.vue'
import TransferScanModal, { type Applied } from './transfer/TransferScanModal.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { collectEntries, buildPayload, needsCode, sectionLabel } from '@/transfer/entries'
import { encodePayload, newTransferCode } from '@/transfer/payload'
import { toFrames, newTransferId, FRAME_PAYLOAD_BYTES } from '@/transfer/frames'
import type { SectionId, TransferEntry } from '@/transfer/types'

const entries = computed(() => collectEntries(AbeleConfig.getInstance().exportSettings()))

const key = (entry: TransferEntry) => `${entry.section}:${entry.id}`

interface Group {
  section: SectionId
  label: string
  entries: TransferEntry[]
}

const groups = computed<Group[]>(() => {
  const bySection = new Map<SectionId, TransferEntry[]>()
  for (const entry of entries.value) {
    const list = bySection.get(entry.section) ?? []
    list.push(entry)
    bySection.set(entry.section, list)
  }

  return [...bySection].map(([section, list]) => ({
    section,
    label: sectionLabel(section),
    entries: list,
  }))
})

const chosen = ref(new Set<string>())
const withKeys = ref(true)

const toggle = (entry: TransferEntry) => {
  const next = new Set(chosen.value)
  if (!next.delete(key(entry))) next.add(key(entry))
  chosen.value = next
}

const allChosen = (group: Group) => group.entries.every((entry) => chosen.value.has(key(entry)))

const toggleGroup = (group: Group) => {
  const next = new Set(chosen.value)
  const removing = allChosen(group)
  for (const entry of group.entries) {
    if (removing) next.delete(key(entry))
    else next.add(key(entry))
  }
  chosen.value = next
}

const picked = computed(() => entries.value.filter((entry) => chosen.value.has(key(entry))))

const summary = computed(() =>
  chosen.value.size === 1 ? '1 item selected' : `${chosen.value.size} items selected`
)

/**
 * How many codes it will take, worked out by actually packing it.
 *
 * Guessing from the JSON length would be wrong by a factor of three: what goes into the codes
 * is compressed, and how well depends entirely on what was ticked.
 */
const codes = ref(0)

watch(
  [picked, withKeys],
  async () => {
    if (!picked.value.length) {
      codes.value = 0
      return
    }
    const blob = await encodePayload(buildPayload(picked.value, reader()))
    codes.value = Math.max(1, Math.ceil(blob.length / FRAME_PAYLOAD_BYTES))
  },
  { immediate: true }
)

const codesSummary = computed(() => {
  if (!picked.value.length) return 'Nothing selected yet.'
  if (codes.value <= 1) return 'Fits in one code.'
  return `Takes ${codes.value} codes, shown one after another.`
})

const reader = () => {
  if (!withKeys.value) return null
  const { app } = GlobalStore.getInstance()
  return (id: string) => app.secretStorage.getSecret(id) || ''
}

const sending = ref<{ frames: string[]; code?: string } | null>(null)
const scanning = ref(false)

const show = async () => {
  const payload = buildPayload(picked.value, reader())
  const code = needsCode(payload) ? newTransferCode() : undefined
  const blob = await encodePayload(payload, code)

  sending.value = { frames: toFrames(blob, newTransferId()), code }
}

const onApplied = ({ items, keysRefused }: Applied) => {
  scanning.value = false

  const applied = items === 1 ? 'Applied 1 item.' : `Applied ${items} items.`
  const refused = keysRefused
    ? ` ${keysRefused === 1 ? 'One key' : `${keysRefused} keys`} could not be stored — the name this vault uses for it is one Obsidian will not take.`
    : ''

  new Notice(`${applied}${refused}`)
}
</script>

<style lang="scss">
.abele-transfer__group {
  margin-top: var(--size-4-4);
}

.abele-transfer__group-head {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding-bottom: var(--size-4-1);
  border-bottom: 1px solid var(--background-modifier-border);
}

.abele-transfer__group-name {
  font-weight: var(--font-medium);
  color: var(--text-normal);
}

.abele-transfer__entry {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-4-1) 0 var(--size-4-1) var(--size-4-4);
  cursor: pointer;

  &:hover .abele-transfer__entry-name {
    color: var(--text-normal);
  }
}

.abele-transfer__entry-name {
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.abele-transfer__entry-key {
  color: var(--text-faint);
}
</style>
