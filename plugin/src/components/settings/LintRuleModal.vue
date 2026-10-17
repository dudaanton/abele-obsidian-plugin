<template>
  <ObsidianModal
    :title="rule.source === 'builtin' ? settingsLabel(rule.title) : rule.title"
    @close="emit('close')"
  >
    <div class="abele-lint-rule">
      <p class="abele-lint-rule__about">
        {{ rule.source === 'builtin' ? settingsLabel(rule.description) : rule.description }}
      </p>
      <Setting
        :name="t('settings.LintRuleModal.on.13001175')"
        :desc="t('settings.LintRuleModal.switched_off_the_rule_checks.db75c03b')"
      >
        <Checkbox
          :is-enabled="setting.enabled"
          @toggle="emit('change', { enabled: !setting.enabled })"
        />
      </Setting>
      <Setting
        :name="t('settings.LintRuleModal.how_bad.016a19df')"
        :desc="t('settings.LintRuleModal.an_error_or_a_warning.ea93bb11')"
      >
        <Dropdown
          :model-value="setting.severity"
          :options="severities"
          @update:model-value="
            emit('change', { severity: $event === 'warning' ? 'warning' : 'error' })
          "
        />
      </Setting>

      <Section
        :title="t('settings.LintRuleModal.where_it_applies.39e44cbf')"
        :desc="t('settings.LintRuleModal.left_empty_everywhere_lists_are.5675de53')"
      >
        <Setting
          :name="t('settings.LintRuleModal.only_in.aed9f516')"
          :desc="t('settings.LintRuleModal.folders_or_globs_like_projects.3f2b32ac')"
        >
          <Input
            v-model="text.folders"
            :placeholder="t('settings.LintRuleModal.everywhere.dcc10bfd')"
            @update:model-value="list('folders', $event)"
          />
        </Setting>
        <Setting
          :name="t('settings.LintRuleModal.not_in.1bc8651b')"
          :desc="t('settings.LintRuleModal.folders_or_globs_left_alone.a5983464')"
        >
          <Input
            v-model="text.exclude"
            :placeholder="t('settings.LintRuleModal.nowhere.7e32434d')"
            @update:model-value="list('exclude', $event)"
          />
        </Setting>
        <Setting
          :name="t('settings.LintRuleModal.note_types.52d728fb')"
          :desc="t('settings.LintRuleModal.only_notes_whose_type_is.a3e5cd66')"
        >
          <Input
            v-model="text.types"
            :placeholder="t('settings.LintRuleModal.any_type.b05fc1fe')"
            @update:model-value="list('types', $event)"
          />
        </Setting>
        <Setting
          :name="t('settings.LintRuleModal.having_a_property.07dd0569')"
          :desc="t('settings.LintRuleModal.only_notes_with_this_property.adbc72b9')"
        >
          <Input
            v-model="text.property"
            :placeholder="t('settings.LintRuleModal.property.40040cb1')"
            @update:model-value="word('property', $event)"
          />
          <Input
            v-model="text.value"
            :placeholder="t('settings.LintRuleModal.any_value.004f62d2')"
            @update:model-value="word('value', $event)"
          />
        </Setting>
      </Section>

      <Section
        v-if="rule.params.length"
        :title="t('settings.LintRuleModal.settings_of_the_rule.99e57b0c')"
      >
        <Setting
          v-for="param in rule.params"
          :key="param.name"
          :name="rule.source === 'builtin' ? settingsLabel(param.label) : param.label"
          :desc="rule.source === 'builtin' ? settingsLabel(param.description) : param.description"
        >
          <Checkbox
            v-if="param.type === 'boolean'"
            :is-enabled="setting.params[param.name] !== false"
            @toggle="setParam(param.name, setting.params[param.name] === false)"
          />
          <Input
            v-else
            v-model="paramText[param.name]"
            @update:model-value="typedParam(param, $event)"
          />
        </Setting>
      </Section>
    </div>
    <template #footer>
      <Button
        :text="t('settings.LintRuleModal.as_it_ships.be4ca4de')"
        :tooltip="t('settings.LintRuleModal.put_this_rule_back_the.6e2ebc57')"
        @click="resetAll"
      />
      <Button
        :text="t('settings.LintRuleModal.done.11a6767d')"
        accent
        :tooltip="t('settings.LintRuleModal.close_this_the_changes_are.459403b0')"
        @click="emit('close')"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { settingsLabel } from '@/i18n/settingsLabels'
import { t } from '@/i18n'
/**
 * One lint rule set up: on or off, error or warning, where it applies, and its own parameters.
 * Every change is kept as it is made. Text fields keep what is typed; the list it stands for is
 * what reaches the settings.
 */
import { reactive } from 'vue'
import ObsidianModal from '../obsidian/Modal.vue'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Input from '../obsidian/Input.vue'
import Button from '../obsidian/Button.vue'
import { defaultParams } from '@/linter/rules'
import type { LintRuleSetting } from '@/linter/settings'
import type { LintParamSpec, LintRule } from '@/linter/types'

const props = defineProps<{ rule: LintRule; setting: LintRuleSetting }>()

const emit = defineEmits<{
  (e: 'change', patch: Partial<LintRuleSetting>, typing?: boolean): void
  (e: 'reset'): void
  (e: 'close'): void
}>()

const severities = [
  { value: 'error', display: t('settings.LintRuleModal.error.54a0e8c1') },
  { value: 'warning', display: t('settings.LintRuleModal.warning.e981ddae') },
]

const joined = (value: unknown): string =>
  Array.isArray(value) ? value.join(', ') : typeof value === 'string' ? value : ''

const fill = (s: LintRuleSetting) => ({
  folders: s.folders.join(', '),
  exclude: s.exclude.join(', '),
  types: s.types.join(', '),
  property: s.property,
  value: s.value,
})
const text = reactive(fill(props.setting))
const paramText = reactive<Record<string, string>>(
  Object.fromEntries(props.rule.params.map((p) => [p.name, joined(props.setting.params[p.name])]))
)

const words = (raw: string): string[] =>
  raw
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean)

const list = (key: 'folders' | 'exclude' | 'types', raw: string) =>
  emit('change', { [key]: words(raw) }, true)
const word = (key: 'property' | 'value', raw: string) => emit('change', { [key]: raw.trim() }, true)

const setParam = (name: string, value: unknown, typing = false) =>
  emit('change', { params: { [name]: value } }, typing)

const typedParam = (param: LintParamSpec, raw: string) =>
  setParam(param.name, param.type === 'list' ? words(raw) : raw.trim(), true)

const resetAll = () => {
  emit('reset')
  Object.assign(text, { folders: '', exclude: '', types: '', property: '', value: '' })
  const defaults = defaultParams(props.rule)
  for (const p of props.rule.params) paramText[p.name] = joined(defaults[p.name])
}
</script>

<style lang="scss">
.abele-lint-rule__about {
  margin-top: 0;
  color: var(--text-muted);
}
</style>
