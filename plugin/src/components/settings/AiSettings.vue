<template>
  <div class="abele-ai-settings">
    <Tabs v-model="active" :tabs="TABS" level="secondary" class="abele-ai-settings__tabs" />

    <GeneralSettings v-if="active === 'general'" page="general" />
    <GeneralSettings v-else-if="active === 'models'" page="models" />
    <GeneralSettings v-else-if="active === 'prompts'" page="prompts" />
    <McpSettings v-else-if="active === 'mcp'" />
    <AgentsSettings v-else />
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { ref } from 'vue'
import Tabs from '../obsidian/Tabs.vue'
import GeneralSettings from './ai/GeneralSettings.vue'
import AgentsSettings from './ai/AgentsSettings.vue'
import McpSettings from './ai/McpSettings.vue'

const TABS = [
  { id: 'general', label: t('settings.AiSettings.general.c910d474') },
  { id: 'models', label: t('settings.AiSettings.models.d17d2d78') },
  { id: 'agents', label: t('settings.AiSettings.agents.279b44d2') },
  { id: 'mcp', label: 'MCP' },
  { id: 'prompts', label: t('settings.AiSettings.prompts.5f2e66e6') },
]

const active = ref('general')
</script>

<style lang="scss">
.abele-ai-settings__tabs {
  margin-bottom: var(--size-4-4);
}
</style>
