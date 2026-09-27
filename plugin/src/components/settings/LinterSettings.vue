<template>
  <div class="abele-linter-settings">
    <Section>
      <template #desc>
        The linter checks notes against the rules below — a note at a time, a folder or the whole
        vault — and lists what does not follow them in a tab of its own. Much of it can be fixed
        there in one go; the rest opens at the line to fix by hand.
      </template>
      <Setting name="Linter" desc="The tab with what the last run found.">
        <Button
          text="Open linter"
          tooltip="Close the settings and open the linter's tab"
          @click="openTab"
        />
      </Setting>
      <Setting
        name="Folders to skip"
        desc="No rule looks in these, unless a note in one is linted by name. Comma-separated; a folder, or a glob like Archive/**."
      >
        <Input
          v-model="excludeText"
          placeholder="Templates, Attachments"
          @update:model-value="setExclude"
        />
      </Setting>
    </Section>

    <Section
      title="Rules"
      desc="Each can be switched off, told how bad a finding is, kept to some folders or note types, and given its own settings."
    >
      <Setting
        v-for="rule in rules"
        :key="rule.id"
        :name="rule.title"
        :desc="describe(rule)"
        :data-rule="rule.id"
      >
        <Icon icon="settings" :tooltip="`Set up ${rule.title}`" @click="editing = rule.id" />
        <Checkbox
          :is-enabled="settingOf(rule).enabled"
          @toggle="change(rule, { enabled: !settingOf(rule).enabled })"
        />
      </Setting>
    </Section>

    <Section title="Rules of your own">
      <template #desc>
        A script whose first lines say <code>// @lint</code> is a rule: it gives back
        <code>check(note)</code>, a list of what is wrong, and may give back <code>fix(note)</code>,
        the note's new text. It is listed above with the others. The Scripts page of the
        documentation shows one.
      </template>
      <EmptyState v-if="!scriptRules.length" text="No script rules yet." />
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
  if (s.folders.length) where.push(`in ${s.folders.join(', ')}`)
  if (s.exclude.length) where.push(`not in ${s.exclude.join(', ')}`)
  if (s.types.length) where.push(`for ${s.types.join(', ')} notes`)
  if (s.property) where.push(`where ${s.property}${s.value ? ` is ${s.value}` : ' is set'}`)
  const from = rule.source === 'builtin' ? '' : ` Script: ${rule.source.script}.`
  const scope = where.length ? ` Only ${where.join(', ')}.` : ''
  return `${rule.description}${from}${scope} ${s.severity === 'error' ? 'Error' : 'Warning'}.`
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
