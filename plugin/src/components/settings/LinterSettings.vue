<template>
  <div class="abele-linter-settings">
    <Section>
      <template #desc>
        {{ t('settings.LinterSettings.the_linter_checks_notes_against.67baa82b') }}
      </template>
      <Setting
        :name="t('settings.LinterSettings.linter.99bede8d')"
        :desc="t('settings.LinterSettings.the_tab_with_what_the.e019607d')"
      >
        <Button
          :text="t('settings.LinterSettings.open_linter.72c54acd')"
          :tooltip="t('settings.LinterSettings.close_the_settings_and_open.125786ff')"
          @click="openTab"
        />
      </Setting>
      <Setting
        :name="t('settings.LinterSettings.folders_to_skip.ad324780')"
        :desc="t('settings.LinterSettings.no_rule_looks_in_these.2a478951')"
      >
        <Input
          v-model="excludeText"
          :placeholder="t('settings.LinterSettings.templates_attachments.2440bdba')"
          @update:model-value="setExclude"
        />
      </Setting>
    </Section>

    <Section
      :title="t('settings.LinterSettings.rules.4228aeb0')"
      :desc="t('settings.LinterSettings.each_can_be_switched_off.240786af')"
    >
      <Setting
        v-for="rule in rules"
        :key="rule.id"
        :name="rule.source === 'builtin' ? settingsLabel(rule.title) : rule.title"
        :desc="describe(rule)"
        :data-rule="rule.id"
      >
        <Icon
          icon="settings"
          :tooltip="
            t('settings.LinterSettings.set_up_value.45578254', {
              value0: String(rule.source === 'builtin' ? settingsLabel(rule.title) : rule.title),
            })
          "
          @click="editing = rule.id"
        />
        <Checkbox
          :is-enabled="settingOf(rule).enabled"
          @toggle="change(rule, { enabled: !settingOf(rule).enabled })"
        />
      </Setting>
    </Section>

    <Section :title="t('settings.LinterSettings.rules_of_your_own.f29b0461')">
      <template #desc>
        <I18nText
          :text="
            t('settings.rich.bc6ba5473fff4aa8', {
              slot0: '⟪slot0⟫',
              slot1: '⟪slot1⟫',
              slot2: '⟪slot2⟫',
            })
          "
          ><template #slot0><code>// @lint</code></template
          ><template #slot1><code>check(note)</code></template
          ><template #slot2><code>fix(note)</code></template></I18nText
        >
      </template>
      <EmptyState
        v-if="!scriptRules.length"
        :text="t('settings.LinterSettings.no_script_rules_yet.37cf496e')"
      />
    </Section>

    <LintRuleModal
      v-if="editingRule"
      :rule="editingRule"
      :setting="settingOf(editingRule)"
      @change="(patch, typing) => change(editingRule!, patch, typing)"
      @reset="reset(editingRule)"
      @close="editing = null"
    />
  </div>
</template>

<script setup lang="ts">
import { settingsLabel } from '@/i18n/settingsLabels'
import I18nText from '@/components/obsidian/I18nText.vue'
import { t } from '@/i18n'
import { computed, ref } from 'vue'
import { debounce } from 'obsidian'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import Input from '../obsidian/Input.vue'
import EmptyState from '../obsidian/EmptyState.vue'
import LintRuleModal from './LintRuleModal.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
import { LinterService } from '@/linter/LinterService'
import { ScriptService } from '@/scripting/ScriptService'
import { openLinter } from '@/linter/LinterView'
import {
  linterSettingsFrom,
  ruleSetting,
  withRuleSetting,
  type LintRuleSetting,
} from '@/linter/settings'
import type { LintRule } from '@/linter/types'

const config = AbeleConfig.getInstance()
const app = GlobalStore.getInstance().app
const service = LinterService.getInstance()

const current = computed(() => {
  void config.version.value
  return linterSettingsFrom(config.linter)
})

const rules = computed<LintRule[]>(() => {
  void config.version.value
  // A script given `// @lint` while this is open joins the list.
  void ScriptService.getInstance().scriptList.value
  return service.allRules()
})
const scriptRules = computed(() => rules.value.filter((r) => r.source !== 'builtin'))

const editing = ref<string | null>(null)
const editingRule = computed(() => rules.value.find((r) => r.id === editing.value) ?? null)

const settingOf = (rule: LintRule): LintRuleSetting => ruleSetting(current.value, rule)

/** Where the rule applies and how bad it is, after what it checks. */
function describe(rule: LintRule): string {
  const s = settingOf(rule)
  const where: string[] = []
  if (s.folders.length)
    where.push(
      t('settings.LinterSettings.in_value.b63d3a91', { value0: String(s.folders.join(', ')) })
    )
  if (s.exclude.length)
    where.push(
      t('settings.LinterSettings.not_in_value.d95a4831', { value0: String(s.exclude.join(', ')) })
    )
  if (s.types.length)
    where.push(
      t('settings.LinterSettings.for_value_notes.670a9ee4', { value0: String(s.types.join(', ')) })
    )
  if (s.property)
    where.push(
      t('settings.LinterSettings.where_value_value.e534e0d0', {
        value0: String(s.property),
        value1: String(
          s.value
            ? t('settings.parts.520a5d3ab1d92888', { value0: String(s.value) })
            : t('settings.LinterSettings.is_set.c7d5e11f')
        ),
      })
    )
  const from =
    rule.source === 'builtin'
      ? ''
      : t('settings.LinterSettings.script_value.c5efe1d1', { value0: String(rule.source.script) })
  const scope = where.length
    ? t('settings.LinterSettings.only_value.e2625151', { value0: String(where.join(', ')) })
    : ''
  return `${rule.source === 'builtin' ? settingsLabel(rule.description) : rule.description}${from}${scope} ${s.severity === 'error' ? t('settings.LinterSettings.error.54a0e8c1') : t('settings.LinterSettings.warning.e981ddae')}.`
}

const save = async () => {
  await config.saveSettings()
}
const saveSoon = debounce(() => void save(), 500, true)

/** Kept at once; written to disk at once, or once the typing stops. */
const change = (rule: LintRule, patch: Partial<LintRuleSetting>, typing = false) => {
  const now = linterSettingsFrom(config.linter)
  // A parameter changes alone: the others may have been typed a moment ago and not drawn yet.
  const params = patch.params ? { ...ruleSetting(now, rule).params, ...patch.params } : undefined
  config.linter = withRuleSetting(now, rule, params ? { ...patch, params } : patch)
  if (typing) saveSoon()
  else void save()
}

const reset = (rule: LintRule) => {
  const now = linterSettingsFrom(config.linter)
  const rest = { ...now.rules }
  delete rest[rule.id]
  config.linter = { ...now, rules: rest }
  void save()
}

const words = (text: string): string[] =>
  text
    .split(',')
    .map((w) => w.trim())
    .filter(Boolean)

// The field keeps what is typed, commas and all; the list it stands for is what is saved.
const excludeText = ref(linterSettingsFrom(config.linter).exclude.join(', '))
const setExclude = (text: string) => {
  config.linter = { ...linterSettingsFrom(config.linter), exclude: words(text) }
  saveSoon()
}

const openTab = () => {
  ;(app as unknown as { setting?: { close?: () => void } }).setting?.close?.()
  void openLinter(app)
}
</script>

<style lang="scss">
.abele-linter-settings code {
  font-size: var(--code-size);
}
</style>
