<template>
  <Section
    ref="sectionEl"
    class="abele-attachment-rules"
    :title="t('settings.AttachmentRulesSettings.attachment_folders.4ec7937c')"
    :desc="t('settings.AttachmentRulesSettings.files_pasted_or_dropped_into.8c0c906d')"
  >
    <template #actions>
      <Icon
        class="abele-attachment-rules__add"
        icon="plus"
        :tooltip="t('settings.AttachmentRulesSettings.add_a_rule.bed79361')"
        @click="add"
      />
    </template>

    <!-- A box of its own per rule: the kit draws a run of sibling rows as one box, so a mark
         between rules ends one and starts the next. The rows stay the group's own children,
         which is what lines its heading up with theirs. -->
    <template v-for="(row, index) in rows" :key="row.key">
      <div v-if="index > 0" class="abele-attachment-rules__between" aria-hidden="true" />
      <Setting
        class="abele-attachment-rules__notes"
        :name="t('settings.AttachmentRulesSettings.notes_in.af0c6387')"
      >
        <Search
          :model-value="row.notesText"
          :suggester="FolderSuggest"
          :label="t('settings.AttachmentRulesSettings.notes_folder.b8c1e974')"
          input-class="abele-attachment-rules__path"
          :placeholder="t('settings.AttachmentRulesSettings.folder.74ccd433')"
          @update:model-value="(value: string) => changeNotes(row, value)"
        />
        <Icon
          icon="trash"
          :tooltip="t('settings.AttachmentRulesSettings.remove_this_rule.00612239')"
          @click="remove(index)"
        />
      </Setting>
      <Setting
        class="abele-attachment-rules__place"
        :name="t('settings.AttachmentRulesSettings.attachments_go_to.7b114ade')"
      >
        <Dropdown
          :model-value="row.location"
          :options="LOCATION_OPTIONS"
          @update:model-value="(value: string) => change(row, 'location', value)"
        />
        <Search
          v-if="row.location === 'folder'"
          :model-value="row.attachmentsFolder"
          :suggester="FolderSuggest"
          :label="t('settings.AttachmentRulesSettings.attachment_folder.fce49098')"
          input-class="abele-attachment-rules__path"
          :placeholder="t('settings.AttachmentRulesSettings.folder.74ccd433')"
          @update:model-value="(value: string) => change(row, 'attachmentsFolder', value)"
        />
        <Input
          v-else-if="row.location === 'subfolder'"
          :model-value="row.subfolder"
          :placeholder="t('settings.AttachmentRulesSettings.subfolder_name.f381c5ab')"
          @update:model-value="(value: string) => change(row, 'subfolder', value)"
        />
      </Setting>
    </template>

    <Setting
      v-if="rows.length === 0"
      class="abele-attachment-rules__empty"
      :name="t('settings.AttachmentRulesSettings.no_rules_attachments_follow_obsidian.e2ae55a7')"
    >
      <Button
        :text="t('settings.AttachmentRulesSettings.add_a_rule.bed79361')"
        :tooltip="t('settings.AttachmentRulesSettings.add_a_folder_rule.879a8360')"
        @click="add"
      />
    </Setting>
  </Section>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
/**
 * The folder rules for attachments (`src/media/attachmentRules.ts`), drawn the way Obsidian draws
 * its own "Default location for new attachments" in Files and links: per rule a «Notes in» row
 * and an «Attachments go to» row with Obsidian's three choices, the field each one needs beside
 * it. A rule is saved half a second after the last key; one not yet filled in covers nothing.
 * Rules that change underneath the screen — a sync, an agent, a reload — are drawn again, unless
 * something typed here is still waiting to be saved.
 *
 * A long path is shown by its end, where the folder that matters is, with the whole path in the
 * field's tooltip.
 */
import { nextTick, onMounted, reactive, ref, watch, type ComponentPublicInstance } from 'vue'
import { debounce } from 'obsidian'
import { nanoid } from 'nanoid'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Search from '../obsidian/Search.vue'
import Input from '../obsidian/Input.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import { FolderSuggest } from '@/helpers/suggesters/FolderSuggester'
import { AbeleConfig } from '@/services/AbeleConfig'
import {
  normalizeFolder,
  type AttachmentLocation,
  type AttachmentRule,
} from '@/media/attachmentRules'

/** Obsidian's own words for its attachment setting's choices. */
const LOCATION_OPTIONS: { value: AttachmentLocation; display: string }[] = [
  {
    value: 'note',
    display: t('settings.AttachmentRulesSettings.same_folder_as_the_note.32781177'),
  },
  {
    value: 'folder',
    display: t('settings.AttachmentRulesSettings.in_the_folder_specified_below.952cbb55'),
  },
  {
    value: 'subfolder',
    display: t('settings.AttachmentRulesSettings.in_subfolder_under_the_note.86da3483'),
  },
]

/** What the notes field says for the vault root, and reads back as it. */
const WHOLE_VAULT = t('settings.AttachmentRulesSettings.whole_vault.cb44fe25')

/** A rule on screen: a key of its own, and the notes folder as it stands in the field. */
interface Row extends AttachmentRule {
  key: string
  notesText: string
}

const config = AbeleConfig.getInstance()

const ruleOf = (row: AttachmentRule): AttachmentRule => ({
  notesFolder: row.notesFolder,
  location: row.location,
  attachmentsFolder: row.attachmentsFolder,
  subfolder: row.subfolder,
})
const rowOf = (rule: AttachmentRule): Row => ({
  ...ruleOf(rule),
  key: nanoid(),
  notesText:
    rule.notesFolder.trim() && !normalizeFolder(rule.notesFolder) ? WHOLE_VAULT : rule.notesFolder,
})

const rows = reactive<Row[]>(config.attachmentRules.map(rowOf))

/** Typed here and not yet handed to the settings. */
let pending = false

const debouncedSave = debounce(async () => {
  config.attachmentRules = rows.map(ruleOf)
  pending = false
  await config.saveSettings()
}, 500)
const save = () => {
  pending = true
  debouncedSave()
}

watch(
  () => config.version.value,
  () => {
    if (pending) return
    const saved = config.attachmentRules.map(ruleOf)
    if (JSON.stringify(saved) === JSON.stringify(rows.map(ruleOf))) return
    rows.splice(0, rows.length, ...saved.map(rowOf))
  }
)

const change = (row: Row, field: 'location' | 'attachmentsFolder' | 'subfolder', value: string) => {
  if (field === 'location') row.location = value as AttachmentLocation
  else row[field] = value
  save()
}

// What is typed stays in the field; only the saved folder reads "Whole vault" as the root.
const changeNotes = (row: Row, value: string) => {
  row.notesText = value
  row.notesFolder = value.trim().toLowerCase() === WHOLE_VAULT.toLowerCase() ? '/' : value
  save()
}

const add = () => {
  rows.push(rowOf({ notesFolder: '', location: 'folder', attachmentsFolder: '', subfolder: '' }))
  save()
}

const remove = (index: number) => {
  rows.splice(index, 1)
  save()
}

// The end of a long path in view and all of it in the tooltip, for every field not being typed in.
const sectionEl = ref<ComponentPublicInstance>()
const showPathEnds = () => {
  const root = sectionEl.value?.$el as HTMLElement | undefined
  const inputs = root?.querySelectorAll<HTMLInputElement>('.abele-attachment-rules__path') ?? []
  for (const input of inputs) {
    input.title = input.value
    if (input.ownerDocument.activeElement !== input) input.scrollLeft = input.scrollWidth
  }
}
onMounted(() => {
  const root = sectionEl.value?.$el as HTMLElement | undefined
  root?.addEventListener('focusout', () => void nextTick(showPathEnds))
  root?.ownerDocument.defaultView?.requestAnimationFrame(showPathEnds)
})
watch(rows, () => void nextTick(showPathEnds), { deep: true, flush: 'post' })
</script>

<style lang="scss">
// The bin stays on the line of the notes field however narrow the pane: the field grows from
// nothing, so the row never has to wrap to fit it.
.abele-attachment-rules__notes .abele-obsidian-search {
  flex: 1 0 0;
  min-width: 0;
}

// Off the phone the choice stands on its label's row, the field it needs under it.
body:not(.is-phone) .abele-attachment-rules__place {
  grid-template-columns: auto minmax(0, 1fr);
}
</style>
