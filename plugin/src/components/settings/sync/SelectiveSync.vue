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
import { computed, ref } from 'vue'
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

/** One switch per attachment type, in the order a vault fills up with them. */
type KindKey = 'images' | 'audio' | 'video' | 'pdf' | 'other'

const KINDS: { key: KindKey; name: string; desc: string }[] = [
  { key: 'images', name: 'Images', desc: 'Screenshots, photos, drawings and diagrams.' },
  { key: 'audio', name: 'Audio', desc: 'Recordings and voice notes.' },
  { key: 'video', name: 'Video', desc: 'The heaviest thing a vault usually holds.' },
  { key: 'pdf', name: 'PDFs', desc: 'Papers, manuals and scans.' },
  {
    key: 'other',
    name: 'Everything else',
    desc: 'Attachments of no listed type, and the scripts folder.',
  },
]

type SettingsKey = keyof SelectiveSettings['settings']

const SETTINGS_KINDS: { key: SettingsKey; name: string; desc: string }[] = [
  { key: 'main', name: 'App settings', desc: 'Editor and file behaviour, from app.json.' },
  { key: 'appearance', name: 'Appearance', desc: 'The theme, its snippets and the font choices.' },
  { key: 'hotkeys', name: 'Hotkeys', desc: 'The shortcuts you have bound.' },
  { key: 'corePlugins', name: 'Core plugins', desc: "Which of Obsidian's own plugins are on." },
  {
    key: 'communityPlugins',
    name: 'Community plugins',
    desc: 'The plugins themselves, so a new device installs what this one runs.',
  },
  {
    key: 'pluginSettings',
    name: 'Plugin settings',
    desc: 'What each community plugin holds in its own data.json.',
  },
]

const config = () => AbeleConfig.getInstance()

const selective = computed<SelectiveSettings>(() => config().sync.selective)

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
  void config().saveSettings()
}

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
