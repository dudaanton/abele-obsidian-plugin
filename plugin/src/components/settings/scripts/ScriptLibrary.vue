<template>
  <Section :title="t('settings.scripts.ScriptLibrary.library.dc20b3d5')">
    <template #desc>
      <I18nText
        :text="
          t('settings.rich.225479f70a17e374', {
            slot0: '⟪slot0⟫',
            slot1: '⟪slot1⟫',
            slot2: '⟪slot2⟫',
            slot3: '⟪slot3⟫',
            slot4: '⟪slot4⟫',
            slot5: '⟪slot5⟫',
          })
        "
        ><template #slot0><code>@name</code></template
        ><template #slot1><code>@description</code></template
        ><template #slot2><code>@icon</code></template
        ><template #slot3><code>@param</code></template
        ><template #slot4><code>@toolbar</code></template
        ><template #slot5><code>@startup</code></template></I18nText
      >
    </template>

    <EmptyState v-if="!scriptsEnabled">
      {{ t('settings.scripts.ScriptLibrary.scripts_are_switched_off_turn.13205644') }}
    </EmptyState>

    <template v-else>
      <Setting
        :name="t('settings.scripts.ScriptLibrary.filter.638e249f')"
        :desc="t('settings.scripts.ScriptLibrary.by_name_or_description.95a3575e')"
      >
        <Input
          v-model="filter"
          :placeholder="
            t('settings.scripts.ScriptLibrary.e_g_archive.a525e8b2', {
              literal0: String('archive'),
            })
          "
        />
      </Setting>

      <EmptyState v-if="!scripts.length">
        {{
          filter
            ? t('settings.scripts.ScriptLibrary.no_script_matches_that.547f44e0')
            : t('settings.scripts.ScriptLibrary.no_scripts_in_the_folder.361e62fa')
        }}
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
              :text="
                verdictOf(script) === 'refused'
                  ? t('settings.scripts.ScriptLibrary.refused.66b87354')
                  : t('settings.scripts.ScriptLibrary.waiting_to_be_confirmed.8d2c8168')
              "
              color="orange"
            />
            <Badge
              v-if="script.meta.enabled === false"
              :text="t('settings.scripts.ScriptLibrary.off.ca7981b4')"
            />
            <Badge v-if="buttonCount(script)" :text="buttonLabel(script)" />
            <Badge
              v-if="placeOf(script)"
              :text="t('settings.scripts.ScriptLibrary.toolbar.451aa51a')"
            />
            <Badge
              v-if="startupOf(script)"
              :text="t('settings.scripts.ScriptLibrary.startup.65d48235')"
            />
          </template>
          <template #actions>
            <Icon
              class="abele-script-review-action"
              icon="shield-check"
              :tooltip="
                verdictOf(script) !== 'confirmed'
                  ? t('settings.scripts.ScriptLibrary.it_changed_without_being_written.9f37bd87')
                  : t('settings.scripts.ScriptLibrary.review_execution_trust_on_this.1dc6af3c')
              "
              @click="review(script)"
            />
            <Icon
              icon="play"
              :tooltip="t('settings.scripts.ScriptLibrary.run_this_script_now.ef501cea')"
              @click="run(script)"
            />
            <Icon
              v-if="script.meta.enabled !== false"
              icon="panel-top"
              :tooltip="t('settings.scripts.ScriptLibrary.add_a_header_button_that.00d00d3b')"
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
import { settingsCount } from '@/i18n/settingsCounts'
import I18nText from '@/components/obsidian/I18nText.vue'
import { t } from '@/i18n'
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

const NO_DESCRIPTION = t('settings.scripts.ScriptLibrary.no_description_yet_add_a.df1a932d', {
  literal0: String('// @description'),
})

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
  if (!script.meta.params.length)
    return [t('settings.scripts.ScriptLibrary.no_parameters.3a7003b7')]
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
  return count === 1 ? settingsCount('button', 1) : settingsCount('button', count)
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
  if (place === 'header')
    return t('settings.scripts.ScriptLibrary.on_the_toolbar_by_its.523a3a4d', {
      literal0: String('// @toolbar'),
    })
  if (place === 'setting')
    return t('settings.scripts.ScriptLibrary.take_it_off_the_toolbar.aeab7aed')
  return t('settings.scripts.ScriptLibrary.put_it_on_the_toolbar.00b0cd91')
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
  if (place === 'header')
    return t('settings.scripts.ScriptLibrary.runs_at_startup_by_its.a6064a2b', {
      literal0: String('// @startup'),
    })
  if (place === 'setting')
    return t('settings.scripts.ScriptLibrary.stop_running_it_when_obsidian.82244aa9')
  return t('settings.scripts.ScriptLibrary.run_it_each_time_obsidian.2c1778ac')
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
