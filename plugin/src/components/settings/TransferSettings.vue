<template>
  <div class="abele-transfer">
    <SecretStoreSettings />

    <Section
      :title="t('settings.TransferSettings.send_to_another_device.71ef2876')"
      :desc="t('settings.TransferSettings.tick_what_should_travel_what.be4e856b')"
    >
      <Setting
        :name="t('settings.TransferSettings.include_keys.f7508fd4')"
        :desc="t('settings.TransferSettings.api_keys_travel_with_whatever.8cb769f9')"
      >
        <Checkbox :is-enabled="withKeys" @toggle="withKeys = !withKeys" />
      </Setting>

      <!-- What can travel as one tree, a group a row: its check takes all of it, its count says
           how much is chosen, and only a group of several opens to its things. A group of one
           thing is that thing's row. -->
      <div v-if="groups.length" class="abele-transfer__head">
        <GroupHeading :label="t('settings.TransferSettings.what_to_send.bceb988a')">{{
          chosenCount
        }}</GroupHeading>
        <Button
          quiet
          class="abele-transfer__all"
          :text="
            everythingChosen
              ? t('settings.TransferSettings.clear.83b12c22')
              : t('settings.TransferSettings.select_all.1fc9a387')
          "
          :tooltip="
            everythingChosen
              ? t('settings.TransferSettings.send_nothing.1bc92d8a')
              : t('settings.TransferSettings.send_everything_listed_here.f1ac2a00')
          "
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
              :aria-label="
                t('settings.TransferSettings.send_everything_under_value.1db19fa3', {
                  value0: String(page.title),
                })
              "
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
                  :aria-label="
                    t('settings.TransferSettings.send_value.c229d699', {
                      value0: String(group.entries[0].label),
                    })
                  "
                  @change="toggle(group.entries[0])"
                />
              </template>
              <template v-if="withKeys && carriesKey(group.entries[0])" #end>
                <Icon
                  icon="key-round"
                  :interactive="false"
                  :tooltip="t('settings.TransferSettings.carries_a_key.0d090cb4')"
                />
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
                  :aria-label="
                    t('settings.TransferSettings.send_all_of_the_value.f01a8818', {
                      value0: String(group.label.toLowerCase()),
                    })
                  "
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
                    :aria-label="
                      t('settings.TransferSettings.send_value.c229d699', {
                        value0: String(transferLabel(entry)),
                      })
                    "
                    @change="toggle(entry)"
                  />
                </template>
                <template v-if="withKeys && carriesKey(entry)" #end>
                  <Icon
                    icon="key-round"
                    :interactive="false"
                    :tooltip="t('settings.TransferSettings.carries_a_key.0d090cb4')"
                  />
                </template>
              </TreeItem>
            </TreeItem>
          </template>
        </TreeItem>
      </div>

      <EmptyState
        v-if="!groups.length"
        :text="t('settings.TransferSettings.nothing_here_can_be_transferred.49a46df4')"
      />

      <Setting :name="summary" :desc="codesSummary">
        <Button
          :text="t('settings.TransferSettings.preview.324b134f')"
          :disabled="!chosen.size"
          :tooltip="
            chosen.size
              ? t('settings.TransferSettings.see_exactly_what_would_be.5a694fa9')
              : t('settings.TransferSettings.choose_something_to_send_first.5fde4c03')
          "
          @click="previewing = true"
        />
        <Button
          :text="t('settings.TransferSettings.send.f6f4688f')"
          accent
          :disabled="!chosen.size"
          :tooltip="
            chosen.size
              ? t('settings.TransferSettings.hand_what_you_chose_to.f4aa3506')
              : t('settings.TransferSettings.choose_something_to_send_first.5fde4c03')
          "
          @click="show"
        />
      </Setting>
    </Section>

    <Section
      :title="t('settings.TransferSettings.receive_from_another_device.955f97bb')"
      :desc="t('settings.TransferSettings.read_the_codes_the_other.7d52f77b')"
    >
      <Setting
        :name="t('settings.TransferSettings.read_a_transfer.da2dcc0f')"
        :desc="t('settings.TransferSettings.camera_a_photo_of_the.d9996865')"
      >
        <Button
          :text="t('settings.TransferSettings.scan.ea1c510d')"
          :tooltip="t('settings.TransferSettings.read_a_transfer_from_another.60d1c2f6')"
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
import { settingsCount } from '@/i18n/settingsCounts'
import { settingsLabel, transferLabel } from '@/i18n/settingsLabels'
import { t } from '@/i18n'
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
    label: settingsLabel(sectionLabel(section)),
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

const plural = (count: number, word: 'item' | 'key' | 'file') => settingsCount(word, count)

const allOf = (list: TransferEntry[]) => list.every((entry) => chosen.value.has(key(entry)))
const someOf = (list: TransferEntry[]) => list.some((entry) => chosen.value.has(key(entry)))

/** How much of a branch goes: its size while none of it is chosen, then "2 of 3". */
const countOf = (list: TransferEntry[]) => {
  const count = list.filter((entry) => chosen.value.has(key(entry))).length
  return count
    ? t('settings.TransferSettings.value_of_value.ca6c5e5f', {
        value0: String(count),
        value1: String(list.length),
      })
    : String(list.length)
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
  tasks: t('settings.TransferSettings.notes.8a7525b1'),
  journals: t('settings.TransferSettings.notes.8a7525b1'),
  calendars: t('settings.TransferSettings.notes.8a7525b1'),
  links: t('settings.TransferSettings.notes.8a7525b1'),
  linter: t('settings.TransferSettings.notes.8a7525b1'),
  reader: t('settings.TransferSettings.notes.8a7525b1'),
  maps: t('settings.TransferSettings.notes.8a7525b1'),
  finance: t('settings.TransferSettings.money_and_time.ebb5a49d'),
  'time-tracking': t('settings.TransferSettings.money_and_time.ebb5a49d'),
  'ai-general': t('settings.TransferSettings.agents.279b44d2'),
  'ai-providers': t('settings.TransferSettings.agents.279b44d2'),
  'ai-image-providers': t('settings.TransferSettings.agents.279b44d2'),
  'ai-agents': t('settings.TransferSettings.agents.279b44d2'),
  'ai-secrets': t('settings.TransferSettings.agents.279b44d2'),
  'ai-prompts': t('settings.TransferSettings.agents.279b44d2'),
  'ai-voice': t('settings.TransferSettings.agents.279b44d2'),
  'ai-mcp-servers': t('settings.TransferSettings.agents.279b44d2'),
  scripts: t('settings.TransferSettings.agents.279b44d2'),
  'script-files': t('settings.TransferSettings.agents.279b44d2'),
  'skill-notes': t('settings.TransferSettings.agents.279b44d2'),
  'prompt-notes': t('settings.TransferSettings.agents.279b44d2'),
  github: t('settings.TransferSettings.agents.279b44d2'),
  'github-connections': t('settings.TransferSettings.agents.279b44d2'),
  'quick-button': t('settings.TransferSettings.buttons.d452583a'),
  'header-buttons': t('settings.TransferSettings.buttons.d452583a'),
  automations: t('settings.TransferSettings.buttons.d452583a'),
  sync: t('settings.TransferSettings.data.cec3a9b8'),
  connection: t('settings.TransferSettings.data.cec3a9b8'),
  other: t('settings.TransferSettings.data.cec3a9b8'),
}
const PAGES = [
  t('settings.TransferSettings.notes.8a7525b1'),
  t('settings.TransferSettings.money_and_time.ebb5a49d'),
  t('settings.TransferSettings.agents.279b44d2'),
  t('settings.TransferSettings.buttons.d452583a'),
  t('settings.TransferSettings.data.cec3a9b8'),
]

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
  chosen.value.size
    ? t('settings.TransferSettings.value_of_value.ca6c5e5f', {
        value0: String(chosen.value.size),
        value1: String(entries.value.length),
      })
    : ''
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

const summary = computed(() =>
  t('settings.TransferSettings.value_selected.975acbfe', {
    value0: String(plural(chosen.value.size, 'item')),
  })
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
  if (!picked.value.length) return t('settings.TransferSettings.nothing_selected_yet.d6f9822a')
  if (codes.value <= 1) return t('settings.TransferSettings.fits_in_one_code.324a2a38')
  if (codes.value <= 6)
    return t('settings.TransferSettings.takes_value_codes_shown_one.8b7b80a4', {
      value0: String(codes.value),
    })
  // Said here rather than only in the modal, because this is where what goes in is decided:
  // a hundred codes is a sign to send fewer things, or to send it as text.
  return t('settings.TransferSettings.takes_value_codes_too_many.304d8234', {
    value0: String(codes.value),
  })
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
  const parts = [
    t('settings.TransferSettings.applied_value.d4ffb612', {
      value0: String(plural(items, 'item')),
    }),
  ]
  if (keysRefused) {
    parts.push(
      t('settings.TransferSettings.value_could_not_be_stored.cf4fe457', {
        value0: String(plural(keysRefused, 'key')),
      })
    )
  }
  if (filesRefused)
    parts.push(
      t('settings.TransferSettings.value_could_not_be_written.93eaa96e', {
        value0: String(plural(filesRefused, 'file')),
      })
    )

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
