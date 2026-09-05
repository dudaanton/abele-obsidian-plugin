<template>
  <Section
    title="What this device syncs"
    desc="Notes and canvases always travel. Everything else is this device's own choice — a phone can skip the video and still hold every note."
  >
    <Setting
      v-for="kind in KINDS"
      :key="kind.key"
      :name="kind.name"
      :desc="kind.desc"
      :data-selective="kind.key"
    >
      <Checkbox :is-enabled="selective[kind.key]" @toggle="toggleKind(kind.key)" />
    </Setting>

    <Setting
      name="Largest file"
      desc="Files bigger than this are skipped, in megabytes. Leave it empty to take everything."
    >
      <Input
        :model-value="maxMegabytes"
        placeholder="No limit"
        @update:model-value="setMaxMegabytes"
      />
    </Setting>
  </Section>

  <Section
    title="Obsidian settings"
    desc="How much of the configuration folder travels. The workspace, the graph and every plugin cache stay where they are, on every device."
  >
    <Setting
      v-for="entry in SETTINGS_KINDS"
      :key="entry.key"
      :name="entry.name"
      :desc="entry.desc"
      :data-selective-settings="entry.key"
    >
      <Checkbox :is-enabled="selective.settings[entry.key]" @toggle="toggleSetting(entry.key)" />
    </Setting>
  </Section>

  <Section
    title="Folders this device skips"
    desc="Nothing under a folder listed here is uploaded or downloaded by this device. The other devices still hold it."
  >
    <Setting
      v-for="folder in selective.excludedFolders"
      :key="folder"
      :name="folder"
      desc="Skipped by this device."
    >
      <Icon
        icon="trash"
        tooltip="Sync this folder on this device again"
        @click="removeFolder(folder)"
      />
    </Setting>

    <EmptyState
      v-if="selective.excludedFolders.length === 0"
      text="This device syncs every folder."
    />

    <Setting name="Skip a folder" desc="Pick a folder this device should leave alone.">
      <Search
        :model-value="folderToAdd"
        :suggester="FolderSuggest"
        placeholder="e.g. Archive/Video"
        @update:model-value="folderToAdd = $event"
      />
      <Button
        text="Skip"
        :disabled="!canAddFolder"
        :tooltip="
          canAddFolder ? 'Stop syncing this folder on this device' : 'Name a folder to skip first'
        "
        @click="addFolder"
      />
    </Setting>
  </Section>
</template>

<script setup lang="ts">
/**
 * Selective sync: what of the vault this one device takes.
 *
 * Every switch here is the device's own, kept in `data.json` beside the rest of the settings
 * and never sent to the server — two devices on one vault may each take a different half of
 * it. The engine hashes these into its scope key, so widening them makes the next run a
 * rescan rather than a read of the feed; that happens in `SyncService.reconcile`, which a
 * settings save is what reaches.
 *
 * The cap is offered in megabytes because that is the unit a person thinks in about a video,
 * and stored in bytes because that is what the engine compares a file against. An empty field
 * is `null` — no cap — which is a different thing from a cap of zero.
 */
import { computed, onMounted, onUnmounted, ref } from 'vue'
import type { SelectiveSettings } from '@abele/sync-core'
import Section from '../../obsidian/Section.vue'
import Setting from '../../obsidian/Setting.vue'
import Checkbox from '../../obsidian/Checkbox.vue'
import Input from '../../obsidian/Input.vue'
import Button from '../../obsidian/Button.vue'
import Icon from '../../obsidian/Icon.vue'
import Search from '../../obsidian/Search.vue'
import EmptyState from '../../obsidian/EmptyState.vue'
import { FolderSuggest } from '@/helpers/suggesters/FolderSuggester'
import { AbeleConfig } from '@/services/AbeleConfig'

/** What one switch says on the screen. */
interface Described {
  name: string
  desc: string
}

/**
 * The attachment switches, taken from the settings themselves rather than restated: every
 * boolean directly on `SelectiveSettings` is one, and a `Record` over them is exhaustive — so
 * a kind added to or renamed in the core fails to compile here until this screen offers it.
 */
type KindKey = {
  [K in keyof SelectiveSettings]: SelectiveSettings[K] extends boolean ? K : never
}[keyof SelectiveSettings]

const KIND_TEXT: Record<KindKey, Described> = {
  images: { name: 'Images', desc: 'Screenshots, photos, drawings and diagrams.' },
  audio: { name: 'Audio', desc: 'Recordings and voice notes.' },
  video: { name: 'Video', desc: 'The heaviest thing a vault usually holds.' },
  pdf: { name: 'PDFs', desc: 'Papers, manuals and scans.' },
  other: {
    name: 'Everything else',
    desc: 'Attachments of no listed type, and the scripts folder.',
  },
}

/** The order a vault fills up in, which is the order worth reading them in. */
const KINDS = (['images', 'audio', 'video', 'pdf', 'other'] as const).map((key) => ({
  key,
  ...KIND_TEXT[key],
}))

type SettingsKey = keyof SelectiveSettings['settings']

/** The same exhaustiveness, one level down: a new settings category has to be named here. */
const SETTINGS_TEXT: Record<SettingsKey, Described> = {
  main: { name: 'App settings', desc: 'Editor and file behaviour, from app.json.' },
  appearance: { name: 'Appearance', desc: 'The theme, its snippets and the font choices.' },
  hotkeys: { name: 'Hotkeys', desc: 'The shortcuts you have bound.' },
  corePlugins: { name: 'Core plugins', desc: "Which of Obsidian's own plugins are on." },
  communityPlugins: {
    name: 'Community plugins',
    desc: 'The plugins themselves, so a new device installs what this one runs.',
  },
  pluginSettings: {
    name: 'Plugin settings',
    desc: 'What each community plugin holds in its own data.json.',
  },
}

const SETTINGS_KINDS = (
  ['main', 'appearance', 'hotkeys', 'corePlugins', 'communityPlugins', 'pluginSettings'] as const
).map((key) => ({ key, ...SETTINGS_TEXT[key] }))

const config = AbeleConfig.getInstance()

/**
 * A copy of the settings, edited here and written back on every change.
 *
 * Not a `computed` over `config.sync.selective`: `AbeleConfig` is a plain class, not reactive
 * state, so Vue has nothing to track and a ticked checkbox would sit there unmoved. Nor a
 * reference into that object, which `applySettings` replaces wholesale when a transfer lands —
 * edits would then be written into an object nothing reads any more.
 *
 * Through JSON rather than `structuredClone`: the live settings may already be reactive
 * proxies, and cloning one of those throws `DataCloneError`. They are JSON on disk anyway.
 */
const copyOf = (settings: SelectiveSettings): SelectiveSettings =>
  JSON.parse(JSON.stringify(settings)) as SelectiveSettings

const selective = ref<SelectiveSettings>(copyOf(config.sync.selective))

const folderToAdd = ref('')

const canAddFolder = computed(
  () =>
    folderToAdd.value.trim() !== '' &&
    !selective.value.excludedFolders.includes(folderToAdd.value.trim())
)

/**
 * The one road out of this screen.
 *
 * `saveSettings` writes `data.json` and then tells everything that subscribed — the sync
 * service among them, which is what puts the running engine back in step with what was just
 * ticked. Nothing here calls the service directly: it would fire twice in the running app,
 * and once for a save this screen did not make.
 */
const save = (): void => {
  config.sync.selective = copyOf(selective.value)
  void config.saveSettings()
}

/**
 * Somebody else saved: take what they wrote.
 *
 * A transfer landing is the case that matters — it replaces the whole settings object, and a
 * screen still showing the old one would write the old one back over it on the next click. The
 * comparison is what keeps this screen's own saves from re-seeding it mid-edit.
 */
let unhook: (() => void) | null = null

onMounted(() => {
  unhook = config.onSaved(() => {
    const held = config.sync.selective
    if (JSON.stringify(held) !== JSON.stringify(selective.value)) selective.value = copyOf(held)
  })
})

onUnmounted(() => {
  unhook?.()
  unhook = null
})

/** Megabytes as the field shows them: empty when there is no cap at all. */
const maxMegabytes = computed(() => {
  const cap = selective.value.maxFileBytes
  return cap === null ? '' : String(Math.round(cap / (1024 * 1024)))
})

function toggleKind(key: KindKey): void {
  selective.value[key] = !selective.value[key]
  save()
}

function toggleSetting(key: SettingsKey): void {
  selective.value.settings[key] = !selective.value.settings[key]
  save()
}

function setMaxMegabytes(value: string): void {
  const trimmed = value.trim()
  if (trimmed === '') {
    selective.value.maxFileBytes = null
    save()
    return
  }
  const megabytes = Number(trimmed)
  // A field halfway through being typed is not a cap: nothing is saved until it is a number.
  if (!Number.isFinite(megabytes) || megabytes <= 0) return
  selective.value.maxFileBytes = Math.round(megabytes * 1024 * 1024)
  save()
}

function addFolder(): void {
  const folder = folderToAdd.value.trim()
  if (folder === '' || selective.value.excludedFolders.includes(folder)) return
  selective.value.excludedFolders.push(folder)
  folderToAdd.value = ''
  save()
}

function removeFolder(folder: string): void {
  const folders = selective.value.excludedFolders
  const at = folders.indexOf(folder)
  if (at === -1) return
  folders.splice(at, 1)
  save()
}
</script>
