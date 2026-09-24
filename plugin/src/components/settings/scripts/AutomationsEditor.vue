<template>
  <Section title="Automations">
    <template #desc>
      Scripts that run by themselves when something happens to a note: a task completed, a note of
      some type changed. The script reads what happened as <code>event</code>. Parameters accept
      <code>{{ variableExamples }}</code> and any frontmatter field of the note. They run on the
      device where the change was made; a script's own writes never set off the same automation
      again.
    </template>

    <EmptyState v-if="!rules.length" text="No automations yet." />

    <CardGrid v-else stack>
      <Card
        v-for="(rule, idx) in rules"
        :key="rule.id"
        :title="rule.name || EVENT_LABELS[rule.event]"
        icon="zap"
        :subtitle="subtitleOf(rule)"
      >
        <template #badges>
          <Badge v-if="!rule.enabled" text="Off" />
        </template>
        <template #actions>
          <Icon icon="trash" tooltip="Delete this automation" @click="pendingRemoval = rule" />
        </template>

        <Setting name="Run this automation" desc="Off keeps it set up here without running it.">
          <Checkbox :is-enabled="rule.enabled" @toggle="update(idx, { enabled: !rule.enabled })" />
        </Setting>
        <Setting name="Name" desc="What it is called here and in the list of script runs.">
          <Input
            :model-value="rule.name"
            placeholder="e.g. Log completed tasks"
            @update:model-value="update(idx, { name: $event })"
          />
        </Setting>
        <Setting name="When" desc="What has to happen for the script to run.">
          <Dropdown
            :options="EVENT_OPTIONS"
            :model-value="rule.event"
            @update:model-value="update(idx, { event: $event as EventKind })"
          />
        </Setting>

        <Setting
          v-if="!isTaskKind(rule.event)"
          name="Note types"
          desc="Comma-separated. Only notes whose type frontmatter is one of these. Empty is any note."
        >
          <Input
            :model-value="rule.noteTypes.join(', ')"
            placeholder="e.g. movie, book"
            @update:model-value="update(idx, { noteTypes: list($event) })"
          />
        </Setting>
        <Setting
          name="Folders"
          desc="Comma-separated. Only notes anywhere under one of these. Empty is anywhere."
        >
          <Input
            :model-value="rule.folders.join(', ')"
            placeholder="e.g. Tasks, Work"
            @update:model-value="update(idx, { folders: list($event) })"
          />
        </Setting>
        <Setting name="Property" desc="Only notes with this frontmatter property. Optional.">
          <Input
            :model-value="rule.property"
            placeholder="e.g. area"
            @update:model-value="update(idx, { property: $event })"
          />
        </Setting>
        <Setting
          v-if="rule.property.trim()"
          name="Equals"
          desc="…holding this value, or one of its values. Empty is any value."
        >
          <Input
            :model-value="rule.value"
            placeholder="e.g. home"
            @update:model-value="update(idx, { value: $event })"
          />
        </Setting>

        <Setting name="Script" desc="Script the automation runs.">
          <Button
            :text="rule.scriptName || 'Choose script...'"
            tooltip="Search the scripts for the one this automation runs"
            @click="chooseScript(idx)"
          />
        </Setting>
        <template v-for="param in paramsOf(rule)" :key="param.name">
          <Setting :name="param.name" :desc="paramDescription(param)">
            <Input
              :model-value="rule.params[param.name] || ''"
              :placeholder="param.default || ''"
              @update:model-value="updateParam(idx, param.name, $event)"
            />
          </Setting>
        </template>
        <p v-if="rule.scriptName && !paramsOf(rule).length" class="setting-item-description">
          This script takes no parameters.
        </p>

        <Setting
          name="At most every (seconds)"
          desc="For one note. Changes in between are gathered into one run at the end. 0 runs on every change."
        >
          <Input
            :model-value="String(rule.throttleSeconds)"
            placeholder="5"
            @update:model-value="update(idx, { throttleSeconds: seconds($event) })"
          />
        </Setting>
        <Setting
          name="Also for changes from other devices"
          desc="Off, a change that arrives by sync runs nothing here: it already ran on the device where it was made."
        >
          <Checkbox
            :is-enabled="rule.includeExternal"
            @toggle="update(idx, { includeExternal: !rule.includeExternal })"
          />
        </Setting>
      </Card>
    </CardGrid>

    <div class="abele-automations__actions">
      <Button text="Add automation" tooltip="Add another automation" @click="addRule" />
    </div>

    <ConfirmModal
      v-if="pendingRemoval"
      title="Delete automation"
      :message="`Delete ${pendingRemoval.name || 'this unnamed automation'}? Its script stops
        running by itself. This cannot be undone.`"
      :confirm-tooltip="`Delete ${pendingRemoval.name || 'the automation'}`"
      @confirm="remove(pendingRemoval.id)"
      @close="pendingRemoval = null"
    />
  </Section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Setting from '../../obsidian/Setting.vue'
import Section from '../../obsidian/Section.vue'
import Checkbox from '../../obsidian/Checkbox.vue'
import Input from '../../obsidian/Input.vue'
import Button from '../../obsidian/Button.vue'
import Icon from '../../obsidian/Icon.vue'
import Card from '../../obsidian/Card.vue'
import CardGrid from '../../obsidian/CardGrid.vue'
import Badge from '../../obsidian/Badge.vue'
import Dropdown from '../../obsidian/Dropdown.vue'
import EmptyState from '../../obsidian/EmptyState.vue'
import ConfirmModal from '../../obsidian/ConfirmModal.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
import { findScriptByName } from '@/scripting/runScript'
import { pickScript } from '@/helpers/suggesters/RunnablePicker'
import { GlobalStore } from '@/stores/GlobalStore'
import { useSettingsSave } from '@/composables/useSettingsSave'
import type { ScriptParam } from '@/scripting/types'
import {
  EVENT_KINDS,
  EVENT_LABELS,
  isTaskKind,
  normalizeRule,
  type AutomationRule,
  type EventKind,
} from '@/automations/types'

const config = AbeleConfig.getInstance()

/** Written here: `{{ ... }}` in the template above would be an interpolation. */
const variableExamples = ['title', 'path', 'folder', 'event', 'date:YYYY-MM-DD']
  .map((name) => `{{${name}}}`)
  .join(', ')

const EVENT_OPTIONS = EVENT_KINDS.map((kind) => ({ value: kind, display: EVENT_LABELS[kind] }))

const copy = (): AutomationRule[] =>
  JSON.parse(JSON.stringify(config.automations || [])) as AutomationRule[]

const rules = ref<AutomationRule[]>(copy())
const pendingRemoval = ref<AutomationRule | null>(null)

const { save } = useSettingsSave(
  () => {
    config.automations = JSON.parse(JSON.stringify(rules.value))
  },
  () => {
    rules.value = copy()
  }
)

const subtitleOf = (rule: AutomationRule): string =>
  rule.scriptName ? `${EVENT_LABELS[rule.event]} → ${rule.scriptName}` : 'No script chosen yet'

/** The parameters the chosen script declares — the same model as a header button's. */
const paramsOf = (rule: AutomationRule): ScriptParam[] =>
  rule.scriptName ? (findScriptByName(rule.scriptName)?.meta.params ?? []) : []

const paramDescription = (param: ScriptParam): string => {
  const said = param.description.trim()
  const described = !said ? 'No description.' : /[.!?]$/.test(said) ? said : `${said}.`
  return param.default ? `${described} Defaults to "${param.default}".` : described
}

const list = (value: string): string[] =>
  value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

/** Whole seconds; anything that is not a number is taken as no limit. */
const seconds = (value: string): number => {
  const n = Math.floor(Number(value))
  return Number.isFinite(n) && n > 0 ? n : 0
}

const runnableScripts = () =>
  ScriptService.getInstance().scriptList.value.filter((s) => s.meta.enabled !== false)

const addRule = () => {
  rules.value.push(normalizeRule({ event: 'task.completed' }))
  save()
}

const remove = (id: string) => {
  rules.value = rules.value.filter((r) => r.id !== id)
  pendingRemoval.value = null
  save()
}

const update = (idx: number, patch: Partial<AutomationRule>) => {
  rules.value[idx] = { ...rules.value[idx], ...patch }
  save()
}

const chooseScript = async (idx: number) => {
  const script = await pickScript(GlobalStore.getInstance().app, runnableScripts())
  if (!script || script.meta.name === rules.value[idx].scriptName) return
  // Parameters belong to the script; another script does not declare the same ones.
  update(idx, { scriptName: script.meta.name, params: {} })
}

const updateParam = (idx: number, name: string, value: string) => {
  update(idx, { params: { ...rules.value[idx].params, [name]: value } })
}
</script>

<style lang="scss">
.abele-automations__actions {
  margin-top: var(--size-4-3);
}
</style>
