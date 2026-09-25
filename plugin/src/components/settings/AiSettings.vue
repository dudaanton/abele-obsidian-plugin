<template>
  <div class="abele-ai-settings">
    <Tabs v-model="active" :tabs="TABS" level="secondary" class="abele-ai-settings__tabs" />

    <GeneralSettings v-if="active === 'general'" />
    <McpSettings v-else-if="active === 'mcp'" />
    <AgentsSettings v-else />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Tabs from '../obsidian/Tabs.vue'
import GeneralSettings from './ai/GeneralSettings.vue'
import AgentsSettings from './ai/AgentsSettings.vue'
import McpSettings from './ai/McpSettings.vue'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'agents', label: 'Agents' },
  { id: 'mcp', label: 'MCP' },
]

const active = ref('general')
</script>

<style lang="scss">
.abele-ai-settings__tabs {
  margin-bottom: var(--size-4-4);
}
</style>
