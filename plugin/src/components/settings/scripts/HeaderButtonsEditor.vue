<template>
  <Section title="Header buttons">
    <template #desc>
      Buttons in the header of a note, each running a script. A button shows on notes of its types,
      on notes in its folders, or on every note, in the order listed here. Parameters accept
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
        <Setting name="Icon" desc="A lucide icon name, as used elsewhere in the header.">
          <Input
            :model-value="button.icon"
            placeholder="play"
            @update:model-value="updateField(idx, 'icon', $event)"
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
          <Setting
            name="Note types"
            desc="Comma-separated. Notes whose type frontmatter is one of these show the button."
          >
            <Input
              :model-value="button.noteTypes.join(', ')"
              placeholder="e.g. movie, book"
              @update:model-value="updateList(idx, 'noteTypes', $event)"
            />
          </Setting>
          <Setting
            name="Folders"
            desc="Comma-separated. Notes anywhere under one of these show the button too."
          >
            <Input
              :model-value="(button.folders ?? []).join(', ')"
              placeholder="e.g. Films, Library/Books"
              @update:model-value="updateList(idx, 'folders', $event)"
            />
          </Setting>
        </template>
      </Card>
    </CardGrid>

    <div class="abele-header-buttons__actions">
      <Button text="Add button" tooltip="Add another header button" @click="addButton" />
    </div>

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
import { AbeleConfig, type HeaderButtonDefinition } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
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

const updateParam = (idx: number, name: string, value: string) => {
  buttons.value[idx].params = { ...buttons.value[idx].params, [name]: value }
  save()
}
</script>

<style lang="scss">
.abele-header-buttons__actions {
  margin-top: var(--size-4-3);
}
</style>
