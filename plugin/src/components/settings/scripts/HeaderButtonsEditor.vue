<template>
  <Section title="Header buttons">
    <template #desc>
      Buttons in the header of a note, each running a script. A button shows on notes of its types,
      on notes in its folders, or on every note, and only where the note's properties fit its
      conditions, in the order listed here. Parameters accept
      <code>{{ variableExamples }}</code> and any frontmatter field of the note, such as
      <code>{{ frontmatterExample }}</code
      >.
    </template>

    <EmptyState v-if="!buttons.length" text="No header buttons yet." />

    <CardGrid v-else stack>
      <Card
        v-for="(button, idx) in buttons"
        :key="button.id"
        :title="button.name || 'Unnamed button'"
        :icon="button.icon || 'play'"
        :subtitle="button.scriptName || 'No script chosen yet'"
      >
        <template #badges>
          <Badge v-if="button.enabled === false" text="Off" />
          <Badge v-else-if="problemsOf(button).nowhere" text="Shows nowhere" color="orange" />
        </template>
        <template #actions>
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
              idx === buttons.length - 1
                ? 'Move later — already the last'
                : 'Move later in the header'
            "
            @click="move(idx, 1)"
          />
          <Icon icon="trash" tooltip="Delete this button" @click="pendingRemoval = button" />
        </template>

        <p
          v-if="button.enabled !== false && problemsOf(button).nowhere"
          class="setting-item-description abele-header-buttons__warning"
        >
          {{ problemsOf(button).nowhere }}
        </p>

        <Setting name="Show this button" desc="Off keeps it set up here without showing it.">
          <Checkbox
            :is-enabled="button.enabled !== false"
            @toggle="updateFlag(idx, 'enabled', button.enabled === false)"
          />
        </Setting>
        <Setting name="Name" desc="Shown on the button, or as its tooltip when it is icon only.">
          <Input
            :model-value="button.name"
            placeholder="e.g. Fetch details"
            @update:model-value="updateField(idx, 'name', $event)"
          />
        </Setting>
        <Setting name="Icon" desc="Shown on the button in the header.">
          <Button
            :icon="button.icon || 'play'"
            :text="button.icon || 'play'"
            tooltip="Choose the icon from the whole set, by picture or by name"
            @click="pickingIconFor = idx"
          />
        </Setting>
        <Setting name="Icon only" desc="Leave the name off the header, for a header already full.">
          <Checkbox
            :is-enabled="button.iconOnly === true"
            @toggle="updateFlag(idx, 'iconOnly', !button.iconOnly)"
          />
        </Setting>
        <Setting name="Script" desc="Script the button runs.">
          <Button
            :text="button.scriptName || 'Choose script...'"
            tooltip="Search the scripts for the one this button runs"
            @click="chooseScript(idx)"
          />
        </Setting>

        <template v-for="param in paramsOf(button)" :key="param.name">
          <Setting :name="param.name" :desc="paramDescription(param)">
            <Input
              :model-value="button.params[param.name] || ''"
              :placeholder="param.default || ''"
              @update:model-value="updateParam(idx, param.name, $event)"
            />
          </Setting>
        </template>
        <p v-if="button.scriptName && !paramsOf(button).length" class="setting-item-description">
          This script takes no parameters.
        </p>

        <Setting name="On every note" desc="Whatever its type or folder.">
          <Checkbox
            :is-enabled="button.allNotes === true"
            @toggle="updateFlag(idx, 'allNotes', !button.allNotes)"
          />
        </Setting>
        <template v-if="!button.allNotes">
          <Setting name="Note types" :desc="typesDescription(button)">
            <Input
              :model-value="button.noteTypes.join(', ')"
              placeholder="e.g. movie, book"
              @update:model-value="updateList(idx, 'noteTypes', $event)"
            />
          </Setting>
          <Setting name="Folders" :desc="foldersDescription(button)">
            <Input
              :model-value="(button.folders ?? []).join(', ')"
              placeholder="e.g. Films, Library/Books"
              @update:model-value="updateList(idx, 'folders', $event)"
            />
          </Setting>
        </template>

        <Setting
          name="Only when its properties"
          :desc="
            button.conditions?.length
              ? 'The note must also have these in its frontmatter.'
              : 'Show it only on notes whose frontmatter fits, a status or a filled-in date, say.'
          "
        >
          <Button
            text="Add condition"
            tooltip="Ask for one more property of the note"
            @click="addCondition(idx)"
          />
        </Setting>
        <Setting
          v-if="(button.conditions?.length ?? 0) > 1"
          name="Conditions needed"
          desc="Whether the note has to fit every condition below or any one of them."
        >
          <Dropdown
            class="abele-header-buttons__mode"
            :options="MODE_OPTIONS"
            :model-value="button.conditionMode ?? 'all'"
            @update:model-value="updateMode(idx, $event)"
          />
        </Setting>
        <Setting
          v-for="(condition, cIdx) in button.conditions ?? []"
          :key="cIdx"
          :name="condition.property.trim() || 'Property'"
          :desc="describeCondition(condition)"
        >
          <div class="abele-header-buttons__condition">
            <Input
              class="abele-header-buttons__property"
              :model-value="condition.property"
              placeholder="e.g. status"
              @update:model-value="updateCondition(idx, cIdx, { property: $event })"
            />
            <Dropdown
              class="abele-header-buttons__test"
              :options="TEST_OPTIONS"
              :model-value="condition.test"
              @update:model-value="updateCondition(idx, cIdx, { test: $event as PropertyTest })"
            />
            <Input
              v-if="comparesValue(condition.test)"
              class="abele-header-buttons__value"
              :model-value="condition.value"
              placeholder="e.g. todo"
              @update:model-value="updateCondition(idx, cIdx, { value: $event })"
            />
            <Icon
              class="abele-header-buttons__remove"
              icon="x"
              tooltip="Remove this condition"
              @click="removeCondition(idx, cIdx)"
            />
          </div>
        </Setting>
      </Card>
    </CardGrid>

    <div class="abele-header-buttons__actions">
      <Button text="Add button" tooltip="Add another header button" @click="addButton" />
    </div>

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
import { ref } from 'vue'
import { nanoid } from 'nanoid'
import Setting from '../../obsidian/Setting.vue'
import Section from '../../obsidian/Section.vue'
import Checkbox from '../../obsidian/Checkbox.vue'
import Input from '../../obsidian/Input.vue'
import Button from '../../obsidian/Button.vue'
import Icon from '../../obsidian/Icon.vue'
import Card from '../../obsidian/Card.vue'
import CardGrid from '../../obsidian/CardGrid.vue'
import Badge from '../../obsidian/Badge.vue'
import EmptyState from '../../obsidian/EmptyState.vue'
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
import { pickScript } from '@/helpers/suggesters/RunnablePicker'
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
    folderExists: (folder) => app.vault.getAbstractFileByPath(folder) instanceof TFolder,
  }
})()

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
  const plain = 'Comma-separated. Notes anywhere under one of these show the button too.'
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

const addButton = () => {
  buttons.value.push({
    id: nanoid(8),
    name: '',
    icon: 'play',
    noteTypes: [],
    scriptName: '',
    params: {},
    enabled: true,
    iconOnly: false,
    allNotes: false,
    folders: [],
    conditions: [],
    conditionMode: 'all',
  })
  save()
}

const remove = (id: string) => {
  buttons.value = buttons.value.filter((b) => b.id !== id)
  pendingRemoval.value = null
  save()
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

const updateField = (idx: number, field: 'name' | 'icon' | 'scriptName', value: string) => {
  const changedScript = field === 'scriptName' && buttons.value[idx].scriptName !== value
  buttons.value[idx][field] = value
  // A button's parameters belong to the script it runs; carrying them to another script would
  // leave values under names the new one does not declare. Choosing the same one again is
  // not a change, and must not cost the parameters.
  if (changedScript) buttons.value[idx].params = {}
  save()
}

const updateFlag = (idx: number, field: 'enabled' | 'iconOnly' | 'allNotes', value: boolean) => {
  buttons.value[idx][field] = value
  save()
}

const updateList = (idx: number, field: 'noteTypes' | 'folders', value: string) => {
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
.abele-header-buttons__actions {
  margin-top: var(--size-4-3);
}

.abele-header-buttons__warning {
  color: var(--text-warning);
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
