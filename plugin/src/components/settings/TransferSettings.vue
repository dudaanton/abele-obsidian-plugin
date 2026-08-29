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

      <template v-for="group in groups" :key="group.section">
        <Setting :name="group.label" :desc="counted(group)">
          <Button
            v-if="group.entries.length > 1"
            :text="allChosen(group) ? 'Clear' : 'Select all'"
            :tooltip="allChosen(group) ? `Send none of the ${group.label.toLowerCase()}` : `Send all of the ${group.label.toLowerCase()}`"
            @click="toggleGroup(group)"
          />
        </Setting>

        <CardGrid wide>
          <Card
            v-for="entry in group.entries"
            :key="key(entry)"
            :title="entry.label"
            :meta="details(entry)"
            clickable
            :selected="chosen.has(key(entry))"
            @click="toggle(entry)"
          >
            <template #badges>
              <Badge v-if="withKeys && carriesKey(entry)" text="key" />
            </template>
          </Card>
        </CardGrid>
      </template>

      <EmptyState v-if="!groups.length" text="Nothing here can be transferred yet." />

      <Setting :name="summary" :desc="codesSummary">
        <Button
          text="Preview"
          :disabled="!chosen.size"
          :tooltip="
            chosen.size ? 'See exactly what would be sent' : 'Choose something to send first'
          "
          @click="previewing = true"
        />
        <Button
          text="Show QR"
          accent
          :disabled="!chosen.size"
          :tooltip="
            chosen.size
              ? 'Show what you chose as a QR code to read on the other device'
              : 'Choose something to send first'
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

    <TransferPreviewModal
      v-if="previewing"
      :payload="preview"
      :codes="codes"
      @close="previewing = false"
    />

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
import { computed, onMounted, ref, watch } from 'vue'
import { Notice } from 'obsidian'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Card from '../obsidian/Card.vue'
import CardGrid from '../obsidian/CardGrid.vue'
import Button from '../obsidian/Button.vue'
import Badge from '../obsidian/Badge.vue'
import Icon from '../obsidian/Icon.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import TransferPreviewModal from './transfer/TransferPreviewModal.vue'
import TransferShowModal from './transfer/TransferShowModal.vue'
import TransferScanModal, { type Applied } from './transfer/TransferScanModal.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { collectEntries, buildPayload, needsCode, sectionLabel } from '@/transfer/entries'
import { collectFiles } from '@/transfer/files'
import { encodePayload, newTransferCode } from '@/transfer/payload'
import { toFrames, newTransferId, FRAME_PAYLOAD_BYTES } from '@/transfer/frames'
import {
  isFileSection,
  TRANSFER_SECTIONS,
  type SectionId,
  type TransferEntry,
  type TransferFile,
} from '@/transfer/types'

const settingsEntries = computed(() => collectEntries(AbeleConfig.getInstance().exportSettings()))

/**
 * The scripts, skills and prompts themselves, read out of the vault.
 *
 * Read once when the screen opens rather than as the payload is packed: the preview and the
 * card list both want to know what is actually in them, and a handful of small files is a
 * cheaper thing to hold than a special case for "the content arrives later".
 */
const fileEntries = ref<TransferEntry[]>([])

onMounted(async () => {
  const { app } = GlobalStore.getInstance()
  fileEntries.value = await collectFiles(app, AbeleConfig.getInstance().ai.scriptsFolder || '')
})

const entries = computed(() => [...settingsEntries.value, ...fileEntries.value])

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

  // In the order the sections are declared, so the files sit beside the settings they belong
  // to rather than wherever the two collections happened to be concatenated.
  return TRANSFER_SECTIONS.filter((section) => bySection.has(section)).map((section) => ({
    section,
    label: sectionLabel(section),
    entries: bySection.get(section) ?? [],
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

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

const counted = (group: Group) => plural(group.entries.length, 'item')

const carriesKey = (entry: TransferEntry) => !!entry.secretIds?.length || !!entry.sensitive

/**
 * What the card says about itself beyond its name — enough to tell one provider from another
 * without opening the preview.
 */
const details = (entry: TransferEntry): string[] => {
  const data = entry.data as Record<string, unknown>
  if (!data || typeof data !== 'object') return []

  const facts: string[] = []
  if (isFileSection(entry.section)) {
    const file = entry.data as TransferFile
    facts.push(file.base ? `${file.base}/${file.path}` : file.path)
    facts.push(`${file.content.length} characters`)
    return facts
  }
  if (typeof data.baseUrl === 'string' && data.baseUrl) facts.push(data.baseUrl)
  if (Array.isArray(data.models)) facts.push(plural(data.models.length, 'model'))
  if (typeof data.description === 'string' && data.description) facts.push(data.description)
  if (!facts.length) facts.push(plural(Object.keys(data).length, 'setting'))

  return facts
}

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

const summary = computed(() => `${plural(chosen.value.size, 'item')} selected`)

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

const previewing = ref(false)

/** Exactly what would go, built the same way the codes are — keys included or not. */
const preview = computed(() => buildPayload(picked.value, reader()))

const sending = ref<{ frames: string[]; code?: string } | null>(null)
const scanning = ref(false)

const show = async () => {
  const payload = buildPayload(picked.value, reader())
  const code = needsCode(payload) ? newTransferCode() : undefined
  const blob = await encodePayload(payload, code)

  sending.value = { frames: toFrames(blob, newTransferId()), code }
}

const onApplied = ({ items, keysRefused, filesRefused }: Applied) => {
  scanning.value = false

  const parts = [`Applied ${plural(items, 'item')}.`]
  if (keysRefused) {
    parts.push(
      `${plural(keysRefused, 'key')} could not be stored — the name this vault uses for it is one Obsidian will not take.`
    )
  }
  if (filesRefused) parts.push(`${plural(filesRefused, 'file')} could not be written.`)

  new Notice(parts.join(' '))
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
