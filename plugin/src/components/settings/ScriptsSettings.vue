<template>
  <div class="abele-settings__scripts">
    <Tabs v-model="active" :tabs="TABS" level="secondary" class="abele-settings__scripts-tabs" />

    <ScriptLibrary v-if="active === 'library'" @added="showButtons" />
    <HeaderButtonsEditor v-else-if="active === 'buttons'" />
    <ScriptsGeneral v-else />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Tabs from '../obsidian/Tabs.vue'
import ScriptLibrary from './scripts/ScriptLibrary.vue'
import HeaderButtonsEditor from './scripts/HeaderButtonsEditor.vue'
import ScriptsGeneral from './scripts/ScriptsGeneral.vue'
import { AbeleConfig } from '@/services/AbeleConfig'

/**
 * Three pages under one tab, the way the AI settings are laid out: what scripts there are, the
 * buttons that run them from a note's header, and the switch and folder behind both.
 */
const TABS = [
  { id: 'library', label: 'Library', tooltip: 'Every script in the folder, and what it does' },
  { id: 'buttons', label: 'Header buttons', tooltip: 'Buttons in note headers that run a script' },
  { id: 'general', label: 'General', tooltip: 'Turn scripts on and choose their folder' },
]

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
