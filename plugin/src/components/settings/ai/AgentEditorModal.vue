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

          <Setting
            name="Background model"
            desc="For naming and compacting this agent's chats. Unset, the plugin-wide Background
              Model setting decides — and unset there too, the chat's own model does."
          >
            <Dropdown
              :model-value="backgroundKey"
              :options="[{ value: '', display: 'Follow the setting' }, ...modelOptions]"
              @update:model-value="selectBackground($event)"
            />
          </Setting>

          <Setting
            name="Interceptor"
            desc="Sees each message in this agent's chats before the agent does. An agent reads it
              and says what it thinks; a script decides what becomes of it. A chat can pick
              another one or turn it off."
          >
            <Dropdown
              :model-value="interceptorKey"
              :options="interceptorOptions"
              @update:model-value="selectInterceptor($event)"
            />
          </Setting>

          <template v-if="interceptorKey">
            <Setting
              name="Only messages matching"
              desc="A regular expression, bare or as /pattern/flags. Other messages go straight
                to the agent. Empty means every message."
            >
              <Input
                :model-value="patternText"
                placeholder="^/todo"
                @update:model-value="typePattern($event)"
              />
            </Setting>
            <p v-if="patternProblem" class="setting-item-description mod-warning">
              Not saved: {{ patternProblem }}
            </p>
          </template>

          <Setting
            v-if="interceptorKey"
            name="Reply only"
            desc="Send messages unchanged straight to the main agent. The interceptor may answer beside
              each message, without holding it, rewriting it or deciding tool approvals."
          >
            <Checkbox
              :is-enabled="agent.interceptorReplyOnly ?? false"
              @toggle="patch({ interceptorReplyOnly: !agent.interceptorReplyOnly })"
            />
          </Setting>

          <Setting
            v-if="agent.interceptorAgentId && !agent.interceptorScript"
            name="Interceptor context"
            desc="How much of the conversation the interceptor sees."
          >
            <Dropdown
              :model-value="String(agent.interceptorContextDepth ?? 0)"
              :options="CONTEXT_OPTIONS"
              @update:model-value="patch({ interceptorContextDepth: Number($event) })"
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

        <!-- Memory -->
        <AgentMemoryEditor
          v-else-if="section === 'memory'"
          :agent-id="agentId"
          @changed="persist()"
        />

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
            <ToolModesEditor
              :tool-modes="agent.toolModes"
              hide-show-all
              @update="setToolMode"
              @update-many="setToolModes"
            />
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
import AgentMemoryEditor from './AgentMemoryEditor.vue'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import { discoverSkills } from '@/ai/tools/SkillTool'
import { INTERCEPTOR_CONTEXT_OPTIONS, type AgentDefinition } from '@/ai/agents/types'
import { interceptorScripts } from '@/ai/interceptor/runScript'
import { patternError } from '@/ai/interceptor/pattern'
import type { PermissionMode, ToolMode } from '@/ai/types'

type SkillsMode = AgentDefinition['skillsMode']

const props = defineProps<{ agentId: string }>()
const emit = defineEmits<{ close: []; changed: [] }>()

const SECTIONS = [
  { id: 'basic', label: 'Basic' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'memory', label: 'Memory' },
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

/** Shared with the chat's own picker, so both offer the same four. */
const CONTEXT_OPTIONS = INTERCEPTOR_CONTEXT_OPTIONS

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
 * Every other agent, utility ones included — reviewing is what most of them are for. Not this
 * one: an agent reviewing its own drafts is a loop with extra steps. A reviewer that was
 * deleted is not offered, so the picker shows "No review", which is what the chat will do.
 */
const interceptorOptions = computed(() => {
  const chosen = agent.value?.interceptorScript
  const scripts = interceptorScripts().map((s) => s.meta.name)
  // A script chosen before it was renamed or deleted is still shown as what is chosen, so the
  // picker does not claim "No review" while every message is going to a missing script.
  if (chosen && !scripts.includes(chosen)) scripts.push(chosen)
  return [
    { value: '', display: 'No review' },
    ...registry
      .list({ includeUtility: true })
      .filter((a) => a.id !== props.agentId)
      .map((a) => ({ value: a.id, display: a.utility ? `${a.name} · utility` : a.name })),
    ...scripts.map((name) => ({
      value: `${SCRIPT_KEY}${name}`,
      display: `Script: ${name}${interceptorScripts().some((s) => s.meta.name === name) ? '' : ' · missing'}`,
    })),
  ]
})

/** A script's option is its name after this; agent ids never contain a colon. */
const SCRIPT_KEY = 'script:'

const interceptorKey = computed(() => {
  const a = agent.value
  if (!a) return ''
  if (a.interceptorScript) return `${SCRIPT_KEY}${a.interceptorScript}`
  return a.interceptorAgentId ?? ''
})

function selectInterceptor(key: string): void {
  if (key.startsWith(SCRIPT_KEY)) {
    patch({ interceptorScript: key.slice(SCRIPT_KEY.length), interceptorAgentId: '' })
  } else {
    patch({ interceptorAgentId: key, interceptorScript: '' })
  }
}

/** What is typed, kept here while it does not compile; the agent keeps its last good one. */
const typedPattern = ref<string | null>(null)
const patternText = computed(() => typedPattern.value ?? agent.value?.interceptorPattern ?? '')
const patternProblem = computed(() =>
  typedPattern.value === null ? null : patternError(typedPattern.value)
)

function typePattern(text: string): void {
  typedPattern.value = text
  if (!patternError(text)) patch({ interceptorPattern: text })
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
</style>
