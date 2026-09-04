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

/**
 * Utility agents are deliberately absent: they exist for scripts and delegation, not chat.
 *
 * With one exception, and it is a comment. A comment starts on whatever `commentAgentId` names,
 * which is a utility agent in every vault that took the default — and a `select` handed a value
 * none of its options carry shows the first one instead, so the picker would sit there naming
 * an agent this conversation has nothing to do with. The card in the margin lets the same one
 * back in, for the same reason.
 */
const options = computed(() => {
  const listed = registry.list().map((agent) => ({ value: agent.id, display: agent.name }))

  const own = session.value?.kind === 'comment' ? session.value.agent.value : null
  if (own && !listed.some((option) => option.value === own.id)) {
    listed.unshift({ value: own.id, display: own.name })
  }

  return listed
})

const activeId = computed(() => session.value?.agent.value?.id ?? '')

/**
 * Shown beside the agent so the model in force is visible without opening settings.
 *
 * Falls back to the id: models fetched from a provider's `/models` endpoint often carry no
 * display name, and an unlabelled model is worse than a technical one.
 */
const modelLabel = computed(() => {
  const model = session.value?.resolveModel()
  return model ? model.name || model.id : ''
})

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
    max-width: 12em;
    min-width: 5em;
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

/**
 * A pane too narrow for both.
 *
 * Six things share the header's row — the agent, the model, and four actions — and a comment
 * adds two more. At 414 px that clipped the agent to "Co…" and the model to "Claude O…", which
 * is two truncations where one of them is the only thing on screen saying which agent is
 * answering. The model goes: it is a fact about the agent, and the chat settings say it in full.
 *
 * A container query rather than a media query, because what is narrow is the pane: a phone and
 * a narrow desktop split are one problem. `.abele-ai-chat` is the container it resolves against.
 */
@container (max-width: 420px) {
  .abele-agent-selector__model {
    display: none;
  }
}

.abele-agent-selector__empty {
  font-size: var(--font-small);
  color: var(--text-muted);
  font-style: italic;
}
</style>
