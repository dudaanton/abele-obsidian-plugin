<template>
  <Section
    ref="sectionEl"
    class="abele-attachment-rules"
    title="Attachment folders"
    desc="Files pasted or dropped into a note in one of these folders go to the folder its rule names. The deepest folder wins."
  >
    <template #actions>
      <Icon class="abele-attachment-rules__add" icon="plus" tooltip="Add a rule" @click="add" />
    </template>

    <template v-for="(row, index) in rows" :key="row.key">
      <Setting class="abele-attachment-rules__notes" name="Notes in">
        <Search
          :model-value="row.notesText"
          :suggester="FolderSuggest"
          label="Notes folder"
          input-class="abele-attachment-rules__path"
          placeholder="Folder"
          @update:model-value="(value: string) => changeNotes(row, value)"
        />
        <Icon icon="trash" tooltip="Remove this rule" @click="remove(index)" />
      </Setting>
      <Setting class="abele-attachment-rules__place" name="Attachments go to">
        <Dropdown
          :model-value="row.location"
          :options="LOCATION_OPTIONS"
          @update:model-value="(value: string) => change(row, 'location', value)"
        />
        <Search
          v-if="row.location === 'folder'"
          :model-value="row.attachmentsFolder"
          :suggester="FolderSuggest"
          label="Attachment folder"
          input-class="abele-attachment-rules__path"
          placeholder="Folder"
          @update:model-value="(value: string) => change(row, 'attachmentsFolder', value)"
        />
        <Input
          v-else-if="row.location === 'subfolder'"
          :model-value="row.subfolder"
          placeholder="Subfolder name"
          @update:model-value="(value: string) => change(row, 'subfolder', value)"
        />
      </Setting>
    </template>

    <EmptyState v-if="rows.length === 0" text="No rules: attachments follow Obsidian's setting.">
      <template #action>
        <Button text="Add a rule" tooltip="Add a folder rule" @click="add" />
      </template>
    </EmptyState>
  </Section>
</template>

<script setup lang="ts">
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
import EmptyState from '../obsidian/EmptyState.vue'
import { FolderSuggest } from '@/helpers/suggesters/FolderSuggester'
import { AbeleConfig } from '@/services/AbeleConfig'
import {
  normalizeFolder,
  type AttachmentLocation,
  type AttachmentRule,
} from '@/media/attachmentRules'

/** Obsidian's own words for its attachment setting's choices. */
const LOCATION_OPTIONS: { value: AttachmentLocation; display: string }[] = [
  { value: 'note', display: 'Same folder as the note' },
  { value: 'folder', display: 'In the folder specified below' },
  { value: 'subfolder', display: "In subfolder under the note's folder" },
]

/** What the notes field says for the vault root, and reads back as it. */
const WHOLE_VAULT = 'Whole vault'

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
// The bin stays on the line of the notes field however narrow the pane: the field gives way.
.abele-attachment-rules__notes > .setting-item-control {
  flex-wrap: nowrap;

  > .abele-obsidian-search {
    flex: 1 1 auto;
    min-width: 0;
  }
}
</style>
