<template>
  <Section
    :title="t('settings.sync.SelectiveSync.what_this_device_syncs.979d00ce')"
    :desc="t('settings.sync.SelectiveSync.notes_and_canvases_always_travel.395d3522')"
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
      :name="t('settings.sync.SelectiveSync.largest_file.5cd59717')"
      :desc="t('settings.sync.SelectiveSync.files_bigger_than_this_are.ce27e6e7')"
    >
      <Input
        :model-value="capDraft"
        :placeholder="t('settings.sync.SelectiveSync.no_limit.f7fcff0d')"
        @update:model-value="capDraft = $event"
        @commit="commitCap"
      />
    </Setting>
    <ExternalFileRules />
  </Section>

  <Section
    :title="t('settings.sync.SelectiveSync.obsidian_settings.b1370814')"
    :desc="settingsDesc"
  >
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
    :title="t('settings.sync.SelectiveSync.folders_this_device_skips.f47a9f56')"
    :desc="t('settings.sync.SelectiveSync.nothing_under_a_folder_listed.6abc4f89')"
  >
    <Setting
      v-for="folder in selective.excludedFolders"
      :key="folder"
      :name="folder"
      :desc="t('settings.sync.SelectiveSync.skipped_by_this_device.a7679073')"
    >
      <Icon
        icon="trash"
        :tooltip="t('settings.sync.SelectiveSync.sync_this_folder_on_this.b41e686c')"
        @click="removeFolder(folder)"
      />
    </Setting>

    <EmptyState
      v-if="selective.excludedFolders.length === 0"
      :text="t('settings.sync.SelectiveSync.this_device_syncs_every_folder.5c1a44be')"
    />

    <Setting
      :name="t('settings.sync.SelectiveSync.skip_a_folder.1f3e8658')"
      :desc="t('settings.sync.SelectiveSync.pick_a_folder_this_device.dab71c43')"
    >
      <Search
        :model-value="folderToAdd"
        :suggester="FilledFolderSuggest"
        :placeholder="
          t('settings.sync.SelectiveSync.e_g_archive_video.b35fc660', {
            literal0: String('Archive/Video'),
          })
        "
        @update:model-value="folderToAdd = $event"
      />
      <Button
        :text="t('settings.sync.SelectiveSync.skip.28d03596')"
        :disabled="!canAddFolder"
        :tooltip="
          canAddFolder
            ? t('settings.sync.SelectiveSync.stop_syncing_this_folder_on.a245d063')
            : t('settings.sync.SelectiveSync.name_a_folder_to_skip.987a0698')
        "
        @click="addFolder"
      />
    </Setting>
  </Section>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
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
import ExternalFileRules from './ExternalFileRules.vue'
import type { SelectiveSettings } from '@abele/sync-sdk/core'
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
import { TokenSettingsPort } from '@/sync/tokenSettingsPort'
import { isWireConfigDir } from '@/sync/scope'

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
  images: {
    name: t('settings.sync.SelectiveSync.images.be7e2f20'),
    desc: t('settings.sync.SelectiveSync.screenshots_photos_drawings_and_diagrams.34494a0e'),
  },
  audio: {
    name: t('settings.sync.SelectiveSync.audio.bc1b8890'),
    desc: t('settings.sync.SelectiveSync.recordings_and_voice_notes.2bf25181'),
  },
  video: {
    name: t('settings.sync.SelectiveSync.video.d534be82'),
    desc: t('settings.sync.SelectiveSync.the_heaviest_thing_a_vault.c54886fb'),
  },
  pdf: {
    name: t('settings.sync.SelectiveSync.pdfs.211eae3f'),
    desc: t('settings.sync.SelectiveSync.papers_manuals_and_scans.55635c99'),
  },
  other: {
    name: t('settings.sync.SelectiveSync.everything_else.cd6c5f59'),
    desc: t('settings.sync.SelectiveSync.attachments_of_no_listed_type.d6b34625'),
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
  main: {
    name: t('settings.sync.SelectiveSync.app_settings.d43fb8a9'),
    desc: t('settings.sync.SelectiveSync.editor_and_file_behaviour_from.0132e8bd'),
  },
  appearance: {
    name: t('settings.sync.SelectiveSync.appearance.3907fa7f'),
    desc: t('settings.sync.SelectiveSync.the_theme_its_snippets_and.584f5304'),
  },
  hotkeys: {
    name: t('settings.sync.SelectiveSync.hotkeys.c15f1530'),
    desc: t('settings.sync.SelectiveSync.the_shortcuts_you_have_bound.3f1903d8'),
  },
  corePlugins: {
    name: t('settings.sync.SelectiveSync.core_plugins.f2e957b0'),
    desc: t('settings.sync.SelectiveSync.which_of_obsidian_s_own.99bc1676'),
  },
  communityPlugins: {
    name: t('settings.sync.SelectiveSync.community_plugins.ab574402'),
    desc: t('settings.sync.SelectiveSync.the_plugins_themselves_so_a.9c0fb58f'),
  },
  pluginSettings: {
    name: t('settings.sync.SelectiveSync.plugin_settings.95d7fb37'),
    desc: t('settings.sync.SelectiveSync.what_each_community_plugin_holds.3087ad5b'),
  },
}

const SETTINGS_KINDS = (
  ['main', 'appearance', 'hotkeys', 'corePlugins', 'communityPlugins', 'pluginSettings'] as const
).map((key) => ({ key, ...SETTINGS_TEXT[key] }))

const sync = TokenSettingsPort.getInstance()

/**
 * This vault's config folder, when it is not the `.obsidian` the sync knows. Obsidian lets a
 * device rename it, and the engine's settings switches recognise only the one name, so such a
 * device keeps its config folder out of the sync altogether rather than send it as plain
 * files. The switches would do nothing here, so they are not offered.
 */
const configDir = GlobalStore.getInstance().app.vault.configDir
const renamedConfig = !isWireConfigDir(configDir)

const settingsDesc = renamedConfig
  ? t('settings.sync.SelectiveSync.this_device_keeps_its_settings.6f44f3ee', {
      value0: String(configDir),
    })
  : t('settings.sync.SelectiveSync.how_much_of_the_configuration.426f0882')

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
    saveError.value = t('settings.sync.SelectiveSync.nothing_was_changed_value.d24494c2', {
      value0: String(error instanceof Error ? error.message : String(error)),
    })
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
