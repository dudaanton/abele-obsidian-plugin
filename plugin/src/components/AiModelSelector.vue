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
import { computed } from 'vue'
import Dropdown from './obsidian/Dropdown.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { ChatService } from '@/ai/ChatService'

const chatService = ChatService.getInstance()
const config = AbeleConfig.getInstance()
const session = computed(() => chatService.activeSession.value)

const activeKey = computed(() => {
  const s = session.value
  const pid = s?.activeProviderId.value || config.ai.activeProviderId
  const mid = s?.activeModelId.value || config.ai.activeModelId
  return pid && mid ? `${pid}::${mid}` : ''
})

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
  chatService.switchModel(providerId, modelId)
}
</script>

<style lang="scss">
.abele-model-selector {
  min-width: 0;

  .abele-obsidian-dropdown {
    .dropdown {
      max-width: 250px;
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
