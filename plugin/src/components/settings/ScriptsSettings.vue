<template>
  <div class="abele-settings__scripts">
    <Tabs v-model="active" :tabs="TABS" level="secondary" class="abele-settings__scripts-tabs" />

    <ScriptLibrary v-if="active === 'library'" @added="showButtons" />
    <div v-else-if="active === 'selection'" class="abele-settings__selection-menus">
      <Tabs v-model="surface" :tabs="SURFACES" level="secondary" />
      <SelectionScriptsSettings :key="surface" :surface="surface" />
    </div>
    <HeaderButtonsEditor v-else-if="active === 'buttons'" />
    <AutomationsEditor v-else-if="active === 'automations'" />
    <StartupScriptsEditor v-else-if="active === 'startup'" />
    <ScriptsGeneral v-else />
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { ref } from 'vue'
import Tabs from '../obsidian/Tabs.vue'
import ScriptLibrary from './scripts/ScriptLibrary.vue'
import HeaderButtonsEditor from './scripts/HeaderButtonsEditor.vue'
import ScriptsGeneral from './scripts/ScriptsGeneral.vue'
import AutomationsEditor from './scripts/AutomationsEditor.vue'
import StartupScriptsEditor from './scripts/StartupScriptsEditor.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import SelectionScriptsSettings from './scripts/SelectionScriptsSettings.vue'
import type { SelectionMenuSurface } from '@/scripting/selectionMenuScripts'

/**
 * Script library, independent selection menus and executable controls under one tab, the way the AI settings are laid out: what scripts there are, the
 * buttons that run them from a note's header, the automations that run them by themselves, the
 * ones that run when Obsidian starts, and the switch and folder behind all of it.
 */
const TABS = [
  {
    id: 'library',
    label: t('settings.ScriptsSettings.library.dc20b3d5'),
    tooltip: t('settings.ScriptsSettings.every_script_in_the_folder.8e2a3585'),
  },
  {
    id: 'selection',
    label: t('settings.ScriptsSettings.selection_menus.22601a32'),
    tooltip: t('settings.ScriptsSettings.choose_scripts_for_books_and.71bc0ae4'),
  },
  {
    id: 'buttons',
    label: t('settings.ScriptsSettings.header_buttons.1d80ae78'),
    tooltip: t('settings.ScriptsSettings.buttons_in_note_headers_that.922a8f0e'),
  },
  {
    id: 'automations',
    label: t('settings.ScriptsSettings.automations.ad1fb9ec'),
    tooltip: t('settings.ScriptsSettings.scripts_that_run_by_themselves.32dace66'),
  },
  {
    id: 'startup',
    label: t('settings.ScriptsSettings.startup.65d48235'),
    tooltip: t('settings.ScriptsSettings.scripts_that_run_each_time.695fa1cc'),
  },
  {
    id: 'general',
    label: t('settings.ScriptsSettings.general.c910d474'),
    tooltip: t('settings.ScriptsSettings.turn_scripts_on_and_choose.d4857b2d'),
  },
]

const SURFACES = [
  {
    id: 'book',
    label: t('settings.ScriptsSettings.books.9da7f76b'),
    tooltip: t('settings.ScriptsSettings.scripts_on_words_selected_in.862c0f97'),
  },
  {
    id: 'chat',
    label: t('settings.ScriptsSettings.chats.ef5b4049'),
    tooltip: t('settings.ScriptsSettings.scripts_chosen_for_words_selected.6086fa3b'),
  },
]
const surface = ref<SelectionMenuSurface>('book')

// With scripts off the library has nothing to show, and what the person needs is the switch.
const active = ref(AbeleConfig.getInstance().ai.scriptsEnabled ? 'library' : 'general')

/** A button made from a script's card is opened where it is set up, so it can be finished. */
const showButtons = () => {
  active.value = 'buttons'
}
</script>

<style lang="scss">
.abele-settings__scripts-tabs {
  margin-bottom: var(--size-4-4);
}
</style>
