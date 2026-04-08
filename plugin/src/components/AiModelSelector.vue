<template>
  <div class="abele-model-selector">
    <Dropdown
      v-if="options.length > 0"
      :model-value="activeKey"
      :options="options"
      @update:model-value="onSelect"
    />
    <span v-else class="abele-model-selector__empty">No model configured</span>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import Dropdown from './obsidian/Dropdown.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { AgentService } from '@/ai/AgentService'

const agent = AgentService.getInstance()
const config = AbeleConfig.getInstance()

const activeKey = ref(
  config.ai.activeProviderId && config.ai.activeModelId
    ? `${config.ai.activeProviderId}::${config.ai.activeModelId}`
    : ''
)

const options = computed(() => {
  const opts: { value: string; display: string }[] = []
  for (const p of config.ai.providers) {
    for (const m of p.models) {
      opts.push({
        value: `${p.id}::${m.id}`,
        display: m.name || m.id,
      })
    }
  }
  return opts
})

const onSelect = (key: string) => {
  const [providerId, modelId] = key.split('::')
  agent.switchModel(providerId, modelId)
  activeKey.value = key
}
</script>

<style lang="scss">
.abele-model-selector {
  min-width: 0;

  .abele-obsidian-dropdown {
    .dropdown {
      font-size: var(--font-small);
      max-width: 140px;
      min-width: 80px;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }
}

.abele-model-selector__empty {
  font-size: var(--font-small);
  color: var(--text-muted);
  font-style: italic;
}
</style>
