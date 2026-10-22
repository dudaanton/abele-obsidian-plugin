<template>
  <ObsidianModal
    :title="
      agent
        ? t('settings.ai.AgentEditorModal.agent_value.c67844d1', { value0: String(agent.name) })
        : t('settings.ai.AgentEditorModal.agent.11b39c93')
    "
    :size="Platform.isMobile ? 'tall' : 'wide'"
    @close="emit('close')"
  >
    <div class="abele-agent-editor">
      <Tabs v-model="section" :tabs="sections" level="secondary" />

      <div v-if="agent" class="abele-agent-editor__body">
        <!-- Basic -->
        <template v-if="section === 'basic'">
          <Setting
            :name="t('settings.ai.AgentEditorModal.name.dcd1d522')"
            :desc="t('settings.ai.AgentEditorModal.shown_in_the_agent_picker.fad20e51')"
          >
            <Input :model-value="agent.name" @update:model-value="patch({ name: $event })" />
          </Setting>

          <Setting
            :name="t('settings.ai.AgentEditorModal.description.526e0087')"
            :desc="t('settings.ai.AgentEditorModal.tells_other_agents_what_this.f64bf342')"
          >
            <Input
              :model-value="agent.description"
              as-text-area
              @update:model-value="patch({ description: $event })"
            />
          </Setting>

          <template v-if="!agent.node">
            <Setting
              :name="t('settings.ai.AgentEditorModal.utility_agent.e8384fe8')"
              :desc="t('settings.ai.AgentEditorModal.hidden_from_the_chat_picker.a9f2b9dc')"
            >
              <Checkbox :is-enabled="agent.utility" @toggle="patch({ utility: !agent.utility })" />
            </Setting>

            <Setting
              :name="t('settings.ai.AgentEditorModal.model.5e2c614c')"
              :desc="t('settings.ai.AgentEditorModal.the_model_this_agent_runs.d092d7ab')"
            >
              <Dropdown
                :model-value="modelKey"
                :options="modelOptions"
                @update:model-value="selectModel($event)"
              />
            </Setting>

            <Setting
              :name="t('settings.ai.AgentEditorModal.fallback_model.ed293bb6')"
              :desc="t('settings.ai.AgentEditorModal.offered_as_a_retry_when.3264a4a0')"
            >
              <Dropdown
                :model-value="fallbackKey"
                :options="[
                  { value: '', display: t('settings.ai.AgentEditorModal.none.dc937b59') },
                  ...modelOptions,
                ]"
                @update:model-value="selectFallback($event)"
              />
            </Setting>

            <Setting
              :name="t('settings.ai.AgentEditorModal.background_model.905a0833')"
              :desc="t('settings.ai.AgentEditorModal.for_naming_and_compacting_this.772ec428')"
            >
              <Dropdown
                :model-value="backgroundKey"
                :options="[
                  {
                    value: '',
                    display: t('settings.ai.AgentEditorModal.follow_the_setting.ead899ca'),
                  },
                  ...modelOptions,
                ]"
                @update:model-value="selectBackground($event)"
              />
            </Setting>

            <!-- The interceptors in the order they run, each given what the one before returned. -->
            <InterceptorList
              :entries="interceptorEntries"
              :choices="interceptorOptions"
              :narrow="Platform.isPhone"
              pattern-placeholder="^/todo"
              :desc="t('settings.ai.AgentEditorModal.they_read_this_agent_s.81992c4a')"
              @update:entries="patch({ interceptors: $event })"
            />
          </template>
        </template>

        <!-- Prompts -->
        <Section
          v-else-if="section === 'prompts'"
          :desc="
            t('settings.ai.AgentEditorModal.blocks_are_joined_in_order.b7a98cc9', {
              value0: String(DATE_TOKEN),
            })
          "
        >
          <CardGrid stack>
            <Card
              v-for="(prompt, idx) in agent.prompts"
              :key="idx"
              :title="
                t('settings.ai.AgentEditorModal.block_value.dd05ec6a', { value0: String(idx + 1) })
              "
            >
              <template #actions>
                <Icon
                  icon="chevron-up"
                  :tooltip="t('settings.ai.AgentEditorModal.move_up.c66feb5e')"
                  :disabled="idx === 0"
                  @click="movePrompt(idx, -1)"
                />
                <Icon
                  icon="chevron-down"
                  :tooltip="t('settings.ai.AgentEditorModal.move_down.40bb50da')"
                  :disabled="idx === agent.prompts.length - 1"
                  @click="movePrompt(idx, 1)"
                />
                <Icon
                  icon="trash"
                  :tooltip="t('settings.ai.AgentEditorModal.remove.c3812fc4')"
                  @click="removePrompt(idx)"
                />
              </template>

              <Dropdown
                :model-value="prompt.type"
                :options="PROMPT_TYPES"
                @update:model-value="setPromptType(idx, $event as 'text' | 'note')"
              />
              <Search
                v-if="prompt.type === 'note'"
                :model-value="prompt.value"
                :placeholder="t('settings.ai.AgentEditorModal.path_to_note.ef6763e6')"
                :suggester="FileSuggest"
                @update:model-value="setPromptValue(idx, $event)"
              />
              <Input
                v-else
                :model-value="prompt.value"
                as-text-area
                :placeholder="
                  t('settings.ai.AgentEditorModal.instructions_for_this_agent.6ef9a0d2')
                "
                @update:model-value="setPromptValue(idx, $event)"
              />
            </Card>
          </CardGrid>

          <EmptyState
            v-if="!agent.prompts.length"
            :text="t('settings.ai.AgentEditorModal.no_prompt_blocks_this_agent.856efff4')"
          />

          <div class="abele-agent-editor__actions">
            <Button
              :text="t('settings.ai.AgentEditorModal.add_text_block.4b0903f4')"
              :tooltip="t('settings.ai.AgentEditorModal.append_a_block_of_instructions.b6b6e5b8')"
              @click="addPrompt('text')"
            />
            <Button
              :text="t('settings.ai.AgentEditorModal.add_note_block.34512584')"
              :tooltip="t('settings.ai.AgentEditorModal.append_a_block_read_from.f3396cf7')"
              @click="addPrompt('note')"
            />
          </div>
        </Section>

        <!-- Memory -->
        <AgentMemoryEditor
          v-else-if="section === 'memory'"
          :agent-id="agentId"
          @changed="persist()"
        />

        <!-- Access -->
        <template v-else-if="section === 'access'">
          <Setting
            :name="t('settings.ai.AgentEditorModal.permission_mode.c7a8e6db')"
            :desc="
              agent.node
                ? t(
                    agent.node.provider === 'codex'
                      ? agent.permissionMode === 'allow-all'
                        ? 'streamB.permissionCodexFolder'
                        : 'streamB.permissionCodexAsk'
                      : 'streamB.permissionOwnerChoice'
                  )
                : t('settings.ai.AgentEditorModal.what_this_agent_may_do.5022e01c')
            "
          >
            <Dropdown
              :model-value="
                agent.node &&
                !agent.node.permissionModeConfigured &&
                agent.permissionMode === 'confirm-all'
                  ? 'inherit'
                  : agent.permissionMode
              "
              :options="agent.node ? nodePermissionOptions : PERMISSION_OPTIONS"
              @update:model-value="patchPermissionMode"
            />
            <span
              v-if="
                agent.node &&
                !agent.node.permissionModeConfigured &&
                agent.permissionMode === 'confirm-all'
              "
              class="setting-item-description"
            >
              · {{ t('streamB.permissionAskNow') }}
            </span>
          </Setting>
          <div
            v-if="agent.node?.provider === 'codex' && agent.permissionMode !== 'allow-all'"
            class="abele-node-permission-warning"
          >
            <StatusDot tone="orange" :label="t('streamB.permissionCodexAsk')" />{{
              t('streamB.permissionCodexAsk')
            }}
          </div>

          <NodeBypassHelp
            v-if="
              agent.node &&
              nodePermissionReason &&
              /bypass.*(disabled|unsupported|not_allowed|not_enabled)|allow.bypass/.test(
                nodePermissionReason
              )
            "
          />
          <template v-if="!agent.node">
            <Section
              :title="t('settings.git.repositoryConnections')"
              :desc="t('settings.ai.AgentEditorModal.off_no_access_ask_approve.d4da8c61')"
            >
              <Setting
                v-for="connection in githubConnections"
                :key="connection.id"
                :name="connection.name"
                :desc="
                  !isBrowsableConnection(connection)
                    ? connectionUnavailableReason(connection)
                    : `${connection.provider || t('settings.git.githubId')} · ${connection.server || t('settings.ai.AgentEditorModal.github_com.3aeb0024')}${connection.account ? ' · ' + connection.account.login : ''}`
                "
              >
                <Dropdown
                  v-if="isBrowsableConnection(connection)"
                  :model-value="agent.githubConnections?.[connection.id] ?? 'off'"
                  :options="CONNECTION_MODES"
                  @update:model-value="
                    patch({
                      githubConnections: {
                        ...agent.githubConnections,
                        [connection.id]: $event as ToolMode,
                      },
                    })
                  "
                />
              </Setting>
              <Setting
                v-for="id in missingGithubConnections"
                :key="id"
                :name="
                  t('settings.ai.AgentEditorModal.unavailable_connection_value.795252e1', {
                    value0: String(id),
                  })
                "
                :desc="t('settings.ai.AgentEditorModal.this_agent_refers_to_a.48e627ef')"
              >
                <Dropdown
                  :model-value="agent.githubConnections?.[id] ?? 'off'"
                  :options="CONNECTION_MODES"
                  @update:model-value="
                    patch({
                      githubConnections: { ...agent.githubConnections, [id]: $event as ToolMode },
                    })
                  "
                />
              </Setting>
            </Section>
            <Section
              :title="t('settings.ai.AgentEditorModal.scope.b073f6c6')"
              :desc="t('settings.ai.AgentEditorModal.where_this_agent_works_by.08d21d74')"
            >
              <AiScopeEditor
                :entries="agent.scope"
                :full-vault-access="agent.fullVaultAccess"
                @update:entries="patch({ scope: $event })"
                @update:full-vault-access="patch({ fullVaultAccess: $event })"
              />
            </Section>
          </template>
          <p v-if="agent.node" class="abele-agent-editor__runner" role="status">
            <StatusDot :tone="runner.state === 'device' ? 'green' : 'orange'" :label="runnerSaid" />
            {{ runnerSaid }}
          </p>
          <Section
            :title="t('settings.ai.AgentEditorModal.tools.ea93d6a2')"
            :desc="
              agent.node
                ? undefined
                : t('settings.ai.AgentEditorModal.off_unavailable_ask_needs_approval.845b7983')
            "
          >
            <Setting
              v-if="!agent.node"
              :name="t('settings.ai.AgentEditorModal.offer_tools.677c3882')"
              :desc="t('settings.ai.AgentEditorModal.by_section_the_agent_sees.636028d7')"
            >
              <Dropdown
                :model-value="toolDiscoveryMode(agent)"
                :options="[
                  {
                    value: 'sections',
                    display: t('settings.ai.AgentEditorModal.by_section.2c8a0eb5'),
                  },
                  {
                    value: 'all-at-once',
                    display: t('settings.ai.AgentEditorModal.all_at_once.f9068371'),
                  },
                ]"
                @update:model-value="patch({ toolDiscovery: $event as 'sections' | 'all-at-once' })"
              />
            </Setting>
            <ChatToolModes
              v-if="agent.node"
              :registry="nodeToolRegistry"
              :tool-modes="effectiveToolModes"
              :floor="{}"
              core-modes
              @update-many="setToolModes"
            />
            <ToolModesEditor
              v-else
              :tool-modes="effectiveToolModes"
              :core-modes="!!agent.node"
              collapsed
              hide-show-all
              :by-section="toolDiscoveryMode(agent) === 'sections'"
              :section-opening="agent.toolSectionOpening ?? {}"
              :section-descriptions="agent.toolSectionDescriptions ?? {}"
              @update="setToolMode"
              @update-many="setToolModes"
              @update-opening="
                (section: string, opening: 'always' | 'on-request') =>
                  patch({ toolSectionOpening: { ...agent.toolSectionOpening, [section]: opening } })
              "
              @update-section-description="
                (section: string, text: string) =>
                  patch({
                    toolSectionDescriptions: own(agent.toolSectionDescriptions, section, text),
                  })
              "
            />
          </Section>
        </template>

        <!-- Skills -->
        <template v-else-if="section === 'skills'">
          <Setting
            :name="t('settings.ai.AgentEditorModal.skills.66d0f523')"
            :desc="t('settings.ai.AgentEditorModal.which_skills_this_agent_can.a35316d3')"
          >
            <Dropdown
              :model-value="agent.skillsMode"
              :options="SKILL_MODES"
              @update:model-value="patch({ skillsMode: $event as SkillsMode })"
            />
          </Setting>

          <template v-if="agent.skillsMode === 'selected'">
            <Setting
              v-for="skill in skills"
              :key="skill.path"
              :name="skill.name"
              :desc="skill.description"
            >
              <Checkbox
                :is-enabled="agent.skills.includes(skill.name)"
                @toggle="toggleSkill(skill.name)"
              />
            </Setting>

            <EmptyState v-if="!skills.length">
              <I18nText :text="t('settings.rich.ae545f75ff9437be', { slot0: '⟪slot0⟫' })"
                ><template #slot0><code>type: abele-skill</code></template></I18nText
              ></EmptyState
            >
          </template>
        </template>

        <!-- Delegation -->
        <template v-else-if="section === 'delegation'">
          <Setting
            :name="t('settings.ai.AgentEditorModal.delegation_depth.29ea0156')"
            :desc="t('settings.ai.AgentEditorModal.how_far_this_agent_may.3ae4d41e')"
          >
            <Dropdown
              :model-value="String(agent.maxDelegateDepth)"
              :options="DEPTH_OPTIONS"
              @update:model-value="patch({ maxDelegateDepth: Number($event) })"
            />
          </Setting>
        </template>
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import NodeBypassHelp from '../../NodeBypassHelp.vue'
import StatusDot from '../../obsidian/StatusDot.vue'
import { nodeToolRunners } from '@/node/nodeAgentTools'
import { NodeObsidianAdapter } from '@/node/NodeObsidianAdapter'
import I18nText from '@/components/obsidian/I18nText.vue'
import { t } from '@/i18n'
import { isBrowsableConnection, connectionUnavailableReason } from '@/github/connections'
import { computed, ref } from 'vue'
import ObsidianModal from '../../obsidian/Modal.vue'
import Setting from '../../obsidian/Setting.vue'
import Section from '../../obsidian/Section.vue'
import Input from '../../obsidian/Input.vue'
import Button from '../../obsidian/Button.vue'
import Checkbox from '../../obsidian/Checkbox.vue'
import Dropdown from '../../obsidian/Dropdown.vue'
import Search from '../../obsidian/Search.vue'
import Icon from '../../obsidian/Icon.vue'
import Tabs from '../../obsidian/Tabs.vue'
import Card from '../../obsidian/Card.vue'
import CardGrid from '../../obsidian/CardGrid.vue'
import EmptyState from '../../obsidian/EmptyState.vue'
import AiScopeEditor from '../../AiScopeEditor.vue'
import ToolModesEditor from '../../ToolModesEditor.vue'
import ChatToolModes from '../../ChatToolModes.vue'

import AgentMemoryEditor from './AgentMemoryEditor.vue'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { discoverSkills } from '@/ai/tools/SkillTool'
import { toolDiscoveryMode, type AgentDefinition } from '@/ai/agents/types'
import { interceptorScripts } from '@/ai/interceptor/runScript'
import InterceptorList from './InterceptorList.vue'
import { entriesOf } from '@/ai/interceptor/entries'
import { Platform } from 'obsidian'
import { interceptorChoices, PERMISSION_OPTIONS } from './options'
import type { PermissionMode, ToolMode } from '@/ai/types'

/** A map with one key set, or taken out when its value is empty. */
function own(map: Record<string, string> | undefined, key: string, value: string) {
  const next = { ...map }
  if (value) next[key] = value
  else delete next[key]
  return next
}

type SkillsMode = AgentDefinition['skillsMode']

const props = defineProps<{ agentId: string; nodePermissionReason?: string }>()
const emit = defineEmits<{ close: []; changed: [] }>()

const SECTIONS = [
  { id: 'basic', label: t('settings.ai.AgentEditorModal.basic.0e35f6e9') },
  { id: 'prompts', label: t('settings.ai.AgentEditorModal.prompts.5f2e66e6') },
  { id: 'memory', label: t('settings.ai.AgentEditorModal.memory.c3963aed') },
  { id: 'access', label: t('settings.ai.AgentEditorModal.access.ec5ba0ab') },
  { id: 'skills', label: t('settings.ai.AgentEditorModal.skills.66d0f523') },
  { id: 'delegation', label: t('settings.ai.AgentEditorModal.delegation.a6d910ba') },
]

/** Written out in script: nested moustaches in the template confuse the Vue parser. */
const DATE_TOKEN = '{{date}}'

const PROMPT_TYPES = [
  { value: 'text', display: t('settings.ai.AgentEditorModal.text.71988c4d') },
  { value: 'note', display: t('settings.ai.AgentEditorModal.note.d8da2c49') },
]

const SKILL_MODES = [
  { value: 'all', display: t('settings.ai.AgentEditorModal.all_skills.78abcbbf') },
  { value: 'none', display: t('settings.ai.AgentEditorModal.no_skills.5083cd4b') },
  { value: 'selected', display: t('settings.ai.AgentEditorModal.only_selected.c1792bfe') },
]

const DEPTH_OPTIONS = [
  { value: '0', display: t('settings.ai.AgentEditorModal.cannot_delegate.6a16ca61') },
  { value: '1', display: t('settings.ai.AgentEditorModal.level.3292ae98') },
  { value: '2', display: t('settings.ai.AgentEditorModal.levels.8b7cdd29') },
  { value: '3', display: t('settings.ai.AgentEditorModal.levels.93b1554a') },
]

const registry = AgentRegistry.getInstance()
const nodePermissionOptions = computed(() => [
  { value: 'inherit', display: t('streamB.permissionInherit') },
  { value: 'confirm-all', display: t('streamB.permissionAsk') },
  { value: 'allow-all', display: t('streamB.permissionBypass') },
])
const config = AbeleConfig.getInstance()

/** The stored, reactive agent — edits reach open chats as they are typed. */
const agent = computed(() => registry.get(props.agentId))
const CONNECTION_MODES = [
  { value: 'off', display: t('settings.ai.AgentEditorModal.off.ca7981b4') },
  { value: 'ask', display: t('settings.ai.AgentEditorModal.ask.b8c209cd') },
  { value: 'auto', display: t('settings.ai.AgentEditorModal.on.13001175') },
]
const githubConnections = computed(() => {
  void config.version.value
  return config.github?.connections ?? []
})
const missingGithubConnections = computed(() =>
  Object.keys(agent.value?.githubConnections ?? {}).filter(
    (id) => !githubConnections.value.some((c) => c.id === id)
  )
)
const skills = computed(() => discoverSkills())

const sections = computed(() =>
  agent.value?.node ? SECTIONS.filter((item) => ['basic', 'access'].includes(item.id)) : SECTIONS
)
const section = ref(registry.get(props.agentId)?.node ? 'access' : 'basic')
const runner = computed(() => nodeToolRunners[agent.value?.node?.id ?? ''] ?? { state: 'none' })
const runnerSaid = computed(() =>
  runner.value.state === 'device'
    ? t('node.tools.runner', { device: runner.value.device ?? '' })
    : t('node.tools.noRunner')
)
const effectiveToolModes = computed(() => {
  if (!agent.value?.node) return agent.value?.toolModes ?? {}
  const adapter = new NodeObsidianAdapter(agent.value.id, 'settings', async () => [])
  try {
    return {
      ...Object.fromEntries(adapter.tools().map((tool) => [tool.name, tool.mode])),
      ...agent.value.toolModes,
    }
  } finally {
    adapter.destroy()
  }
})
const nodeToolRegistry = computed(() => {
  const adapter = new NodeObsidianAdapter(props.agentId, 'settings', async () => [])
  try {
    return adapter.toolRegistry()
  } finally {
    adapter.destroy()
  }
})

// ── Editing ──

function patch(fields: Partial<AgentDefinition>): void {
  registry.update(props.agentId, fields)
  persist()
}
function patchPermissionMode(value: string): void {
  patch({
    permissionMode: (value === 'inherit' ? 'confirm-all' : value) as PermissionMode,
    ...(agent.value?.node
      ? { node: { ...agent.value.node, permissionModeConfigured: value !== 'inherit' } }
      : {}),
  })
}

const persist = (): void => {
  emit('changed')
  void config.saveSettings()
}

// ── Model ──

const modelOptions = computed(() => {
  const opts: { value: string; display: string }[] = []
  for (const provider of config.ai.providers) {
    for (const model of provider.models) {
      opts.push({
        value: `${provider.id}::${model.id}`,
        display: `${model.name || model.id} · ${provider.name}`,
      })
    }
  }
  return opts
})

const modelKey = computed(() =>
  agent.value?.modelId ? `${agent.value.providerId}::${agent.value.modelId}` : ''
)
const fallbackKey = computed(() =>
  agent.value?.fallbackModelId
    ? `${agent.value.fallbackProviderId ?? ''}::${agent.value.fallbackModelId}`
    : ''
)

function selectModel(key: string): void {
  const [providerId, modelId] = key.split('::')
  patch({ providerId: providerId || '', modelId: modelId || '' })
}

const backgroundKey = computed(() =>
  agent.value?.auxiliaryModelId
    ? `${agent.value.auxiliaryProviderId ?? ''}::${agent.value.auxiliaryModelId}`
    : ''
)

function selectBackground(key: string): void {
  if (!key) {
    patch({ auxiliaryProviderId: undefined, auxiliaryModelId: undefined })
    return
  }
  const [providerId, modelId] = key.split('::')
  patch({ auxiliaryProviderId: providerId || '', auxiliaryModelId: modelId || '' })
}

// ── Interceptor ──

/**
 * Every other agent, utility ones included — reviewing is what most of them are for — and the
 * interceptor scripts. Not this one: an agent reviewing its own drafts is a loop with extra steps.
 */
const interceptorOptions = computed(() =>
  interceptorChoices(
    registry.list({ includeUtility: true }),
    interceptorScripts().map((script) => script.meta.name),
    '',
    props.agentId
  )
)

/** The agent's interceptors in their order; one set before lists reads as a list of one. */
const interceptorEntries = computed(() => (agent.value ? entriesOf(agent.value) : []))

function selectFallback(key: string): void {
  if (!key) {
    patch({ fallbackProviderId: undefined, fallbackModelId: undefined })
    return
  }
  const [providerId, modelId] = key.split('::')
  patch({ fallbackProviderId: providerId || '', fallbackModelId: modelId || '' })
}

// ── Prompts ──

function addPrompt(type: 'text' | 'note'): void {
  patch({ prompts: [...(agent.value?.prompts ?? []), { type, value: '' }] })
}

function removePrompt(idx: number): void {
  const prompts = [...(agent.value?.prompts ?? [])]
  prompts.splice(idx, 1)
  patch({ prompts })
}

function movePrompt(idx: number, delta: number): void {
  const prompts = [...(agent.value?.prompts ?? [])]
  const target = idx + delta
  if (target < 0 || target >= prompts.length) return
  ;[prompts[idx], prompts[target]] = [prompts[target], prompts[idx]]
  patch({ prompts })
}

function setPromptType(idx: number, type: 'text' | 'note'): void {
  const prompts = [...(agent.value?.prompts ?? [])]
  // The value is cleared: a note path is not usable as prompt text, nor the other way round.
  prompts[idx] = { type, value: '' }
  patch({ prompts })
}

function setPromptValue(idx: number, value: string): void {
  const prompts = [...(agent.value?.prompts ?? [])]
  prompts[idx] = { ...prompts[idx], value }
  patch({ prompts })
}

// ── Tools and skills ──

function setToolMode(toolName: string, mode: ToolMode): void {
  patch({ toolModes: { ...(agent.value?.toolModes ?? {}), [toolName]: mode } })
}

function setToolModes(modes: Record<string, ToolMode>): void {
  patch({ toolModes: { ...(agent.value?.toolModes ?? {}), ...modes } })
}

function toggleSkill(name: string): void {
  const current = agent.value?.skills ?? []
  const next = current.includes(name) ? current.filter((s) => s !== name) : [...current, name]
  patch({ skills: next })
}
</script>

<style lang="scss">
.abele-agent-editor__runner {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
.abele-agent-editor {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
}

/**
 * The sections differ wildly in length — Delegation is one row, Access is three groups — so
 * the body scrolls on its own and the tab strip above it stays put. A scrolling box clips at its
 * padding edge, so the padding is room for a field's focus ring — the fields reach its sides —
 * pulled back by the same margin so the rows stand where they would. Except on the right: the
 * dialog's body around it scrolls too, and a box reaching past its right edge by that margin
 * gave the whole dialog 4px to scroll sideways. The ring's room there comes out of the rows.
 */
.abele-agent-editor__body {
  min-height: 16em;
  max-height: 60vh;
  overflow-y: auto;
  // Prompt and scope controls extend into the row gutter; leave their rings room on both sides.
  padding: var(--size-2-2) calc(var(--size-2-2) + var(--size-4-1)) var(--size-2-2)
    calc(var(--size-2-2) + var(--size-4-1));
  margin: calc(-1 * var(--size-2-2)) 0 calc(-1 * var(--size-2-2)) calc(-1 * var(--size-2-2));
}

// On a phone the dialog shell owns scrolling; a 60vh box inside it caps the form twice.
.is-phone .abele-agent-editor__body {
  max-height: none;
  overflow-y: visible;
}

.abele-agent-editor__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
  margin-top: var(--size-4-3);
}
.abele-node-permission-warning {
  display: flex;
  align-items: baseline;
  gap: var(--size-4-2);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  margin-block: var(--size-4-2);
}
</style>
