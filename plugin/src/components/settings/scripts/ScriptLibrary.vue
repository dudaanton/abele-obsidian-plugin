<template>
  <Section title="Library">
    <template #desc>
      Every script in the scripts folder. A script describes itself in the comment block at the top
      of its file: <code>@name</code>, <code>@description</code>, <code>@icon</code> and a
      <code>@param</code> line per value it takes. The pin puts a script on the toolbar: an icon on
      the left ribbon on a computer, and a place on the toolbar above the keyboard on a phone —
      <code>@toolbar</code> in its header does the same. The power button runs a script each time
      Obsidian starts; <code>@startup</code> in its header does the same, and the Startup tab puts
      them in order.
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
            <Badge
              v-if="verdictOf(script) !== 'confirmed'"
              class="abele-script-waiting"
              :text="verdictOf(script) === 'refused' ? 'Refused' : 'Waiting to be confirmed'"
              color="orange"
            />
            <Badge v-if="script.meta.enabled === false" text="Off" />
            <Badge v-if="buttonCount(script)" :text="buttonLabel(script)" />
            <Badge v-if="placeOf(script)" text="Toolbar" />
            <Badge v-if="startupOf(script)" text="Startup" />
          </template>
          <template #actions>
            <Icon
              class="abele-script-review-action"
              icon="shield-check"
              :tooltip="
                verdictOf(script) !== 'confirmed'
                  ? 'It changed without being written on this device: look at it and confirm it'
                  : 'Review execution trust on this device without running the script'
              "
              @click="review(script)"
            />
            <Icon icon="play" tooltip="Run this script now" @click="run(script)" />
            <Icon
              v-if="script.meta.enabled !== false"
              icon="panel-top"
              tooltip="Add a header button that runs this script"
              @click="addButton(script)"
            />
            <Icon
              class="abele-script-toolbar-toggle"
              icon="pin"
              :active="placeOf(script) !== null"
              :disabled="placeOf(script) === 'header'"
              :tooltip="toolbarTooltip(script)"
              @click="toggleToolbar(script)"
            />
            <Icon
              class="abele-script-startup-toggle"
              icon="power"
              :active="startupOf(script) !== null"
              :disabled="startupOf(script) === 'header'"
              :tooltip="startupTooltip(script)"
              @click="toggleStartup(script)"
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
import { Notice } from 'obsidian'
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
import { ScriptTrust } from '@/scripting/ScriptTrust'
import type { ParsedScript } from '@/scripting/types'
import { toolbarPlace, toolbarScriptsFrom } from '@/scripting/scriptToolbar'
import { setOnToolbar } from '@/scripting/toolbarButtons'
import {
  startupPlace,
  startupScriptsFrom,
  withStartupScript,
  withoutStartupScript,
} from '@/scripting/startupScripts'

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
  return config.headerButtons.filter(
    (b) => b.runs !== 'command' && b.scriptName === script.meta.name
  ).length
}

const buttonLabel = (script: ParsedScript): string => {
  const count = buttonCount(script)
  return count === 1 ? '1 button' : `${count} buttons`
}

/** Whether this device lets the script run, or holds it until confirmed; see `ScriptTrust.ts`. */
const verdictOf = (script: ParsedScript) => {
  void ScriptTrust.getInstance().version.value
  return ScriptService.getInstance().verdict(script)
}

const review = (script: ParsedScript) => {
  void ScriptService.getInstance()
    .review(script)
    .catch((error) => new Notice(error instanceof Error ? error.message : String(error)))
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

/** Whether the script is on the toolbar, and whether the list or its own header put it there. */
const placeOf = (script: ParsedScript) => {
  void config.version.value
  return toolbarPlace(script, toolbarScriptsFrom(config.ai.toolbarScripts))
}

const toolbarTooltip = (script: ParsedScript): string => {
  const place = placeOf(script)
  if (place === 'header') return 'On the toolbar by its // @toolbar header line'
  if (place === 'setting') return 'Take it off the toolbar'
  return 'Put it on the toolbar: the left ribbon, and above the keyboard on a phone'
}

const toggleToolbar = (script: ParsedScript) => {
  const place = placeOf(script)
  if (place === 'header') return
  void setOnToolbar(ScriptService.getInstance(), script, place === null)
}

/** Whether the script runs when Obsidian starts, and whether the list or its header says so. */
const startupOf = (script: ParsedScript) => {
  void config.version.value
  return startupPlace(script, startupScriptsFrom(config.ai.startupScripts))
}

const startupTooltip = (script: ParsedScript): string => {
  const place = startupOf(script)
  if (place === 'header') return 'Runs at startup by its // @startup header line'
  if (place === 'setting') return 'Stop running it when Obsidian starts'
  return 'Run it each time Obsidian starts'
}

const toggleStartup = (script: ParsedScript) => {
  const place = startupOf(script)
  if (place === 'header') return
  const chosen = startupScriptsFrom(config.ai.startupScripts)
  const startupScripts =
    place === null
      ? withStartupScript(chosen, script.meta.name)
      : withoutStartupScript(chosen, script.meta.name)
  config.ai = { ...config.ai, startupScripts }
  void config.saveSettings()
}
</script>
