<template>
  <Section
    desc="An agent is a model, a set of instructions, and what it is allowed to do. Chats run on
      one; scripts and other agents can delegate to one."
  >
    <CardGrid wide>
      <Card
        v-for="agent in agents"
        :key="agent.id"
        :title="agent.name"
        :description="agent.description"
        :meta="metaFor(agent)"
        clickable
        @click="editingId = agent.id"
      >
        <template #badges>
          <Badge v-if="agent.id === defaultAgentId" text="default" accent />
          <Badge v-if="agent.utility" text="utility" />
        </template>

        <template #actions>
          <Icon
            icon="star"
            tooltip="Make default"
            :disabled="agent.id === defaultAgentId || agent.utility"
            @click="makeDefault(agent.id)"
          />
          <Icon icon="copy" tooltip="Duplicate" @click="duplicate(agent.id)" />
          <Icon
            icon="trash"
            tooltip="Delete"
            :disabled="agents.length <= 1"
            @click="remove(agent.id)"
          />
        </template>
      </Card>
    </CardGrid>

    <div class="abele-agents-settings__actions">
      <Button text="Add agent" accent @click="addAgent" />
    </div>

    <AgentEditorModal
      v-if="editingId"
      :agent-id="editingId"
      @close="editingId = ''"
      @changed="bump"
    />
  </Section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import Button from '../../obsidian/Button.vue'
import Icon from '../../obsidian/Icon.vue'
import Card from '../../obsidian/Card.vue'
import CardGrid from '../../obsidian/CardGrid.vue'
import Badge from '../../obsidian/Badge.vue'
import Section from '../../obsidian/Section.vue'
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

function metaFor(agent: AgentDefinition): string[] {
  return [modelLabel(agent), promptLabel(agent), scopeLabel(agent)]
}

function modelLabel(agent: AgentDefinition): string {
  if (!agent.modelId) return 'no model'
  const provider = config.ai.providers.find((p) => p.id === agent.providerId)
  const model = provider?.models.find((m) => m.id === agent.modelId)
  return model?.name || agent.modelId
}

function promptLabel(agent: AgentDefinition): string {
  return `${agent.prompts.length} prompt${agent.prompts.length === 1 ? '' : 's'}`
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

/**
 * The last agent stays: a chat has to run on something. The icon is disabled rather than
 * hidden, so the row of actions does not reshuffle as agents come and go.
 */
function remove(id: string): void {
  if (!registry.remove(id)) return
  persist()
}
</script>

<style lang="scss">
.abele-agents-settings__actions {
  margin-top: var(--size-4-4);
}
</style>
