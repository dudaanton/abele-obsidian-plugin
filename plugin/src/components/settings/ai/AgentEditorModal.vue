<template>
  <ObsidianModal
    :title="agent ? `Agent: ${agent.name}` : 'Agent'"
    size="wide"
    @close="emit('close')"
  >
    <div class="abele-agent-editor">
      <Tabs v-model="section" :tabs="SECTIONS" level="secondary" />

      <div v-if="agent" class="abele-agent-editor__body">
        <!-- Basic -->
        <template v-if="section === 'basic'">
          <Setting name="Name" desc="Shown in the agent picker.">
            <Input :model-value="agent.name" @update:model-value="patch({ name: $event })" />
          </Setting>

          <Setting name="Description" desc="Tells other agents what this one is for.">
            <Input
              :model-value="agent.description"
              as-text-area
              @update:model-value="patch({ description: $event })"
            />
          </Setting>

          <Setting
            name="Utility agent"
            desc="Hidden from the chat picker. Still available to scripts, delegation and draft
              review."
          >
            <Checkbox :is-enabled="agent.utility" @toggle="patch({ utility: !agent.utility })" />
          </Setting>

          <Setting name="Model" desc="The model this agent runs on.">
            <Dropdown
              :model-value="modelKey"
              :options="modelOptions"
              @update:model-value="selectModel($event)"
            />
          </Setting>

          <Setting
            name="Fallback model"
            desc="Offered as a retry when a request fails. Used automatically in delegated runs,
              where nobody can press a button."
          >
            <Dropdown
              :model-value="fallbackKey"
              :options="[{ value: '', display: 'None' }, ...modelOptions]"
              @update:model-value="selectFallback($event)"
            />
          </Setting>
        </template>

        <!-- Prompts -->
        <Section
          v-else-if="section === 'prompts'"
          :desc="`Blocks are joined in order with a blank line between them. Use ${DATE_TOKEN} for today's date.`"
        >
          <CardGrid stack>
            <Card v-for="(prompt, idx) in agent.prompts" :key="idx" :title="`Block ${idx + 1}`">
              <template #actions>
                <Icon
                  icon="chevron-up"
                  tooltip="Move up"
                  :disabled="idx === 0"
                  @click="movePrompt(idx, -1)"
                />
                <Icon
                  icon="chevron-down"
                  tooltip="Move down"
                  :disabled="idx === agent.prompts.length - 1"
                  @click="movePrompt(idx, 1)"
                />
                <Icon icon="trash" tooltip="Remove" @click="removePrompt(idx)" />
              </template>

              <Dropdown
                :model-value="prompt.type"
                :options="PROMPT_TYPES"
                @update:model-value="setPromptType(idx, $event as 'text' | 'note')"
              />
              <Search
                v-if="prompt.type === 'note'"
                :model-value="prompt.value"
                placeholder="Path to note..."
                :suggester="FileSuggest"
                @update:model-value="setPromptValue(idx, $event)"
              />
              <Input
                v-else
                :model-value="prompt.value"
                as-text-area
                placeholder="Instructions for this agent..."
                @update:model-value="setPromptValue(idx, $event)"
              />
            </Card>
          </CardGrid>

          <EmptyState
            v-if="!agent.prompts.length"
            text="No prompt blocks. This agent runs with no instructions of its own."
          />

          <div class="abele-agent-editor__actions">
            <Button
              text="Add text block"
              tooltip="Append a block of instructions written here"
              @click="addPrompt('text')"
            />
            <Button
              text="Add note block"
              tooltip="Append a block read from a note in the vault"
              @click="addPrompt('note')"
            />
          </div>
        </Section>

        <!-- Access -->
        <template v-else-if="section === 'access'">
          <Setting name="Permission mode" desc="What this agent may do without asking.">
            <Dropdown
              :model-value="agent.permissionMode"
              :options="PERMISSION_OPTIONS"
              @update:model-value="patch({ permissionMode: $event as PermissionMode })"
            />
          </Setting>

          <Section
            title="Scope"
            desc="Where this agent works by default. A delegated run also gets whatever the chat
              that delegated to it had open."
          >
            <AiScopeEditor
              :entries="agent.scope"
              :full-vault-access="agent.fullVaultAccess"
              @update:entries="patch({ scope: $event })"
              @update:full-vault-access="patch({ fullVaultAccess: $event })"
            />
          </Section>

          <Section
            title="Tools"
            desc="Off = unavailable. Ask = needs approval. Auto = runs on its own. File tools are
              always available and governed by the permission mode above."
          >
            <ToolModesEditor :tool-modes="agent.toolModes" hide-show-all @update="setToolMode" />
          </Section>
        </template>

        <!-- Skills -->
        <template v-else-if="section === 'skills'">
          <Setting name="Skills" desc="Which skills this agent can load on demand.">
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
              No skills in this vault. Skills are notes with <code>type: abele-skill</code>.
            </EmptyState>
          </template>
        </template>

        <!-- Delegation -->
        <template v-else-if="section === 'delegation'">
          <Setting
            name="Delegation depth"
            desc="How far this agent may delegate. 0 removes the delegate tool entirely."
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
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { discoverSkills } from '@/ai/tools/SkillTool'
import type { AgentDefinition } from '@/ai/agents/types'
import type { PermissionMode, ToolMode } from '@/ai/types'

type SkillsMode = AgentDefinition['skillsMode']

const props = defineProps<{ agentId: string }>()
const emit = defineEmits<{ close: []; changed: [] }>()

const SECTIONS = [
  { id: 'basic', label: 'Basic' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'access', label: 'Access' },
  { id: 'skills', label: 'Skills' },
  { id: 'delegation', label: 'Delegation' },
]

/** Written out in script: nested moustaches in the template confuse the Vue parser. */
const DATE_TOKEN = '{{date}}'

const PROMPT_TYPES = [
  { value: 'text', display: 'Text' },
  { value: 'note', display: 'Note' },
]

const PERMISSION_OPTIONS = [
  { value: 'confirm-all', display: 'Ask before every change' },
  { value: 'allow-edit', display: 'Edit files without asking' },
  { value: 'allow-all', display: 'Everything without asking' },
]

const SKILL_MODES = [
  { value: 'all', display: 'All skills' },
  { value: 'none', display: 'No skills' },
  { value: 'selected', display: 'Only selected' },
]

const DEPTH_OPTIONS = [
  { value: '0', display: 'Cannot delegate' },
  { value: '1', display: '1 level' },
  { value: '2', display: '2 levels' },
  { value: '3', display: '3 levels' },
]

const registry = AgentRegistry.getInstance()
const config = AbeleConfig.getInstance()

/** The stored, reactive agent — edits reach open chats as they are typed. */
const agent = computed(() => registry.get(props.agentId))
const skills = computed(() => discoverSkills())

const section = ref('basic')

// ── Editing ──

function patch(fields: Partial<AgentDefinition>): void {
  registry.update(props.agentId, fields)
  persist()
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

function toggleSkill(name: string): void {
  const current = agent.value?.skills ?? []
  const next = current.includes(name) ? current.filter((s) => s !== name) : [...current, name]
  patch({ skills: next })
}
</script>

<style lang="scss">
.abele-agent-editor {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-3);
}

/**
 * The sections differ wildly in length — Delegation is one row, Access is three groups — so
 * the body scrolls on its own and the tab strip above it stays put.
 */
.abele-agent-editor__body {
  min-height: 16em;
  max-height: 60vh;
  overflow-y: auto;
  padding-right: var(--size-4-1);
}

.abele-agent-editor__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
  margin-top: var(--size-4-3);
}
</style>
