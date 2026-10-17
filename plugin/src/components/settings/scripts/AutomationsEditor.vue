<template>
  <Section :title="t('settings.scripts.AutomationsEditor.automations.ad1fb9ec')">
    <template #desc>
      <I18nText :text="t('settings.rich.59db234df027f515', { slot0: '⟪slot0⟫', slot1: '⟪slot1⟫' })"
        ><template #slot0><code>event</code></template
        ><template #slot1
          ><code>{{ variableExamples }}</code></template
        ></I18nText
      >
    </template>

    <EmptyState
      v-if="!rules.length"
      :text="t('settings.scripts.AutomationsEditor.no_automations_yet.4c27eb15')"
    />

    <CardGrid v-else stack>
      <Card
        v-for="(rule, idx) in rules"
        :key="rule.id"
        :title="rule.name || settingsLabel(EVENT_LABELS[rule.event])"
        icon="zap"
        :subtitle="subtitleOf(rule)"
      >
        <template #badges>
          <Badge
            v-if="!rule.enabled"
            :text="t('settings.scripts.AutomationsEditor.off.ca7981b4')"
          />
        </template>
        <template #actions>
          <Icon
            icon="trash"
            :tooltip="t('settings.scripts.AutomationsEditor.delete_this_automation.76539f9f')"
            @click="pendingRemoval = rule"
          />
        </template>

        <Setting
          :name="t('settings.scripts.AutomationsEditor.run_this_automation.25a70adc')"
          :desc="t('settings.scripts.AutomationsEditor.off_keeps_it_set_up.c8be185f')"
        >
          <Checkbox :is-enabled="rule.enabled" @toggle="update(idx, { enabled: !rule.enabled })" />
        </Setting>
        <Setting
          :name="t('settings.scripts.AutomationsEditor.name.dcd1d522')"
          :desc="t('settings.scripts.AutomationsEditor.what_it_is_called_here.9bc212fc')"
        >
          <Input
            :model-value="rule.name"
            :placeholder="
              t('settings.scripts.AutomationsEditor.e_g_log_completed_tasks.4209ebe8', {
                literal0: String('Log completed tasks'),
              })
            "
            @update:model-value="update(idx, { name: $event })"
          />
        </Setting>
        <Setting
          :name="t('settings.scripts.AutomationsEditor.when.cf9c7aa2')"
          :desc="t('settings.scripts.AutomationsEditor.what_has_to_happen_for.b243f2cf')"
        >
          <Dropdown
            :options="EVENT_OPTIONS"
            :model-value="rule.event"
            @update:model-value="update(idx, { event: $event as EventKind })"
          />
        </Setting>

        <Setting
          v-if="!isTaskKind(rule.event)"
          :name="t('settings.scripts.AutomationsEditor.note_types.52d728fb')"
          :desc="t('settings.scripts.AutomationsEditor.comma_separated_only_notes_whose.e9a69ad4')"
        >
          <Input
            :model-value="rule.noteTypes.join(', ')"
            :placeholder="
              t('settings.scripts.AutomationsEditor.e_g_movie_book.f621e5b4', {
                literal0: String('movie, book'),
              })
            "
            @update:model-value="update(idx, { noteTypes: list($event) })"
          />
        </Setting>
        <Setting
          :name="t('settings.scripts.AutomationsEditor.folders.c4d6bb20')"
          :desc="
            t('settings.scripts.AutomationsEditor.comma_separated_only_notes_anywhere.bc2a8774')
          "
        >
          <Input
            :model-value="rule.folders.join(', ')"
            :placeholder="
              t('settings.scripts.AutomationsEditor.e_g_tasks_work.3001dc3d', {
                literal0: String('Tasks, Work'),
              })
            "
            @update:model-value="update(idx, { folders: list($event) })"
          />
        </Setting>
        <Setting
          :name="t('settings.scripts.AutomationsEditor.property.40040cb1')"
          :desc="t('settings.scripts.AutomationsEditor.only_notes_with_this_frontmatter.dd3e2c04')"
        >
          <Input
            :model-value="rule.property"
            :placeholder="
              t('settings.scripts.AutomationsEditor.e_g_area.95b1c988', {
                literal0: String('area'),
              })
            "
            @update:model-value="update(idx, { property: $event })"
          />
        </Setting>
        <Setting
          v-if="rule.property.trim()"
          :name="t('settings.scripts.AutomationsEditor.equals.f939ae3d')"
          :desc="t('settings.scripts.AutomationsEditor.holding_this_value_or_one.1f11ec5f')"
        >
          <Input
            :model-value="rule.value"
            :placeholder="
              t('settings.scripts.AutomationsEditor.e_g_home.a9f31279', {
                literal0: String('home'),
              })
            "
            @update:model-value="update(idx, { value: $event })"
          />
        </Setting>

        <Setting
          :name="t('settings.scripts.AutomationsEditor.script.102acc10')"
          :desc="t('settings.scripts.AutomationsEditor.script_the_automation_runs.3c0b9704')"
        >
          <Button
            :text="
              rule.scriptName || t('settings.scripts.AutomationsEditor.choose_script.e582e7b2')
            "
            :tooltip="t('settings.scripts.AutomationsEditor.search_the_scripts_for_the.ea85d26d')"
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
          {{ t('settings.scripts.AutomationsEditor.this_script_takes_no_parameters.c613d6f9') }}
        </p>

        <Setting
          :name="t('settings.scripts.AutomationsEditor.at_most_every_seconds.5cdb8590')"
          :desc="t('settings.scripts.AutomationsEditor.for_one_note_changes_in.6ad4faaf')"
        >
          <Input
            :model-value="String(rule.throttleSeconds)"
            placeholder="5"
            @update:model-value="update(idx, { throttleSeconds: seconds($event) })"
          />
        </Setting>
        <Setting
          :name="t('settings.scripts.AutomationsEditor.also_for_changes_from_other.40be4225')"
          :desc="t('settings.scripts.AutomationsEditor.off_a_change_that_arrives.ab733ca2')"
        >
          <Checkbox
            :is-enabled="rule.includeExternal"
            @toggle="update(idx, { includeExternal: !rule.includeExternal })"
          />
        </Setting>
      </Card>
    </CardGrid>

    <div class="abele-automations__actions">
      <Button
        :text="t('settings.scripts.AutomationsEditor.add_automation.537c3ee4')"
        :tooltip="t('settings.scripts.AutomationsEditor.add_another_automation.78aa262d')"
        @click="addRule"
      />
    </div>

    <ConfirmModal
      v-if="pendingRemoval"
      :title="t('settings.scripts.AutomationsEditor.delete_automation.f71084e7')"
      :message="
        t('settings.scripts.AutomationsEditor.delete_value_its_script_stops.dc5e80a0', {
          value0: String(pendingRemoval.name || t('settings.terms.unnamedAutomation')),
        })
      "
      :confirm-tooltip="
        t('settings.scripts.AutomationsEditor.delete_value.8782b778', {
          value0: String(pendingRemoval.name || 'the automation'),
        })
      "
      @confirm="remove(pendingRemoval.id)"
      @close="pendingRemoval = null"
    />
  </Section>
</template>

<script setup lang="ts">
import { settingsLabel } from '@/i18n/settingsLabels'
import I18nText from '@/components/obsidian/I18nText.vue'
import { t } from '@/i18n'
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

const EVENT_OPTIONS = EVENT_KINDS.map((kind) => ({
  value: kind,
  display: settingsLabel(EVENT_LABELS[kind]),
}))

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
  rule.scriptName
    ? `${settingsLabel(EVENT_LABELS[rule.event])} → ${rule.scriptName}`
    : t('settings.scripts.AutomationsEditor.no_script_chosen_yet.1662385a')

/** The parameters the chosen script declares — the same model as a header button's. */
const paramsOf = (rule: AutomationRule): ScriptParam[] =>
  rule.scriptName ? (findScriptByName(rule.scriptName)?.meta.params ?? []) : []

const paramDescription = (param: ScriptParam): string => {
  const said = param.description.trim()
  const described = !said
    ? t('settings.scripts.AutomationsEditor.no_description.06a69482')
    : /[.!?]$/.test(said)
      ? said
      : `${said}.`
  // A description written as a label has no full stop: the default joins it as a second fact.
  return param.default
    ? t('settings.scripts.AutomationsEditor.value_defaults_to_value.e824e925', {
        value0: String(described),
        value1: String(param.default),
      })
    : described
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
