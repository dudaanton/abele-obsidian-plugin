<template>
  <div class="abele-transfer">
    <SecretStoreSettings />

    <Section
      title="Send to another device"
      desc="Tick what should travel. What you pick can go as a QR code, as text to paste, or as a file to send."
    >
      <Setting
        name="Include keys"
        desc="API keys travel with whatever needs them. A transfer carrying a key is locked behind a one-time code, shown here and typed on the other device."
      >
        <Checkbox :is-enabled="withKeys" @toggle="withKeys = !withKeys" />
      </Setting>

      <!-- What can travel as one tree, a group a row: its check takes all of it, its count says
           how much is chosen, and only a group of several opens to its things. A group of one
           thing is that thing's row. -->
      <div v-if="groups.length" class="abele-transfer__head">
        <GroupHeading label="What to send">{{ chosenCount }}</GroupHeading>
        <Button
          quiet
          class="abele-transfer__all"
          :text="everythingChosen ? 'Clear' : 'Select all'"
          :tooltip="everythingChosen ? 'Send nothing' : 'Send everything listed here'"
          @click="toggleEverything"
        />
      </div>
      <div v-if="groups.length" class="abele-transfer__tree" role="tree">
        <!-- The first level is the settings' own: the groups their pages sit under, on the left. -->
        <TreeItem
          v-for="page in pages"
          :key="page.title"
          :text="page.title"
          :flair="countOf(page.entries)"
          collapsible
          :collapsed="!open.has(page.title)"
          class="abele-transfer__page"
          @click="fold(page.title)"
        >
          <template #leading>
            <input
              type="checkbox"
              class="abele-transfer__check"
              :checked="allOf(page.entries)"
              :indeterminate="someOf(page.entries) && !allOf(page.entries)"
              :data-indeterminate="someOf(page.entries) && !allOf(page.entries)"
              :aria-label="`Send everything under ${page.title}`"
              @change="toggleAll(page.entries)"
            />
          </template>
          <template v-for="group in page.groups" :key="group.section">
            <TreeItem
              v-if="group.entries.length === 1"
              :text="group.label"
              :note="leafNote(group)"
              class="abele-transfer__entry"
              @click="toggle(group.entries[0])"
            >
              <template #leading>
                <input
                  type="checkbox"
                  class="abele-transfer__check"
                  :checked="chosen.has(key(group.entries[0]))"
                  :aria-label="`Send ${group.entries[0].label}`"
                  @change="toggle(group.entries[0])"
                />
              </template>
              <template v-if="withKeys && carriesKey(group.entries[0])" #end>
                <Icon icon="key-round" :interactive="false" tooltip="Carries a key" />
              </template>
            </TreeItem>
            <TreeItem
              v-else
              :text="group.label"
              :flair="countOf(group.entries)"
              collapsible
              :collapsed="!open.has(group.section)"
              class="abele-transfer__group"
              @click="fold(group.section)"
            >
              <template #leading>
                <input
                  type="checkbox"
                  class="abele-transfer__check"
                  :checked="allOf(group.entries)"
                  :indeterminate="someOf(group.entries) && !allOf(group.entries)"
                  :data-indeterminate="someOf(group.entries) && !allOf(group.entries)"
                  :aria-label="`Send all of the ${group.label.toLowerCase()}`"
                  @change="toggleAll(group.entries)"
                />
              </template>
              <TreeItem
                v-for="entry in group.entries"
                :key="key(entry)"
                :text="entry.label"
                :note="details(entry).join(' · ')"
                class="abele-transfer__entry"
                @click="toggle(entry)"
              >
                <template #leading>
                  <input
                    type="checkbox"
                    class="abele-transfer__check"
                    :checked="chosen.has(key(entry))"
                    :aria-label="`Send ${entry.label}`"
                    @change="toggle(entry)"
                  />
                </template>
                <template v-if="withKeys && carriesKey(entry)" #end>
                  <Icon icon="key-round" :interactive="false" tooltip="Carries a key" />
                </template>
              </TreeItem>
            </TreeItem>
          </template>
        </TreeItem>
      </div>

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
          text="Send"
          accent
          :disabled="!chosen.size"
          :tooltip="
            chosen.size
              ? 'Hand what you chose to the other device'
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
      <Setting
        name="Read a transfer"
        desc="Camera, a photo of the code, a file, or the text itself."
      >
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

    <TransferSendModal
      v-if="sending"
      :frames="sending?.frames"
      :text="sending?.text"
      :code="sending?.code"
      :note="sending?.note"
      @close="closeSend"
    />

    <TransferScanModal v-if="scanning" @close="scanning = false" @applied="onApplied" />
  </div>
</template>

<script setup lang="ts">
import { secrets } from '@/secrets/SecretStore'
import { computed, onMounted, ref, watch } from 'vue'
import { Notice } from 'obsidian'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import TreeItem from '../obsidian/TreeItem.vue'
import GroupHeading from '../obsidian/GroupHeading.vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import SecretStoreSettings from './SecretStoreSettings.vue'
import TransferPreviewModal from './transfer/TransferPreviewModal.vue'
import TransferSendModal from './transfer/TransferSendModal.vue'
import TransferScanModal, { type Applied } from './transfer/TransferScanModal.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { collectEntries, buildPayload, needsCode, sectionLabel } from '@/transfer/entries'
import { collectFiles } from '@/transfer/files'
import { encodePayload, newTransferCode } from '@/transfer/payload'
import { toFrames, toText, newTransferId, FRAME_PAYLOAD_BYTES } from '@/transfer/frames'
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

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

const allOf = (list: TransferEntry[]) => list.every((entry) => chosen.value.has(key(entry)))
const someOf = (list: TransferEntry[]) => list.some((entry) => chosen.value.has(key(entry)))

/** How much of a branch goes: its size while none of it is chosen, then "2 of 3". */
const countOf = (list: TransferEntry[]) => {
  const count = list.filter((entry) => chosen.value.has(key(entry))).length
  return count ? `${count} of ${list.length}` : String(list.length)
}

const toggleAll = (list: TransferEntry[]) => {
  const next = new Set(chosen.value)
  const removing = allOf(list)
  for (const entry of list) {
    if (removing) next.delete(key(entry))
    else next.add(key(entry))
  }
  chosen.value = next
}

/** Where each section's settings are found, by the titles of the settings' own left column. */
const PAGE_OF: Record<SectionId, string> = {
  tasks: 'Notes',
  journals: 'Notes',
  calendars: 'Notes',
  links: 'Notes',
  linter: 'Notes',
  reader: 'Notes',
  maps: 'Notes',
  finance: 'Money and time',
  'time-tracking': 'Money and time',
  'ai-general': 'Agents',
  'ai-providers': 'Agents',
  'ai-image-providers': 'Agents',
  'ai-agents': 'Agents',
  'ai-secrets': 'Agents',
  'ai-prompts': 'Agents',
  'ai-voice': 'Agents',
  'ai-mcp-servers': 'Agents',
  scripts: 'Agents',
  'script-files': 'Agents',
  'skill-notes': 'Agents',
  'prompt-notes': 'Agents',
  github: 'Agents',
  'github-connections': 'Agents',
  'quick-button': 'Buttons',
  'header-buttons': 'Buttons',
  automations: 'Buttons',
  sync: 'Data',
  connection: 'Data',
  other: 'Data',
}
const PAGES = ['Notes', 'Money and time', 'Agents', 'Buttons', 'Data']

const pages = computed(() =>
  PAGES.map((title) => {
    const own = groups.value.filter((group) => PAGE_OF[group.section] === title)
    return { title, groups: own, entries: own.flatMap((group) => group.entries) }
  }).filter((page) => page.entries.length)
)

/** A group of one thing is that thing: its own name when it has one, then what it holds. */
const leafNote = (group: Group) => {
  const entry = group.entries[0]
  const facts = details(entry)
  if (entry.label !== group.label) facts.unshift(entry.label)
  return facts.join(' · ')
}

const open = ref(new Set<string>())

const fold = (branch: string) => {
  const next = new Set(open.value)
  if (!next.delete(branch)) next.add(branch)
  open.value = next
}

const everythingChosen = computed(
  () => entries.value.length > 0 && entries.value.every((entry) => chosen.value.has(key(entry)))
)

const toggleEverything = () => {
  chosen.value = everythingChosen.value ? new Set() : new Set(entries.value.map(key))
}

const chosenCount = computed(() =>
  chosen.value.size ? `${chosen.value.size} of ${entries.value.length}` : ''
)

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
    return facts
  }
  if (typeof data.baseUrl === 'string' && data.baseUrl) facts.push(data.baseUrl)
  if (Array.isArray(data.models)) facts.push(plural(data.models.length, 'model'))
  if (typeof data.description === 'string' && data.description) facts.push(data.description)
  if (!facts.length) facts.push(plural(Object.keys(data).length, 'setting'))

  return facts
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
  if (codes.value <= 6) return `Takes ${codes.value} codes, shown one after another.`
  // Said here rather than only in the modal, because this is where what goes in is decided:
  // a hundred codes is a sign to send fewer things, or to send it as text.
  return `Takes ${codes.value} codes — too many to photograph, so it would go as text or as a file.`
})

const reader = () => {
  if (!withKeys.value) return null
  return (id: string) => secrets().get(id) || ''
}

const previewing = ref(false)

/** Exactly what would go, built the same way the codes are — keys included or not. */
const preview = computed(() => buildPayload(picked.value, reader()))

const sending = ref<{ frames: string[]; text: string; code?: string; note?: string } | null>(null)
const scanning = ref(false)
const show = async () => {
  await pack(picked.value, {})
}

const pack = async (chosen: TransferEntry[], extra: Record<string, string>, note?: string) => {
  const payload = buildPayload(chosen, reader())
  Object.assign(payload.secrets, extra)
  const code = needsCode(payload) ? newTransferCode() : undefined
  const blob = await encodePayload(payload, code)

  const id = newTransferId()
  sending.value = { frames: toFrames(blob, id), text: toText(blob, id), code, note }
}

const closeSend = () => {
  sending.value = null
}

const onApplied = ({ items, keysRefused, filesRefused }: Applied) => {
  scanning.value = false

  // A transfer that brought only the connection applied no item, and its line says what did.
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
// The list's name with how much is chosen, and choosing all of it at the end of the same line.
.abele-transfer__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--size-4-2);
  margin-top: var(--size-4-4);
  margin-bottom: var(--size-2-2);

  .abele-group-heading {
    flex: 1;
    justify-content: flex-start;
  }

  .abele-group-heading__summary {
    color: var(--text-faint);
    font-weight: var(--font-normal);
  }
}

.abele-transfer .abele-transfer__all {
  flex: none;
  font-size: var(--font-ui-small);
}

.abele-transfer__tree {
  margin-bottom: var(--size-4-4);

  // A name is never cut inside a word: where the row is narrow, what it holds goes under it,
  // starting where the name starts.
  .abele-tree-item__inner {
    flex-wrap: wrap;
  }

  .abele-tree-item__text {
    flex: 0 1 auto;
    overflow-wrap: normal;
  }

  .abele-tree-item__note {
    flex: 1 1 14em;
  }

  .abele-tree-item__leading ~ .abele-tree-item__note {
    margin-inline-start: 0;
  }
}
</style>
