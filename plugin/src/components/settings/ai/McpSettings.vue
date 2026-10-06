<template>
  <Section
    desc="Servers that give agents more tools, reached over HTTP — on a phone too. Nothing is
      started on this device. A server's tools reach an agent only once they are switched on in
      that agent's Access tab, and they ask before each call unless set otherwise."
  >
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
          <Badge v-if="!server.enabled" text="off" />
          <Badge v-if="!server.fetchedAt" text="not fetched" color="orange" />
        </template>

        <template #actions>
          <Icon icon="trash" tooltip="Delete this server" @click="pendingRemoval = server" />
        </template>
      </Card>
    </CardGrid>

    <EmptyState v-if="!servers.length" text="No MCP servers yet." />

    <div class="abele-mcp-settings__actions">
      <Button
        text="Add server"
        accent
        tooltip="Connect an MCP server by its address"
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
      title="Delete MCP server"
      :message="`Delete ${pendingRemoval.name || pendingRemoval.url}? Every agent loses its tools.`"
      :confirm-tooltip="`Delete ${pendingRemoval.name || pendingRemoval.url}`"
      @confirm="remove(pendingRemoval.id)"
      @close="pendingRemoval = null"
    />
  </Section>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { nanoid } from 'nanoid'
import Section from '../../obsidian/Section.vue'
import Card from '../../obsidian/Card.vue'
import CardGrid from '../../obsidian/CardGrid.vue'
import Badge from '../../obsidian/Badge.vue'
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
import { keyDestinations, acceptIntroducedDestinations } from '@/secrets/destinations'

const config = AbeleConfig.getInstance()

const servers = ref<McpServer[]>(JSON.parse(JSON.stringify(config.ai.mcpServers ?? [])))
const editing = ref<{ server: McpServer; isNew: boolean } | null>(null)
/** The server a person asked to delete, held until they confirm. */
const pendingRemoval = ref<McpServer | null>(null)

function metaFor(server: McpServer): string[] {
  const count = server.tools.length
  return server.fetchedAt ? [`${count} ${count === 1 ? 'tool' : 'tools'}`] : []
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
  const next = { ...server }
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
  if (server?.keyId) secrets().remove(server.keyId)
  servers.value = servers.value.filter((s) => s.id !== id)
  pendingRemoval.value = null
  persist()
}
</script>

<style lang="scss">
.abele-mcp-settings__actions {
  display: flex;
  justify-content: flex-end;
  padding-top: var(--size-4-3);
}
</style>
