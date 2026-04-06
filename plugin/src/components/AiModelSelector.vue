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
import { ref, onMounted, onActivated } from 'vue'
import Dropdown from './obsidian/Dropdown.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { AgentService } from '@/ai/AgentService'

const agent = AgentService.getInstance()

const activeKey = ref('')
const options = ref<{ value: string; display: string }[]>([])

const refresh = () => {
  const config = AbeleConfig.getInstance().ai
  activeKey.value =
    config.activeProviderId && config.activeModelId
      ? `${config.activeProviderId}::${config.activeModelId}`
      : ''

  const opts: { value: string; display: string }[] = []
  for (const p of config.providers) {
    for (const m of p.models) {
      opts.push({
        value: `${p.id}::${m.id}`,
        display: m.name || m.id,
      })
    }
  }
  options.value = opts
}

onMounted(refresh)
onActivated(refresh)

// Poll for config changes (settings are saved asynchronously)
let interval: ReturnType<typeof setInterval>
onMounted(() => {
  interval = setInterval(refresh, 2000)
})
import { onUnmounted } from 'vue'
onUnmounted(() => clearInterval(interval))

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
