<template>
  <div class="abele-ai-settings">
    <nav class="abele-ai-settings__tabs">
      <button
        v-for="tab in TABS"
        :key="tab.id"
        class="abele-ai-settings__tab"
        :class="{ 'abele-ai-settings__tab_active': active === tab.id }"
        @click="active = tab.id"
      >
        {{ tab.label }}
      </button>
    </nav>

    <GeneralSettings v-if="active === 'general'" />
    <AgentsSettings v-else />
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import GeneralSettings from './ai/GeneralSettings.vue'
import AgentsSettings from './ai/AgentsSettings.vue'

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'agents', label: 'Agents' },
]

const active = ref('general')
</script>

<style lang="scss">
.abele-ai-settings__tabs {
  display: flex;
  gap: var(--size-4-1);
  margin-bottom: var(--size-4-3);
  border-bottom: 1px solid var(--background-modifier-border);
  overflow-x: auto;
}

.abele-ai-settings__tab {
  padding: var(--size-4-1) var(--size-4-3);
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  border-radius: 0;
  box-shadow: none;
  color: var(--text-muted);
  cursor: pointer;
  white-space: nowrap;

  &:hover {
    background: transparent;
    color: var(--text-normal);
  }
}

.abele-ai-settings__tab_active {
  color: var(--text-normal);
  border-bottom-color: var(--interactive-accent);
  font-weight: var(--font-medium);
}
</style>
