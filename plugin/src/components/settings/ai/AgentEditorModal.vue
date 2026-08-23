<template>
  <ObsidianModal :title="agent ? `Agent: ${agent.name}` : 'Agent'" @close="emit('close')">
    <div ref="root" class="abele-agent-editor" :class="{ 'abele-agent-editor_narrow': isNarrow }">
      <!-- Section nav. A column on the desktop; a list you descend into on a phone. -->
      <nav
        v-if="!isNarrow || !section"
        class="abele-agent-editor__nav"
        :class="{ 'abele-agent-editor__nav_narrow': isNarrow }"
      >
        <button
          v-for="s in SECTIONS"
          :key="s.id"
          class="abele-agent-editor__tab"
          :class="{ 'abele-agent-editor__tab_active': !isNarrow && section === s.id }"
          @click="section = s.id"
        >
          <span>{{ s.label }}</span>
          <Icon v-if="isNarrow" icon="chevron-right" />
        </button>
      </nav>

      <div v-if="agent && (!isNarrow || section)" class="abele-agent-editor__body">
        <button v-if="isNarrow" class="abele-agent-editor__back" @click="section = ''">
          <Icon icon="chevron-left" />
          <span>All sections</span>
        </button>

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
            desc="Hidden from the chat picker. Still available to scripts, delegation and draft review."
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
            desc="Offered as a retry when a request fails. Used automatically in delegated runs, where nobody can press a button."
          >
            <Dropdown
              :model-value="fallbackKey"
              :options="[{ value: '', display: 'None' }, ...modelOptions]"
              @update:model-value="selectFallback($event)"
            />
          </Setting>
        </template>

        <!-- Prompts -->
        <template v-else-if="section === 'prompts'">
          <p class="setting-item-description">
            Blocks are joined in order with a blank line between them. Use
            <code v-text="DATE_TOKEN" /> for today's date.
          </p>

          <div v-for="(prompt, idx) in agent.prompts" :key="idx" class="abele-agent-prompt">
            <div class="abele-agent-prompt__head">
              <Dropdown
                :model-value="prompt.type"
                :options="[
                  { value: 'text', display: 'Text' },
                  { value: 'note', display: 'Note' },
                ]"
                @update:model-value="setPromptType(idx, $event as 'text' | 'note')"
              />
              <div class="abele-agent-prompt__actions">
                <Icon
                  icon="chevron-up"
                  :class="{ 'abele-agent-prompt__action_disabled': idx === 0 }"
                  title="Move up"
                  @click="movePrompt(idx, -1)"
                />
                <Icon
                  icon="chevron-down"
                  :class="{
                    'abele-agent-prompt__action_disabled': idx === agent.prompts.length - 1,
                  }"
                  title="Move down"
                  @click="movePrompt(idx, 1)"
                />
                <Icon icon="trash" title="Remove" @click="removePrompt(idx)" />
              </div>
            </div>

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
          </div>

          <div v-if="!agent.prompts.length" class="abele-agent-editor__empty">
            No prompt blocks. This agent runs with no instructions of its own.
          </div>

          <div class="abele-agent-editor__row">
            <Button text="Add text block" @click="addPrompt('text')" />
            <Button text="Add note block" @click="addPrompt('note')" />
          </div>
        </template>

        <!-- Access -->
        <template v-else-if="section === 'access'">
          <Setting name="Permission mode" desc="What this agent may do without asking.">
            <Dropdown
              :model-value="agent.permissionMode"
              :options="PERMISSION_OPTIONS"
              @update:model-value="patch({ permissionMode: $event as PermissionMode })"
            />
          </Setting>

          <h4>Scope</h4>
          <p class="setting-item-description">
            Where this agent works by default. A delegated run also gets whatever the chat that
            delegated to it had open.
          </p>
          <AiScopeEditor
            :entries="agent.scope"
            :full-vault-access="agent.fullVaultAccess"
            @update:entries="patch({ scope: $event })"
            @update:full-vault-access="patch({ fullVaultAccess: $event })"
          />

          <h4>Tools</h4>
          <p class="setting-item-description">
            Off = unavailable. Ask = needs approval. Auto = runs on its own. File tools are always
            available and governed by the permission mode above.
          </p>
          <ToolModesEditor :tool-modes="agent.toolModes" hide-show-all @update="setToolMode" />
        </template>

        <!-- Skills -->
        <template v-else-if="section === 'skills'">
          <Setting name="Skills" desc="Which skills this agent can load on demand.">
            <Dropdown
              :model-value="agent.skillsMode"
              :options="[
                { value: 'all', display: 'All skills' },
                { value: 'none', display: 'No skills' },
                { value: 'selected', display: 'Only selected' },
              ]"
              @update:model-value="patch({ skillsMode: $event as SkillsMode })"
            />
          </Setting>

          <template v-if="agent.skillsMode === 'selected'">
            <div v-for="skill in skills" :key="skill.path">
              <Setting :name="skill.name" :desc="skill.description">
                <Checkbox
                  :is-enabled="agent.skills.includes(skill.name)"
                  @toggle="toggleSkill(skill.name)"
                />
              </Setting>
            </div>
            <div v-if="!skills.length" class="abele-agent-editor__empty">
              No skills in this vault. Skills are notes with <code>type: abele-skill</code>.
            </div>
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
              :options="[
                { value: '0', display: 'Cannot delegate' },
                { value: '1', display: '1 level' },
                { value: '2', display: '2 levels' },
                { value: '3', display: '3 levels' },
              ]"
              @update:model-value="patch({ maxDelegateDepth: Number($event) })"
            />
          </Setting>
        </template>
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue'
import { Platform } from 'obsidian'
import ObsidianModal from '../../obsidian/Modal.vue'
import Setting from '../../obsidian/Setting.vue'
import Input from '../../obsidian/Input.vue'
import Button from '../../obsidian/Button.vue'
import Checkbox from '../../obsidian/Checkbox.vue'
import Dropdown from '../../obsidian/Dropdown.vue'
import Search from '../../obsidian/Search.vue'
import Icon from '../../obsidian/Icon.vue'
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

/** Below this the nav and the section cannot sit side by side without squeezing both. */
const NARROW_WIDTH = 640

const SECTIONS = [
  { id: 'basic', label: 'Basic' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'access', label: 'Access' },
  { id: 'skills', label: 'Skills' },
  { id: 'delegation', label: 'Delegation' },
]

/** Written out in script: nested moustaches in the template confuse the Vue parser. */
const DATE_TOKEN = '{{date}}'

const PERMISSION_OPTIONS = [
  { value: 'confirm-all', display: 'Ask before every change' },
  { value: 'allow-edit', display: 'Edit files without asking' },
  { value: 'allow-all', display: 'Everything without asking' },
]

const registry = AgentRegistry.getInstance()
const config = AbeleConfig.getInstance()

/** The stored, reactive agent — edits reach open chats as they are typed. */
const agent = computed(() => registry.get(props.agentId))
const skills = computed(() => discoverSkills())

/** On a narrow screen the nav is a list you descend into, so no section is open at first. */
const isNarrow = ref(Platform.isMobile)
const section = ref(Platform.isMobile ? '' : 'basic')

const root = ref<HTMLElement | null>(null)
let observer: ResizeObserver | null = null

/**
 * Measures the element rather than a window.
 *
 * Since Obsidian 1.13 settings can live in their own window, and this component's `window` is
 * the main one — reading `window.innerWidth` here reports the wrong screen entirely. The
 * element's own width is also the honest question: the modal can be narrow in a wide window.
 */
function applyWidth(width: number): void {
  const narrow = Platform.isMobile || width < NARROW_WIDTH
  if (narrow === isNarrow.value) return

  isNarrow.value = narrow
  if (!narrow && !section.value) section.value = 'basic'
  if (narrow) section.value = ''
}

onMounted(() => {
  if (!root.value) return
  observer = new ResizeObserver((entries) => {
    const width = entries[0]?.contentRect.width
    if (width) applyWidth(width)
  })
  observer.observe(root.value)
  applyWidth(root.value.getBoundingClientRect().width)
})

onUnmounted(() => {
  observer?.disconnect()
  observer = null
})

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
  gap: var(--size-4-4);
  min-height: 24em;
  max-height: 70vh;
}

.abele-agent-editor_narrow {
  flex-direction: column;
  gap: 0;
  min-height: 0;
}

.abele-agent-editor__nav {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  flex: 0 0 10em;
  border-right: 1px solid var(--background-modifier-border);
  padding-right: var(--size-4-2);
}

.abele-agent-editor__nav_narrow {
  flex: 1 1 auto;
  border-right: none;
  padding-right: 0;
}

.abele-agent-editor__tab {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-1);
  width: 100%;
  padding: var(--size-4-1) var(--size-4-2);
  background: transparent;
  border: none;
  border-radius: var(--radius-s);
  box-shadow: none;
  color: var(--text-normal);
  cursor: pointer;
  text-align: left;

  &:hover {
    background: var(--background-modifier-hover);
  }
}

.abele-agent-editor__tab_active {
  background: var(--background-modifier-hover);
  font-weight: var(--font-medium);
}

.abele-agent-editor__body {
  flex: 1 1 auto;
  min-width: 0;
  overflow-y: auto;
  padding-right: var(--size-4-1);
}

.abele-agent-editor__back {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  margin-bottom: var(--size-4-2);
  padding: 0;
  background: transparent;
  border: none;
  box-shadow: none;
  color: var(--text-muted);
  cursor: pointer;
}

.abele-agent-editor__row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
  margin-top: var(--size-4-2);
}

.abele-agent-editor__empty {
  color: var(--text-muted);
  font-size: var(--font-small);
  padding: var(--size-4-2) 0;
}

.abele-agent-prompt {
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  padding: var(--size-4-2);
  margin-bottom: var(--size-4-2);
}

.abele-agent-prompt__head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-1);
}

.abele-agent-prompt__actions {
  display: flex;
  align-items: center;
  gap: var(--size-2-1);
}

.abele-agent-prompt__action_disabled {
  opacity: 0.3;
  pointer-events: none;
}

.abele-agent-editor__body textarea {
  width: 100%;
  min-height: 6em;
}

/**
 * The nav column leaves the body a few hundred pixels wide, which is narrower than Obsidian's
 * own settings pane. `.setting-item` is a nowrap row built for the full pane, so it is allowed
 * to wrap here — otherwise a long label and a dropdown push the modal sideways.
 */
.abele-agent-editor__body {
  .setting-item {
    flex-wrap: wrap;
    gap: var(--size-4-1);
    padding: var(--size-4-2) 0;
  }

  .setting-item-info {
    min-width: 0;
    margin-right: 0;
  }

  .setting-item-name,
  .setting-item-description {
    overflow-wrap: anywhere;
  }

  .setting-item-control {
    flex-wrap: wrap;
    justify-content: flex-start;
    min-width: 0;
    width: 100%;
  }

  // A select sized by its longest option ("Ask before every change") is wider than this
  // column, and a select does not shrink below its content on its own.
  .abele-obsidian-dropdown,
  .abele-obsidian-search {
    min-width: 0;
    width: 100%;
  }

  select,
  .dropdown,
  input[type='text'] {
    max-width: 100%;
    width: 100%;
    text-overflow: ellipsis;
  }
}
</style>
