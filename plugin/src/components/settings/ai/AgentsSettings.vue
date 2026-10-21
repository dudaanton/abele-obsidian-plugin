<template>
  <Section :desc="t('settings.ai.AgentsSettings.an_agent_is_a_model.148349b4')">
    <CardGrid wide>
      <Card
        v-for="agent in agents"
        :key="agent.id"
        :title="agent.name"
        :description="streamBAgentDescription(agent.description)"
        :meta="metaFor(agent)"
        clickable
        @click="editingId = agent.id"
      >
        <template #badges>
          <Badge
            v-if="agent.id === defaultAgentId"
            :text="t('settings.ai.AgentsSettings.default.37a8eec1')"
            accent
          />
          <Badge v-if="agent.node" :text="agent.node.name" />
          <Badge
            v-if="agent.utility && !agent.node"
            :text="t('settings.ai.AgentsSettings.utility.57ffcc28')"
          />
        </template>

        <template v-if="!agent.node" #actions>
          <Icon
            icon="star"
            :tooltip="starTooltip(agent)"
            :disabled="agent.id === defaultAgentId || agent.utility"
            @click="makeDefault(agent.id)"
          />
          <Icon
            icon="copy"
            :tooltip="t('settings.ai.AgentsSettings.duplicate_this_agent.1e1d9501')"
            @click="duplicate(agent.id)"
          />
          <Icon
            icon="trash"
            :tooltip="
              agents.length <= 1
                ? t('settings.ai.AgentsSettings.the_last_agent_cannot_be.c57e2a82')
                : t('settings.ai.AgentsSettings.delete_this_agent.0ba11bd2')
            "
            :disabled="agents.length <= 1"
            @click="pendingRemoval = agent"
          />
        </template>
      </Card>
    </CardGrid>

    <div class="abele-agents-settings__actions">
      <Button
        :text="t('settings.ai.AgentsSettings.add_agent.d3e039d4')"
        accent
        :tooltip="t('settings.ai.AgentsSettings.create_an_agent_and_open.fd458de1')"
        @click="addAgent"
      />
    </div>

    <ConfirmModal
      v-if="pendingRemoval"
      :title="t('settings.ai.AgentsSettings.delete_agent.602cc4da')"
      :message="
        t('settings.ai.AgentsSettings.delete_value_chats_still_running.80b7b7d4', {
          value0: String(pendingRemoval.name),
        })
      "
      :confirm-tooltip="
        t('settings.ai.AgentsSettings.delete_value.8782b778', {
          value0: String(pendingRemoval.name),
        })
      "
      @confirm="remove(pendingRemoval.id)"
      @close="pendingRemoval = null"
    />

    <AgentEditorModal
      v-if="editingId"
      :agent-id="editingId"
      @close="editingId = ''"
      @changed="bump"
    />
  </Section>
</template>

<script setup lang="ts">
import { settingsCount } from '@/i18n/settingsCounts'
import { t } from '@/i18n'
import { streamBAgentDescription } from '@/i18n/streamBLabels'
import { computed, ref } from 'vue'
import Button from '../../obsidian/Button.vue'
import Icon from '../../obsidian/Icon.vue'
import Card from '../../obsidian/Card.vue'
import CardGrid from '../../obsidian/CardGrid.vue'
import Badge from '../../obsidian/Badge.vue'
import Section from '../../obsidian/Section.vue'
import ConfirmModal from '../../obsidian/ConfirmModal.vue'
import AgentEditorModal from './AgentEditorModal.vue'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import type { AgentDefinition } from '@/ai/agents/types'

const registry = AgentRegistry.getInstance()
const config = AbeleConfig.getInstance()

const editingId = ref('')
/** The agent a person asked to delete, held until they confirm. */
const pendingRemoval = ref<AgentDefinition | null>(null)
/** Nudged after an edit so labels derived from plain config fields refresh too. */
const revision = ref(0)
const bump = () => revision.value++

const agents = computed(() => {
  void revision.value
  return registry
    .list({ includeUtility: true, includeNode: true })
    .map((agent) =>
      agent.node && agent.description === agent.node.name ? { ...agent, description: '' } : agent
    )
})
const defaultAgentId = computed(() => {
  void revision.value
  return config.ai.defaultAgentId
})

function starTooltip(agent: AgentDefinition): string {
  if (agent.utility) return t('settings.ai.AgentsSettings.a_utility_agent_cannot_be.3315c30d')
  if (agent.id === defaultAgentId.value)
    return t('settings.ai.AgentsSettings.already_the_default_agent.28842ed7')
  return t('settings.ai.AgentsSettings.make_this_the_default_agent.4e646862')
}

function metaFor(agent: AgentDefinition): string[] {
  if (agent.node)
    return [
      t(
        !agent.node.permissionModeConfigured && agent.permissionMode === 'confirm-all'
          ? 'streamB.permissionInherit'
          : agent.permissionMode === 'allow-all'
            ? 'streamB.permissionBypass'
            : 'streamB.permissionAsk'
      ),
    ]
  return [modelLabel(agent), promptLabel(agent), scopeLabel(agent)]
}

function modelLabel(agent: AgentDefinition): string {
  if (!agent.modelId) return t('settings.ai.AgentsSettings.no_model.f62c7d17')
  const provider = config.ai.providers.find((p) => p.id === agent.providerId)
  const model = provider?.models.find((m) => m.id === agent.modelId)
  return model?.name || agent.modelId
}

function promptLabel(agent: AgentDefinition): string {
  return settingsCount('prompt', agent.prompts.length)
}

function scopeLabel(agent: AgentDefinition): string {
  if (agent.fullVaultAccess) return t('settings.ai.AgentsSettings.whole_vault.18d9a3b5')
  if (!agent.scope.length) return t('settings.ai.AgentsSettings.no_scope.cc0ca29a')
  return settingsCount('scopeEntry', agent.scope.length)
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
