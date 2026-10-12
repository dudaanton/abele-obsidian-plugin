<template>
  <Section title="Header buttons">
    <template #desc>
      Buttons above a note's text that run a command or a script, on the notes you choose, in this
      order. A script can be handed the note's values: <code>{{ variableExamples }}</code> or any
      property, <code>{{ frontmatterExample }}</code>.
    </template>

    <!-- One row per button, in the order they stand in the header: its glyph and name, what it
         runs and where in a quiet line (or that it shows nowhere), moved up and down, on or off,
         and the rest in a window of its own. -->
    <Setting
      v-for="(button, idx) in buttons"
      :key="button.id"
      class="abele-header-buttons__row"
      :class="{ 'abele-header-buttons__row_off': button.enabled === false }"
    >
      <template #name>
        <span class="abele-header-buttons__name"
          ><Icon :icon="button.icon || 'play'" no-hover class="abele-header-buttons__glyph" />{{
            button.name || 'Unnamed button'
          }}</span
        >
      </template>
      <template #desc>
        <span
          v-if="button.enabled !== false && problemsOf(button).nowhere"
          class="mod-warning"
          :title="problemsOf(button).nowhere"
          >Shows nowhere · {{ subtitleOf(button) }}</span
        >
        <template v-else>{{ subtitleOf(button) }}</template>
      </template>
      <Icon
        icon="arrow-up"
        :disabled="idx === 0"
        :tooltip="idx === 0 ? 'Move earlier — already the first' : 'Move earlier in the header'"
        @click="move(idx, -1)"
      />
      <Icon
        icon="arrow-down"
        :disabled="idx === buttons.length - 1"
        :tooltip="
          idx === buttons.length - 1 ? 'Move later — already the last' : 'Move later in the header'
        "
        @click="move(idx, 1)"
      />
      <Icon icon="settings" tooltip="Change this button" @click="editing = idx" />
      <Checkbox
        :is-enabled="button.enabled !== false"
        @toggle="updateFlag(idx, 'enabled', button.enabled === false)"
      />
    </Setting>
    <Setting
      :name="buttons.length ? 'Add another button' : 'No header buttons yet'"
      desc="A command or a script, on the notes you choose."
    >
      <Button text="Add button" tooltip="Add a header button and set it up" @click="addAndEdit" />
    </Setting>

    <ObsidianModal
      v-if="editing !== null && edited"
      :title="edited.name || 'New button'"
      @close="editing = null"
    >
      <Setting heading name="What it runs" />
      <Setting name="Runs" desc="A command from anywhere in Obsidian, or one of your scripts.">
        <Dropdown
          class="abele-header-buttons__runs"
          :options="RUNS_OPTIONS"
          :model-value="runsOf(edited)"
          @update:model-value="updateRuns(editing, $event)"
        />
      </Setting>
      <Setting
        name="Name"
        :desc="
          isCommand(edited)
            ? 'Shown as the button\'s tooltip, and in the menu where it does not fit.'
            : 'Shown on the button, or as its tooltip when it is icon only.'
        "
      >
        <Input
          :model-value="edited.name"
          placeholder="e.g. Fetch details"
          @update:model-value="updateField(editing, 'name', $event)"
        />
      </Setting>
      <Setting name="Icon" desc="Shown on the button in the header.">
        <Button
          :icon="edited.icon || 'play'"
          :text="edited.icon || 'play'"
          tooltip="Choose the icon from the whole set, by picture or by name"
          @click="pickingIconFor = editing"
        />
      </Setting>
      <Setting v-if="isCommand(edited)" name="Command" desc="Command the button runs.">
        <Button
          :text="edited.commandId ? commandName(edited.commandId) : 'Choose command...'"
          tooltip="Search every command Obsidian has for the one this button runs"
          @click="chooseCommand(editing)"
        />
      </Setting>
      <Setting
        v-if="!isCommand(edited)"
        name="Icon only"
        desc="Leave the name off the header, for a header already full."
      >
        <Checkbox
          :is-enabled="edited.iconOnly === true"
          @toggle="updateFlag(editing, 'iconOnly', !edited.iconOnly)"
        />
      </Setting>
      <Setting v-if="!isCommand(edited)" name="Script" desc="Script the button runs.">
        <Button
          :text="edited.scriptName || 'Choose script...'"
          tooltip="Search the scripts for the one this button runs"
          @click="chooseScript(editing)"
        />
      </Setting>

      <template v-for="param in isCommand(edited) ? [] : paramsOf(edited)" :key="param.name">
        <Setting :name="param.name" :desc="paramDescription(param)">
          <Input
            :model-value="edited.params[param.name] || ''"
            :placeholder="param.default || ''"
            @update:model-value="updateParam(editing, param.name, $event)"
          />
        </Setting>
      </template>
      <p
        v-if="!isCommand(edited) && edited.scriptName && !paramsOf(edited).length"
        class="setting-item-description"
      >
        This script takes no parameters.
      </p>

      <Setting heading name="Where it shows" />
      <Setting name="On every note" desc="Whatever its type, tags or folder.">
        <Checkbox
          :is-enabled="edited.allNotes === true"
          @toggle="updateFlag(editing, 'allNotes', !edited.allNotes)"
        />
      </Setting>
      <template v-if="!edited.allNotes">
        <Setting name="Note types" :desc="typesDescription(edited)">
          <Input
            :model-value="edited.noteTypes.join(', ')"
            placeholder="e.g. movie, book"
            @update:model-value="updateList(editing, 'noteTypes', $event)"
          />
        </Setting>
        <Setting name="Folders" :desc="foldersDescription(edited)">
          <Input
            :model-value="(edited.folders ?? []).join(', ')"
            placeholder="e.g. Films, Library/Books"
            @update:model-value="updateList(editing, 'folders', $event)"
          />
        </Setting>
        <Setting
          name="Tags"
          desc="Comma-separated, with or without #. Notes with one of these, or a tag nested under it, show the button too."
        >
          <Input
            :model-value="(edited.tags ?? []).join(', ')"
            placeholder="e.g. work, project/site"
            @update:model-value="updateList(editing, 'tags', $event)"
          />
        </Setting>
      </template>
      <Setting
        v-if="isCommand(edited)"
        name="Also on other files"
        desc="PDFs, canvases, books and other files opened in a tab, as far as its folders and tags reach. They have no type or properties."
      >
        <Checkbox
          :is-enabled="edited.otherFiles === true"
          @toggle="updateFlag(editing, 'otherFiles', !edited.otherFiles)"
        />
      </Setting>

      <Setting
        name="Only when its properties"
        :desc="
          edited.conditions?.length
            ? 'The note must also have these in its frontmatter.'
            : 'Show it only on notes whose frontmatter fits, a status or a filled-in date, say.'
        "
      >
        <Button
          text="Add condition"
          tooltip="Ask for one more property of the note"
          @click="addCondition(editing)"
        />
      </Setting>
      <Setting
        v-if="(edited.conditions?.length ?? 0) > 1"
        name="Conditions needed"
        desc="Whether the note has to fit every condition below or any one of them."
      >
        <Dropdown
          class="abele-header-buttons__mode"
          :options="MODE_OPTIONS"
          :model-value="edited.conditionMode ?? 'all'"
          @update:model-value="updateMode(editing, $event)"
        />
      </Setting>
      <Setting
        v-for="(condition, cIdx) in edited.conditions ?? []"
        :key="cIdx"
        :name="condition.property.trim() || 'Property'"
        :desc="describeCondition(condition)"
      >
        <div class="abele-header-buttons__condition">
          <Input
            class="abele-header-buttons__property"
            :model-value="condition.property"
            placeholder="e.g. status"
            @update:model-value="updateCondition(editing, cIdx, { property: $event })"
          />
          <Dropdown
            class="abele-header-buttons__test"
            :options="TEST_OPTIONS"
            :model-value="condition.test"
            @update:model-value="updateCondition(editing, cIdx, { test: $event as PropertyTest })"
          />
          <Input
            v-if="comparesValue(condition.test)"
            class="abele-header-buttons__value"
            :model-value="condition.value"
            placeholder="e.g. todo"
            @update:model-value="updateCondition(editing, cIdx, { value: $event })"
          />
          <Icon
            class="abele-header-buttons__remove"
            icon="x"
            tooltip="Remove this condition"
            @click="removeCondition(editing, cIdx)"
          />
        </div>
      </Setting>
      <template #footer>
        <div class="abele-modal__actions">
          <Button
            text="Delete"
            warning
            tooltip="Delete this button"
            class="abele-header-buttons__delete"
            @click="pendingRemoval = edited"
          />
          <Button text="Done" accent tooltip="Close this window; changes are kept as you make them" @click="editing = null" />
        </div>
      </template>
    </ObsidianModal>

    <IconPicker
      v-if="pickingIconFor !== null && buttons[pickingIconFor]"
      :current="buttons[pickingIconFor].icon"
      @choose="chooseIcon"
      @close="pickingIconFor = null"
    />

    <ConfirmModal
      v-if="pendingRemoval"
      title="Delete header button"
      :message="`Delete ${pendingRemoval.name || 'this unnamed button'}? It disappears from every
        note header it was on. This cannot be undone.`"
      :confirm-tooltip="`Delete ${pendingRemoval.name || 'the button'}`"
      @confirm="remove(pendingRemoval.id)"
      @close="pendingRemoval = null"
    />
  </Section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { nanoid } from 'nanoid'
import Setting from '../../obsidian/Setting.vue'
import Section from '../../obsidian/Section.vue'
import Checkbox from '../../obsidian/Checkbox.vue'
import Input from '../../obsidian/Input.vue'
import Button from '../../obsidian/Button.vue'
import Icon from '../../obsidian/Icon.vue'
import ObsidianModal from '../../obsidian/Modal.vue'
import ConfirmModal from '../../obsidian/ConfirmModal.vue'
import Dropdown from '../../obsidian/Dropdown.vue'
import IconPicker from '../../obsidian/IconPicker.vue'
import {
  AbeleConfig,
  type HeaderButtonCondition,
  type HeaderButtonDefinition,
  type PropertyTest,
} from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
import { placementProblems, type VaultShape } from '@/helpers/headerButtons'
import { TFolder } from 'obsidian'
import { findScriptByName } from '@/scripting/runScript'
import { pickCommand, pickScript } from '@/helpers/suggesters/RunnablePicker'
import { buttonRuns } from '@/helpers/headerButtons'
import { hasCommand } from '@/headerButtons/viewActions'
import { GlobalStore } from '@/stores/GlobalStore'
import { useSettingsSave } from '@/composables/useSettingsSave'
import type { ScriptParam } from '@/scripting/types'

const config = AbeleConfig.getInstance()

/**
 * Written here rather than in the template above: a `{{ ... }}` inside a template is an
 * interpolation, so the braces these are made of cannot be typed there directly.
 */
const variableExamples = ['title', 'path', 'folder', 'date:YYYY-MM-DD']
  .map((name) => `{{${name}}}`)
  .join(', ')
const frontmatterExample = '{{status}}'

const copy = (): HeaderButtonDefinition[] =>
  JSON.parse(JSON.stringify(config.headerButtons || [])) as HeaderButtonDefinition[]

const buttons = ref<HeaderButtonDefinition[]>(copy())
const pendingRemoval = ref<HeaderButtonDefinition | null>(null)
/**
 * The types and folders the vault has, read once as the screen opens, so a button set up for
 * a type no note has — `tasks` where notes say `task` — says so here instead of silently never
 * appearing.
 */
const vaultShape = ((): VaultShape => {
  const { app } = GlobalStore.getInstance()
  const types = new Set<string>()
  for (const file of app.vault.getMarkdownFiles()) {
    const type: unknown = app.metadataCache.getFileCache(file)?.frontmatter?.type
    if (typeof type === 'string' && type.trim()) types.add(type.trim().toLowerCase())
  }
  return {
    types,
    folderExists: (folder) =>
      folder === '/' || app.vault.getAbstractFileByPath(folder) instanceof TFolder,
    hasCommand: (id) => hasCommand(app, id),
  }
})()


const RUNS_OPTIONS = [
  { value: 'command', display: 'A command' },
  { value: 'script', display: 'A script' },
]

const runsOf = buttonRuns
const isCommand = (button: HeaderButtonDefinition) => buttonRuns(button) === 'command'

interface CommandInfo {
  id: string
  name: string
  icon?: string
}

/** A command as Obsidian has it now, or undefined while its plugin is off. */
const findCommand = (id: string): CommandInfo | undefined => {
  const commands = (
    GlobalStore.getInstance().app as unknown as {
      commands?: { findCommand?(id: string): CommandInfo | undefined }
    }
  ).commands
  return commands?.findCommand?.(id)
}

/** The command's name as the palette shows it; its id while it is not there. */
const commandName = (id: string): string => findCommand(id)?.name ?? id

const subtitleOf = (button: HeaderButtonDefinition): string => {
  if (isCommand(button)) {
    return button.commandId ? commandName(button.commandId) : 'No command chosen yet'
  }
  return button.scriptName || 'No script chosen yet'
}

const problemsOf = (button: HeaderButtonDefinition) => placementProblems(button, vaultShape)

const quoted = (items: string[]) => items.map((item) => `"${item}"`).join(', ')

const typesDescription = (button: HeaderButtonDefinition): string => {
  const plain = 'Comma-separated. Notes whose type frontmatter is one of these show the button.'
  const unknown = problemsOf(button).unknownTypes
  if (!unknown.length) return plain
  const known = [...vaultShape.types].sort().slice(0, 12)
  const which =
    unknown.length === 1
      ? `No note in this vault has the type ${quoted(unknown)}.`
      : `No note in this vault has the types ${quoted(unknown)}.`
  return known.length ? `${which} Types in use: ${known.join(', ')}.` : which
}

const foldersDescription = (button: HeaderButtonDefinition): string => {
  const plain =
    'Comma-separated. Notes anywhere under one of these show the button too. A * stands for ' +
    'any one folder, ** for any depth: Projects/*/Notes.'
  const missing = problemsOf(button).missingFolders
  if (!missing.length) return plain
  return missing.length === 1
    ? `No folder ${quoted(missing)} in this vault.`
    : `No folders ${quoted(missing)} in this vault.`
}

/** The button whose icon is being chosen, by its place in the list. */
const pickingIconFor = ref<number | null>(null)

const TEST_OPTIONS: { value: PropertyTest; display: string }[] = [
  { value: 'equals', display: 'is' },
  { value: 'not-equals', display: 'is not' },
  { value: 'filled', display: 'is filled in' },
  { value: 'empty', display: 'is empty' },
]

const MODE_OPTIONS = [
  { value: 'all', display: 'All of them' },
  { value: 'any', display: 'Any one' },
]

const { save } = useSettingsSave(
  () => {
    config.headerButtons = JSON.parse(JSON.stringify(buttons.value))
  },
  () => {
    buttons.value = copy()
  }
)

/**
 * The parameters the chosen script declares. The form is built from these rather than from
 * free-form key/value rows, so a button cannot be configured with a parameter its script has
 * never heard of.
 */
const paramsOf = (button: HeaderButtonDefinition): ScriptParam[] =>
  button.scriptName ? (findScriptByName(button.scriptName)?.meta.params ?? []) : []

const paramDescription = (param: ScriptParam): string => {
  const described = param.description || 'No description.'
  return param.default ? `${described} Defaults to "${param.default}".` : described
}

/** Scripts a header button may run: not the ones switched off in their own header. */
const runnableScripts = () =>
  ScriptService.getInstance().scriptList.value.filter((s) => s.meta.enabled !== false)

/** A new button runs a command, on every note: narrowing it down is the next step, if any. */
const addButton = () => {
  buttons.value.push({
    id: nanoid(8),
    name: '',
    icon: 'play',
    noteTypes: [],
    runs: 'command',
    scriptName: '',
    commandId: '',
    params: {},
    enabled: true,
    iconOnly: false,
    allNotes: true,
    folders: [],
    tags: [],
    otherFiles: false,
    conditions: [],
    conditionMode: 'all',
  })
  save()
}

const remove = (id: string) => {
  buttons.value = buttons.value.filter((b) => b.id !== id)
  pendingRemoval.value = null
  editing.value = null
  save()
}

/** The button open in its window, by its place in the list. */
const editing = ref<number | null>(null)
const edited = computed(() => (editing.value === null ? null : buttons.value[editing.value]))

const addAndEdit = () => {
  addButton()
  editing.value = buttons.value.length - 1
}

/** The order here is the order in the header. */
const move = (idx: number, by: -1 | 1) => {
  const to = idx + by
  if (to < 0 || to >= buttons.value.length) return
  const next = [...buttons.value]
  ;[next[idx], next[to]] = [next[to], next[idx]]
  buttons.value = next
  save()
}

const chooseScript = async (idx: number) => {
  const script = await pickScript(GlobalStore.getInstance().app, runnableScripts())
  if (script) updateField(idx, 'scriptName', script.meta.name)
}

/**
 * The command, from every command Obsidian has, scripts' included. A button with no name or
 * icon of its own yet takes the command's, which is what it would have been called anyway.
 */
const chooseCommand = async (idx: number) => {
  const command = await pickCommand(GlobalStore.getInstance().app)
  if (!command) return
  const button = buttons.value[idx]
  button.commandId = command.id
  if (!button.name.trim()) button.name = command.name
  if ((!button.icon || button.icon === 'play') && command.icon) button.icon = command.icon
  save()
}

/** Switching what it runs keeps both the script and the command, so switching back loses nothing. */
const updateRuns = (idx: number, runs: string) => {
  buttons.value[idx].runs = runs === 'script' ? 'script' : 'command'
  save()
}

const updateField = (idx: number, field: 'name' | 'icon' | 'scriptName', value: string) => {
  const changedScript = field === 'scriptName' && buttons.value[idx].scriptName !== value
  buttons.value[idx][field] = value
  // A button's parameters belong to the script it runs; carrying them to another script would
  // leave values under names the new one does not declare. Choosing the same one again is
  // not a change, and must not cost the parameters.
  if (changedScript) buttons.value[idx].params = {}
  save()
}

const updateFlag = (
  idx: number,
  field: 'enabled' | 'iconOnly' | 'allNotes' | 'otherFiles',
  value: boolean
) => {
  buttons.value[idx][field] = value
  save()
}

const updateList = (idx: number, field: 'noteTypes' | 'folders' | 'tags', value: string) => {
  buttons.value[idx][field] = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  save()
}

const chooseIcon = (icon: string) => {
  if (pickingIconFor.value !== null) updateField(pickingIconFor.value, 'icon', icon)
  pickingIconFor.value = null
}

const comparesValue = (test: PropertyTest) => test === 'equals' || test === 'not-equals'

/** The condition read out as a sentence, so a row says what it asks without parsing. */
const describeCondition = (c: HeaderButtonCondition): string => {
  const property = c.property.trim()
  if (!property) return 'Name a frontmatter property; until then this condition is ignored.'
  switch (c.test) {
    case 'filled':
      return `Notes whose ${property} is filled in.`
    case 'empty':
      return `Notes whose ${property} is empty or missing.`
    case 'not-equals':
      return `Notes whose ${property} is anything but "${c.value.trim()}", missing included.`
    default:
      return c.value.trim()
        ? `Notes whose ${property} is "${c.value.trim()}", or holds it in a list.`
        : `Type the value ${property} must have.`
  }
}

const addCondition = (idx: number) => {
  const button = buttons.value[idx]
  button.conditions = [...(button.conditions ?? []), { property: '', test: 'equals', value: '' }]
  save()
}

const updateCondition = (idx: number, cIdx: number, change: Partial<HeaderButtonCondition>) => {
  const button = buttons.value[idx]
  const conditions = [...(button.conditions ?? [])]
  conditions[cIdx] = { ...conditions[cIdx], ...change }
  button.conditions = conditions
  save()
}

const removeCondition = (idx: number, cIdx: number) => {
  const button = buttons.value[idx]
  button.conditions = (button.conditions ?? []).filter((_, i) => i !== cIdx)
  save()
}

const updateMode = (idx: number, mode: string) => {
  buttons.value[idx].conditionMode = mode === 'any' ? 'any' : 'all'
  save()
}

const updateParam = (idx: number, name: string, value: string) => {
  buttons.value[idx].params = { ...buttons.value[idx].params, [name]: value }
  save()
}
</script>

<style lang="scss">
.abele-header-buttons__name {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-2);
}

.abele-header-buttons__glyph {
  flex: 0 0 auto;
  --icon-size: var(--icon-s);
}

// Off reads as off: the name quieter, the switch says the rest.
.abele-header-buttons__row_off .abele-header-buttons__name {
  color: var(--text-muted);
}

// Order, change and on at the end of the row, which stays one line.
.abele-header-buttons__row > .setting-item-control {
  flex-wrap: nowrap;
  justify-content: flex-end;
  gap: var(--size-2-2);
}

.abele-header-buttons__delete {
  margin-inline-end: auto;
}

/**
 * A condition as one small form: the property and the test side by side with the glyph that
 * removes it, the value it is compared with on the line under them, across the whole column.
 */
.abele-header-buttons__condition {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto;
  grid-template-areas:
    'property test remove'
    'value value value';
  align-items: center;
  gap: var(--size-4-2);
  width: 100%;

  > .abele-header-buttons__property {
    grid-area: property;
  }

  > .abele-header-buttons__test {
    grid-area: test;

    select {
      width: 100%;
    }
  }

  > .abele-header-buttons__value {
    grid-area: value;
  }

  > .abele-header-buttons__remove {
    grid-area: remove;
  }
}
</style>
