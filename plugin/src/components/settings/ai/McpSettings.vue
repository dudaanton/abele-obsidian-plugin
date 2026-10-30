<template>
  <Section :desc="t('settings.ai.McpSettings.servers_that_give_agents_more.67631550')">
    <CardGrid wide>
      <Card
        v-for="server in servers"
        :key="server.id"
        :title="server.name || server.url"
        :subtitle="server.url"
        :meta="metaFor(server)"
        clickable
        @click="editing = { server, isNew: false }"
      >
        <template #badges>
          <!-- The server's state as a dot: on and its tools known, on but not asked yet, off. -->
          <StatusDot :tone="serverTone(server)" :label="serverState(server)" />
        </template>

        <template #actions>
          <Icon
            icon="trash"
            :tooltip="t('settings.ai.McpSettings.delete_this_server.e42cb344')"
            @click="pendingRemoval = server"
          />
        </template>
      </Card>
    </CardGrid>

    <EmptyState
      v-if="!servers.length"
      :text="t('settings.ai.McpSettings.no_mcp_servers_yet.cf5e91ef')"
    />

    <div class="abele-mcp-settings__actions">
      <Button
        data-testid="settings-mcp-add"
        :text="t('settings.ai.McpSettings.add_server.1099b2a9')"
        accent
        :tooltip="t('settings.ai.McpSettings.connect_an_mcp_server_by.60c5ad42')"
        @click="addServer"
      />
    </div>

    <McpServerModal
      v-if="editing"
      :server="editing.server"
      :servers="servers"
      :is-new="editing.isNew"
      @save="(server, token) => save(server, token)"
      @delete="remove(editing!.server.id)"
      @close="editing = null"
    />

    <ConfirmModal
      v-if="pendingRemoval"
      :title="t('settings.ai.McpSettings.delete_mcp_server.1a969bef')"
      :message="
        t('settings.ai.McpSettings.delete_value_every_agent_loses.cf787f8d', {
          value0: String(pendingRemoval.name || pendingRemoval.url),
        })
      "
      :confirm-tooltip="
        t('settings.ai.McpSettings.delete_value.8782b778', {
          value0: String(pendingRemoval.name || pendingRemoval.url),
        })
      "
      @confirm="remove(pendingRemoval.id)"
      @close="pendingRemoval = null"
    />
  </Section>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { settingsCount } from '@/i18n/settingsCounts'
import StatusDot from '../../obsidian/StatusDot.vue'
import { ref } from 'vue'
import { nanoid } from 'nanoid'
import Section from '../../obsidian/Section.vue'
import Card from '../../obsidian/Card.vue'
import CardGrid from '../../obsidian/CardGrid.vue'
import Button from '../../obsidian/Button.vue'
import Icon from '../../obsidian/Icon.vue'
import EmptyState from '../../obsidian/EmptyState.vue'
import ConfirmModal from '../../obsidian/ConfirmModal.vue'
import McpServerModal from './McpServerModal.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { McpService } from '@/ai/mcp/McpService'
import { mcpKeyId, notifyMcpPermissionReset } from '@/ai/mcp/settings'
import { migrateMcpPermissions } from '@/ai/mcp/permissions'
import { createMcpServer, type McpServer } from '@/ai/mcp/types'
import { secrets } from '@/secrets/SecretStore'
import { mcpSecretIds, protectMcpHeaders } from '@/ai/mcp/headerSecrets'
import { keyDestinations, acceptIntroducedDestinations } from '@/secrets/destinations'

const config = AbeleConfig.getInstance()

const servers = ref<McpServer[]>(JSON.parse(JSON.stringify(config.ai.mcpServers ?? [])))
const editing = ref<{ server: McpServer; isNew: boolean } | null>(null)
/** The server a person asked to delete, held until they confirm. */
const pendingRemoval = ref<McpServer | null>(null)

function metaFor(server: McpServer): string[] {
  const count = server.tools.length
  return server.fetchedAt ? [settingsCount('tool', count)] : []
}

function addServer(): void {
  editing.value = { server: createMcpServer({ id: nanoid(10) }), isNew: true }
}

/** Written into the settings whole: this tab is the only one that owns the list. */
function persist(): void {
  const before = keyDestinations(config)
  config.ai = { ...config.ai, mcpServers: JSON.parse(JSON.stringify(servers.value)) }
  acceptIntroducedDestinations(before, keyDestinations(config))
  // A changed address or token must not be answered by a connection made with the old one.
  McpService.getInstance().reset()
  void config.saveSettings()
}

function save(server: McpServer, token?: string | null): void {
  const next = { ...protectMcpHeaders(server, (id, value) => secrets().set(id, value)) }
  if (token) {
    next.keyId = mcpKeyId(next.id)
    secrets().set(next.keyId, token)
  } else if (token === null && next.keyId) {
    secrets().remove(next.keyId)
    next.keyId = ''
  }

  const at = servers.value.findIndex((s) => s.id === next.id)
  const before = at === -1 ? null : servers.value[at]
  if (before && before.name !== next.name) migrateToolModes()

  if (at === -1) servers.value = [...servers.value, next]
  else servers.value = servers.value.map((s, i) => (i === at ? next : s))
  persist()
}

/** Resolve legacy aliases before a label changes; identity permissions stay untouched. */
function migrateToolModes(): void {
  const result = migrateMcpPermissions(config.ai)
  notifyMcpPermissionReset(result.reset)
  const moved = result.ai
  if (moved === config.ai) return
  const registry = AgentRegistry.getInstance()
  for (const agent of moved.agents) {
    const current = registry.get(agent.id)
    if (current && current.toolModes !== agent.toolModes) {
      registry.update(agent.id, { toolModes: agent.toolModes })
    }
  }
  config.ai = { ...config.ai, toolModes: moved.toolModes, mcpLegacyToolMap: moved.mcpLegacyToolMap }
}

function remove(id: string): void {
  const server = servers.value.find((s) => s.id === id)
  if (server) for (const id of mcpSecretIds(server)) secrets().remove(id)
  servers.value = servers.value.filter((s) => s.id !== id)
  pendingRemoval.value = null
  persist()
}

const serverState = (server: { enabled?: boolean; fetchedAt?: unknown }) =>
  !server.enabled
    ? t('settings.ai.McpSettings.off.ca7981b4')
    : server.fetchedAt
      ? t('settings.ai.McpSettings.on.13001175')
      : t('settings.ai.McpSettings.on_tools_not_fetched_yet.28d5069f')
const serverTone = (server: { enabled?: boolean; fetchedAt?: unknown }) =>
  !server.enabled ? 'faint' : server.fetchedAt ? 'green' : 'orange'
</script>

<style lang="scss">
.abele-mcp-settings__actions {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--size-4-3);
}
</style>
