<template>
  <Section
    class="abele-attachment-rules"
    title="Attachment folders"
    desc="Files pasted or dropped into a note under one of these folders go to the folder named beside it, in place of Obsidian's own attachment folder. The deepest folder wins; / is the whole vault."
  >
    <Setting
      v-for="(row, index) in rows"
      :key="row.key"
      class="abele-attachment-rules__rule"
      :name="ruleName(row)"
      :desc="ruleDesc(row)"
    >
      <Search
        :model-value="row.notesFolder"
        :suggester="FolderSuggest"
        label="Notes folder"
        input-class="abele-attachment-rules__notes"
        placeholder="Notes folder"
        @update:model-value="(value: string) => change(row, 'notesFolder', value)"
      />
      <Search
        :model-value="row.attachmentsFolder"
        :suggester="FolderSuggest"
        label="Attachments folder"
        input-class="abele-attachment-rules__attachments"
        placeholder="Attachments folder"
        @update:model-value="(value: string) => change(row, 'attachmentsFolder', value)"
      />
      <Icon
        class="abele-attachment-rules__remove"
        icon="trash"
        tooltip="Remove this rule"
        @click="remove(index)"
      />
    </Setting>

    <EmptyState
      v-if="rows.length === 0"
      text="Every note keeps Obsidian's own attachment folder."
    />

    <Setting
      class="abele-attachment-rules__add"
      name="Add a rule"
      desc="A folder of notes and where their attachments go."
    >
      <Icon icon="plus" tooltip="Add a folder rule" @click="add" />
    </Setting>
  </Section>
</template>

<script setup lang="ts">
/**
 * The folder rules for attachments (`src/media/attachmentRules.ts`): one row per rule, the notes
 * folder and the attachments folder side by side. A rule is saved as it is typed, half a second
 * after the last key; one with a folder still empty is kept but covers nothing. Rules that change
 * underneath the screen — a sync, an agent, a reload — are drawn again, unless something typed
 * here is still waiting to be saved.
 */
import { reactive, watch } from 'vue'
import { debounce } from 'obsidian'
import { nanoid } from 'nanoid'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Search from '../obsidian/Search.vue'
import Icon from '../obsidian/Icon.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import { FolderSuggest } from '@/helpers/suggesters/FolderSuggester'
import { AbeleConfig } from '@/services/AbeleConfig'
import { attachmentSetting, isCompleteRule, normalizeFolder } from '@/media/attachmentRules'
import type { AttachmentRule } from '@/media/attachmentRules'

/** A rule on screen, with a key of its own so removing one keeps the others' fields. */
interface Row extends AttachmentRule {
  key: string
}

const config = AbeleConfig.getInstance()
const rows = reactive<Row[]>(config.attachmentRules.map((rule) => ({ ...rule, key: nanoid() })))

const ruleOf = ({ notesFolder, attachmentsFolder }: AttachmentRule): AttachmentRule => ({
  notesFolder,
  attachmentsFolder,
})

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
    rows.splice(0, rows.length, ...saved.map((rule) => ({ ...rule, key: nanoid() })))
  }
)

const ruleName = (row: Row): string => {
  if (!row.notesFolder.trim()) return 'New rule'
  const folder = normalizeFolder(row.notesFolder)
  return folder ? `Notes in ${folder}` : 'Every note'
}

const ruleDesc = (row: Row): string => {
  if (!isCompleteRule(row)) return 'Fill in both folders for the rule to apply.'
  const folder = attachmentSetting(row.attachmentsFolder)
  if (folder === '/') return 'Attachments go to the vault root.'
  if (folder === './') return 'Attachments go beside the note.'
  if (folder.startsWith('./')) return `Attachments go to ${folder.slice(2)} beside the note.`
  return `Attachments go to ${folder}.`
}

const change = (row: Row, field: keyof AttachmentRule, value: string) => {
  row[field] = value
  save()
}

const add = () => {
  rows.push({ notesFolder: '', attachmentsFolder: '', key: nanoid() })
  save()
}

const remove = (index: number) => {
  rows.splice(index, 1)
  save()
}
</script>
