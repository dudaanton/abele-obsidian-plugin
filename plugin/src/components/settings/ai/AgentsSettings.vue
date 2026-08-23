<template>
  <div class="abele-agents-settings">
    <p class="setting-item-description">
      An agent is a model, a set of instructions, and what it is allowed to do. Chats run on one;
      scripts and other agents can delegate to one.
    </p>

    <div v-for="agent in agents" :key="agent.id" class="abele-agent-card">
      <div class="abele-agent-card__main" @click="editingId = agent.id">
        <div class="abele-agent-card__title">
          <span class="abele-agent-card__name">{{ agent.name }}</span>
          <span v-if="agent.id === defaultAgentId" class="abele-agent-card__badge">default</span>
          <span v-if="agent.utility" class="abele-agent-card__badge">utility</span>
        </div>
        <div v-if="agent.description" class="abele-agent-card__desc">{{ agent.description }}</div>
        <div class="abele-agent-card__meta">
          <span>{{ modelLabel(agent) }}</span>
          <span>{{ agent.prompts.length }} prompt{{ agent.prompts.length === 1 ? '' : 's' }}</span>
          <span>{{ scopeLabel(agent) }}</span>
        </div>
      </div>

      <div class="abele-agent-card__actions">
        <Icon icon="pencil" title="Edit" @click="editingId = agent.id" />
        <Icon
          v-if="agent.id !== defaultAgentId && !agent.utility"
          icon="star"
          title="Make default"
          @click="makeDefault(agent.id)"
        />
        <Icon icon="copy" title="Duplicate" @click="duplicate(agent.id)" />
        <Icon
          icon="trash"
          :class="{ 'abele-agent-card__action_disabled': agents.length <= 1 }"
          title="Delete"
          @click="remove(agent.id)"
        />
      </div>
    </div>

    <Button text="Add agent" @click="addAgent" />

    <AgentEditorModal
      v-if="editingId"
      :agent-id="editingId"
      @close="editingId = ''"
      @changed="bump"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { Notice } from 'obsidian'
import Button from '../../obsidian/Button.vue'
import Icon from '../../obsidian/Icon.vue'
import AgentEditorModal from './AgentEditorModal.vue'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { AgentDefinition } from '@/ai/agents/types'

const registry = AgentRegistry.getInstance()
const config = AbeleConfig.getInstance()

const editingId = ref('')
/** Nudged after an edit so labels derived from plain config fields refresh too. */
const revision = ref(0)
const bump = () => revision.value++

const agents = computed(() => {
  void revision.value
  return registry.list({ includeUtility: true })
})
const defaultAgentId = computed(() => {
  void revision.value
  return config.ai.defaultAgentId
})

function modelLabel(agent: AgentDefinition): string {
  if (!agent.modelId) return 'no model'
  const provider = config.ai.providers.find((p) => p.id === agent.providerId)
  const model = provider?.models.find((m) => m.id === agent.modelId)
  return model?.name || agent.modelId
}

function scopeLabel(agent: AgentDefinition): string {
  if (agent.fullVaultAccess) return 'whole vault'
  if (!agent.scope.length) return 'no scope'
  return `${agent.scope.length} scope entr${agent.scope.length === 1 ? 'y' : 'ies'}`
}

function persist(): void {
  bump()
  void config.saveSettings()
}

function addAgent(): void {
  const agent = registry.create({
    name: `Agent ${registry.list({ includeUtility: true }).length + 1}`,
  })
  persist()
  editingId.value = agent.id
}

function duplicate(id: string): void {
  const copy = registry.duplicate(id)
  persist()
  if (copy) editingId.value = copy.id
}

function makeDefault(id: string): void {
  registry.setDefault(id)
  persist()
}

function remove(id: string): void {
  if (!registry.remove(id)) {
    new Notice('The last agent cannot be removed — chats need something to run on.')
    return
  }
  persist()
}
</script>

<style lang="scss">
.abele-agent-card {
  display: flex;
  align-items: flex-start;
  gap: var(--size-4-2);
  padding: var(--size-4-2);
  margin-bottom: var(--size-4-2);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
}

.abele-agent-card__main {
  flex: 1 1 auto;
  min-width: 0;
  cursor: pointer;
}

.abele-agent-card__title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--size-2-2);
}

.abele-agent-card__name {
  font-weight: var(--font-medium);
}

.abele-agent-card__badge {
  font-size: var(--font-smallest);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  padding: 0 var(--size-2-2);
  border-radius: var(--radius-s);
  background: var(--background-modifier-border);
  color: var(--text-muted);
}

.abele-agent-card__desc {
  color: var(--text-muted);
  font-size: var(--font-small);
  margin-top: var(--size-2-1);
  overflow-wrap: anywhere;
}

.abele-agent-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
  margin-top: var(--size-2-2);
  color: var(--text-faint);
  font-size: var(--font-smallest);
}

.abele-agent-card__actions {
  display: flex;
  align-items: center;
  gap: var(--size-2-1);
  flex: 0 0 auto;
}

.abele-agent-card__action_disabled {
  opacity: 0.3;
  pointer-events: none;
}
</style>
