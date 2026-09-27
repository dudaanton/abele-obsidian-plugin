<template>
  <ObsidianModal :title="rule.title" @close="emit('close')">
    <div class="abele-lint-rule">
      <p class="abele-lint-rule__about">{{ rule.description }}</p>
      <Setting name="On" desc="Switched off, the rule checks nothing.">
        <Checkbox
          :is-enabled="setting.enabled"
          @toggle="emit('change', { enabled: !setting.enabled })"
        />
      </Setting>
      <Setting name="How bad" desc="An error or a warning, as the list shows it.">
        <Dropdown
          :model-value="setting.severity"
          :options="severities"
          @update:model-value="
            emit('change', { severity: $event === 'warning' ? 'warning' : 'error' })
          "
        />
      </Setting>

      <Section title="Where it applies" desc="Left empty, everywhere. Lists are comma-separated.">
        <Setting name="Only in" desc="Folders, or globs like Projects/*/Tasks.">
          <Input
            v-model="text.folders"
            placeholder="Everywhere"
            @update:model-value="list('folders', $event)"
          />
        </Setting>
        <Setting name="Not in" desc="Folders or globs left alone inside those.">
          <Input
            v-model="text.exclude"
            placeholder="Nowhere"
            @update:model-value="list('exclude', $event)"
          />
        </Setting>
        <Setting name="Note types" desc="Only notes whose type is one of these.">
          <Input
            v-model="text.types"
            placeholder="Any type"
            @update:model-value="list('types', $event)"
          />
        </Setting>
        <Setting
          name="Having a property"
          desc="Only notes with this property — equal to the value, when one is given."
        >
          <Input
            v-model="text.property"
            placeholder="Property"
            @update:model-value="word('property', $event)"
          />
          <Input
            v-model="text.value"
            placeholder="Any value"
            @update:model-value="word('value', $event)"
          />
        </Setting>
      </Section>

      <Section v-if="rule.params.length" title="Settings of the rule">
        <Setting
          v-for="param in rule.params"
          :key="param.name"
          :name="param.label"
          :desc="param.description"
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
        text="As it ships"
        tooltip="Put this rule back the way the plugin ships it"
        @click="resetAll"
      />
      <Button
        text="Done"
        accent
        tooltip="Close this; the changes are saved"
        @click="emit('close')"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
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
  { value: 'error', display: 'Error' },
  { value: 'warning', display: 'Warning' },
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
