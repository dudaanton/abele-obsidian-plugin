<template>
  <div class="abele-agent-selector">
    <Dropdown
      v-if="options.length > 0"
      :model-value="activeId"
      :options="options"
      @update:model-value="onSelect"
    />
    <span v-else class="abele-agent-selector__empty">No agent configured</span>

    <span v-if="modelLabel" class="abele-agent-selector__model" :title="modelTitle">
      {{ modelLabel }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Notice } from 'obsidian'
import Dropdown from './obsidian/Dropdown.vue'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'

const chatService = ChatService.getInstance()
const registry = AgentRegistry.getInstance()
const session = computed(() => chatService.activeSession.value)

/** Utility agents are deliberately absent: they exist for scripts and delegation, not chat. */
const options = computed(() =>
  registry.list().map((agent) => ({ value: agent.id, display: agent.name }))
)

const activeId = computed(() => session.value?.agent.value?.id ?? '')

/** Shown beside the agent so the model in force is visible without opening settings. */
const modelLabel = computed(() => session.value?.resolveModel()?.name ?? '')

const modelTitle = computed(() =>
  session.value?.isOverridden('modelId') ? 'Model overridden for this chat' : 'Model from the agent'
)

const onSelect = (agentId: string) => {
  const s = session.value
  if (!s || agentId === s.agentId.value) return

  // Overrides were expressed against the previous agent, so switching drops them. Said out
  // loud rather than silently, since it can undo a scope somebody narrowed on purpose.
  const overridden = Object.keys(s.overrides.value).length
  if (overridden) {
    new Notice(
      `Switched agent — ${overridden} per-chat override${overridden === 1 ? '' : 's'} cleared`
    )
  }

  s.switchAgent(agentId)
}
</script>

<style lang="scss">
.abele-agent-selector {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  min-width: 0;

  .abele-obsidian-dropdown .dropdown {
    max-width: 200px;
    min-width: 80px;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

.abele-agent-selector__model {
  color: var(--text-faint);
  font-size: var(--font-smallest);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  min-width: 0;
}

.abele-agent-selector__empty {
  font-size: var(--font-small);
  color: var(--text-muted);
  font-style: italic;
}
</style>
