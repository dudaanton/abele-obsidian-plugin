<template>
  <Section
    title="What this device syncs"
    desc="Notes and canvases always travel. Everything else is this device's own choice — a phone can skip the video and still hold every note."
  >
    <p v-if="saveError" class="abele-selective-sync__error">{{ saveError }}</p>
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
        :model-value="capDraft"
        placeholder="No limit"
        @update:model-value="capDraft = $event"
        @commit="commitCap"
      />
    </Setting>
  </Section>

  <Section title="Obsidian settings" :desc="settingsDesc">
    <Setting
      v-for="entry in renamedConfig ? [] : SETTINGS_KINDS"
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
        :suggester="FilledFolderSuggest"
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
 * Every switch here is the device's own, kept in its connection in the vault's local storage —
 * not in `data.json`, which other devices can be handed — and never sent to the server: two
 * devices on one vault may each take a different half of it. The engine hashes these into its
 * scope key, so widening them makes the next run a rescan rather than a read of the feed; that
 * happens in `EngineRunner.reconcile`, which `updateConnection` reaches.
 *
 * The cap is offered in megabytes because that is the unit a person thinks in about a video,
 * and stored in bytes because that is what the engine compares a file against. An empty field
 * is `null` — no cap — which is a different thing from a cap of zero. It is saved when the
 * field is committed, not as it is typed: every save that moves it rebuilds the engine and
 * walks the manifest, and editing 50 into 100 passes through an empty field on the way.
 */
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import type { SelectiveSettings } from '@abele/sync-core'
import Section from '../../obsidian/Section.vue'
import Setting from '../../obsidian/Setting.vue'
import Checkbox from '../../obsidian/Checkbox.vue'
import Input from '../../obsidian/Input.vue'
import Button from '../../obsidian/Button.vue'
import Icon from '../../obsidian/Icon.vue'
import Search from '../../obsidian/Search.vue'
import EmptyState from '../../obsidian/EmptyState.vue'
import { FilledFolderSuggest } from '@/helpers/suggesters/FolderSuggester'
import { GlobalStore } from '@/stores/GlobalStore'
import { SyncService, isWireConfigDir } from '@/sync/SyncService'

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

const sync = SyncService.getInstance()

/**
 * This vault's config folder, when it is not the `.obsidian` the sync knows. Obsidian lets a
 * device rename it, and the engine's settings switches recognise only the one name, so such a
 * device keeps its config folder out of the sync altogether rather than send it as plain
 * files. The switches would do nothing here, so they are not offered.
 */
const configDir = GlobalStore.getInstance().app.vault.configDir
const renamedConfig = !isWireConfigDir(configDir)

const settingsDesc = renamedConfig
  ? `This device keeps its settings in a renamed config folder, ${configDir}, and sync does not carry one yet: Obsidian settings stay on this device, and those on the server are left alone.`
  : 'How much of the configuration folder travels. The workspace, the graph and every plugin cache stay where they are, on every device.'

/**
 * A copy of the connection's selective settings, edited here and written back on every change.
 *
 * Not a reference into the connection: the service replaces that record whole on every change,
 * so edits would be written into an object nothing reads any more — and they would bypass
 * `updateConnection`, which is what puts the engine in step.
 *
 * Through JSON rather than `structuredClone`: the connection is a reactive ref, and cloning one
 * of those throws `DataCloneError`.
 */
const copyOf = (settings: SelectiveSettings): SelectiveSettings =>
  JSON.parse(JSON.stringify(settings)) as SelectiveSettings

const selective = ref<SelectiveSettings>(copyOf(sync.connection.value.selective))

const folderToAdd = ref('')

const canAddFolder = computed(
  () =>
    folderToAdd.value.trim() !== '' &&
    !selective.value.excludedFolders.includes(folderToAdd.value.trim())
)

/**
 * The one road out of this screen: the connection is written and the engine put in step with
 * it. Nothing here can be refused — the rules `updateConnection` checks are about the server
 * and the keychain — so a failure is only ever local storage's, and the log says so.
 */
const saveError = ref<string | null>(null)
const save = (): void => {
  saveError.value = null
  sync.updateConnection({ selective: copyOf(selective.value) }).catch((error: unknown) => {
    selective.value = copyOf(sync.connection.value.selective)
    capDraft.value = maxMegabytes.value
    saveError.value = `Nothing was changed: ${error instanceof Error ? error.message : String(error)}`
    console.debug('[abele-sync] what this device syncs could not be saved', error)
  })
}

/**
 * Somebody else changed it: take what they wrote.
 *
 * The agent or a transfer can write the connection while this screen is open, and a screen
 * still showing the old switches would write them back over it on the next click. The
 * comparison is what keeps this screen's own saves from re-seeding it mid-edit.
 */
watch(
  () => sync.connection.value.selective,
  (held) => {
    if (JSON.stringify(held) !== JSON.stringify(selective.value)) selective.value = copyOf(held)
  }
)

/** Megabytes as the field shows them: empty when there is no cap at all. */
const maxMegabytes = computed(() => {
  const cap = selective.value.maxFileBytes
  return cap === null ? '' : String(Math.round(cap / (1024 * 1024)))
})

/** What the field holds while it is being edited; nothing reads it until it is committed. */
const capDraft = ref(maxMegabytes.value)

// A cap that changed under the field — a transfer, another screen — is what it shows next.
watch(maxMegabytes, (shown) => (capDraft.value = shown))

function toggleKind(key: KindKey): void {
  selective.value[key] = !selective.value[key]
  save()
}

function toggleSetting(key: SettingsKey): void {
  selective.value.settings[key] = !selective.value.settings[key]
  save()
}

/** A positive number of megabytes, in bytes; undefined for anything else, an empty field included. */
function capOf(value: string): number | undefined {
  const trimmed = value.trim()
  if (trimmed === '') return undefined
  const megabytes = Number(trimmed)
  if (!Number.isFinite(megabytes) || megabytes <= 0) return undefined
  return Math.round(megabytes * 1024 * 1024)
}

/** Saves a cap unless it is the one already saved, which is what makes Enter and blur one save. */
function saveCap(cap: number | null): void {
  if (cap === selective.value.maxFileBytes) return
  selective.value.maxFileBytes = cap
  save()
}

/**
 * The field was left or Enter was pressed. An empty field, committed, is no cap; anything that
 * is not a positive number puts back what was saved rather than guessing.
 */
function commitCap(value: string): void {
  if (value.trim() === '') {
    saveCap(null)
    return
  }
  const cap = capOf(value)
  if (cap === undefined) {
    capDraft.value = maxMegabytes.value
    return
  }
  saveCap(cap)
}

/**
 * The settings closed with the field still focused — Escape does that — and a field taken out
 * of the page fires no `change`. A cap that was typed is kept. An empty field is not: that would
 * be no cap at all, a wider scope and a rescan, and nobody leaving by Escape asked for either.
 */
onBeforeUnmount(() => {
  const cap = capOf(capDraft.value)
  if (cap !== undefined) saveCap(cap)
})

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

<style lang="scss">
.abele-selective-sync__error {
  color: var(--text-error);
  overflow-wrap: anywhere;
}
</style>
