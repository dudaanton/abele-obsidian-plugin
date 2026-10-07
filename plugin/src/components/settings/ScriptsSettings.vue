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
  { id: 'library', label: 'Library', tooltip: 'Every script in the folder, and what it does' },
  {
    id: 'selection',
    label: 'Selection menus',
    tooltip: 'Choose scripts for books and chats independently',
  },
  { id: 'buttons', label: 'Header buttons', tooltip: 'Buttons in note headers that run a script' },
  {
    id: 'automations',
    label: 'Automations',
    tooltip: 'Scripts that run by themselves when a task or a note changes',
  },
  { id: 'startup', label: 'Startup', tooltip: 'Scripts that run each time Obsidian starts' },
  { id: 'general', label: 'General', tooltip: 'Turn scripts on and choose their folder' },
]

const SURFACES = [
  { id: 'book', label: 'Books', tooltip: 'Scripts on words selected in a book' },
  { id: 'chat', label: 'Chats', tooltip: 'Scripts chosen for words selected in a chat' },
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
