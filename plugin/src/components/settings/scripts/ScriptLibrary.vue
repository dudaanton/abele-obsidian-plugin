<template>
  <Section title="Library">
    <template #desc>
      Every script in the scripts folder. A script describes itself in the comment block at the top
      of its file: <code>@name</code>, <code>@description</code>, <code>@icon</code> and a
      <code>@param</code> line per value it takes.
    </template>

    <EmptyState v-if="!scriptsEnabled">
      Scripts are switched off. Turn them on under General to see what the folder holds.
    </EmptyState>

    <template v-else>
      <Setting name="Filter" desc="By name or description.">
        <Input v-model="filter" placeholder="e.g. archive" />
      </Setting>

      <EmptyState v-if="!scripts.length">
        {{ filter ? 'No script matches that.' : 'No scripts in the folder yet.' }}
      </EmptyState>

      <CardGrid v-else wide>
        <Card
          v-for="script in scripts"
          :key="script.path"
          :title="script.meta.name"
          :icon="script.meta.icon || 'scroll-text'"
          :subtitle="script.path"
          :description="script.meta.description || NO_DESCRIPTION"
          :meta="paramSummary(script)"
        >
          <template #badges>
            <Badge v-if="script.meta.enabled === false" text="Off" />
            <Badge v-if="buttonCount(script)" :text="buttonLabel(script)" />
          </template>
          <template #actions>
            <Icon icon="play" tooltip="Run this script now" @click="run(script)" />
            <Icon
              v-if="script.meta.enabled !== false"
              icon="panel-top"
              tooltip="Add a header button that runs this script"
              @click="addButton(script)"
            />
          </template>
        </Card>
      </CardGrid>
    </template>
  </Section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { nanoid } from 'nanoid'
import Section from '../../obsidian/Section.vue'
import Setting from '../../obsidian/Setting.vue'
import Input from '../../obsidian/Input.vue'
import Card from '../../obsidian/Card.vue'
import CardGrid from '../../obsidian/CardGrid.vue'
import Badge from '../../obsidian/Badge.vue'
import Icon from '../../obsidian/Icon.vue'
import EmptyState from '../../obsidian/EmptyState.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ScriptService } from '@/scripting/ScriptService'
import type { ParsedScript } from '@/scripting/types'

const emit = defineEmits<{
  /** A header button was made from a card; its id, so the page can show where it is set up. */
  (e: 'added', id: string): void
}>()

const NO_DESCRIPTION = 'No description yet — add a // @description line to the top of the file.'

const config = AbeleConfig.getInstance()
const scriptsEnabled = computed(() => {
  void config.version.value
  return config.ai.scriptsEnabled ?? false
})

const filter = ref('')

/** Sorted by name, and narrowed by what was typed — matched in the name or the description. */
const scripts = computed(() => {
  const needle = filter.value.trim().toLowerCase()
  return [...ScriptService.getInstance().scriptList.value]
    .filter(
      (s) =>
        !needle ||
        s.meta.name.toLowerCase().includes(needle) ||
        s.meta.description.toLowerCase().includes(needle)
    )
    .sort((a, b) => a.meta.name.localeCompare(b.meta.name))
})

/** One entry per parameter: `name: type`, a `?` when optional, and the default when there is one. */
const paramSummary = (script: ParsedScript): string[] => {
  if (!script.meta.params.length) return ['No parameters']
  return script.meta.params.map(
    (p) =>
      `${p.name}${p.required ? '' : '?'}: ${p.type}` +
      (p.default !== undefined ? ` = ${p.default}` : '')
  )
}

const buttonCount = (script: ParsedScript): number => {
  void config.version.value
  return config.headerButtons.filter((b) => b.scriptName === script.meta.name).length
}

const buttonLabel = (script: ParsedScript): string => {
  const count = buttonCount(script)
  return count === 1 ? '1 button' : `${count} buttons`
}

const run = (script: ParsedScript) => {
  void ScriptService.getInstance().executeFromCommand(script.path)
}

/**
 * A button for this script, named after it and shown nowhere yet: which notes it belongs on is
 * the one thing a script cannot say for itself, so the page takes the person there next.
 */
const addButton = (script: ParsedScript) => {
  const id = nanoid(8)
  config.headerButtons = [
    ...config.headerButtons,
    {
      id,
      name: script.meta.name,
      icon: script.meta.icon || 'play',
      noteTypes: [],
      scriptName: script.meta.name,
      params: {},
      enabled: true,
      iconOnly: false,
      allNotes: false,
      folders: [],
    },
  ]
  void config.saveSettings()
  emit('added', id)
}
</script>
