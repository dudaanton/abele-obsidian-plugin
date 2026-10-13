<template>
  <!-- By how often each is changed: the model, the prompt, the interceptor, then the rest. -->
  <div class="abele-chat-settings">
    <Setting name="Model" desc="The one this chat answers with.">
      <AgentOverrideNotice field="modelId" compact />
      <Dropdown
        :model-value="modelKey"
        :options="modelOptions"
        @update:model-value="selectModel($event)"
      />
    </Setting>
    <Setting name="System prompt" desc="The global one, a note, or words for this chat only.">
      <Dropdown
        :model-value="promptMode"
        :options="promptModes"
        @update:model-value="setPromptMode($event as PromptMode)"
      />
    </Setting>
    <Setting v-if="promptMode === 'note'" name="Note" desc="Read the system prompt from this note.">
      <Search
        :model-value="notePath"
        label="System prompt note"
        placeholder="Path to note..."
        :suggester="FileSuggest"
        @update:model-value="updateNotePath"
      />
    </Setting>
    <Setting v-if="promptMode === 'custom'" name="Prompt" desc="Only this chat uses this text.">
      <Input
        :model-value="customText"
        as-text-area
        aria-label="System prompt for this chat"
        placeholder="Enter system prompt..."
        @update:model-value="updateCustomText"
      />
    </Setting>
    <InterceptorSettings
      :model-value="interceptorKey"
      :options="interceptorOptions"
      :desc="interceptorDesc"
      :active="interceptorActive"
      :agent-active="!!activeInterceptorId && !activeScript"
      :pattern="session?.interceptor.pattern.value ?? ''"
      :reply-only="session?.interceptor.replyOnly.value ?? false"
      :context-depth="session?.interceptor.contextDepth.value ?? 0"
      @update:model-value="setInterceptor"
      @update:pattern="setInterceptorPattern"
      @update:reply-only="setInterceptorReplyOnly"
      @update:context-depth="setInterceptorContextDepth"
    />
    <Setting name="Hide reasoning" desc="Show only a spinner while the model is thinking.">
      <Checkbox :is-enabled="hideReasoning" @toggle="toggleHideReasoning" />
    </Setting>
    <!-- Only for a chat that has reached into a node's repository. -->
    <Setting
      v-if="hasNodeAccess"
      name="Node repository access"
      desc="Revoke this chat's repository read grants. Later reads require a new owner approval."
    >
      <Button
        text="Revoke repository access"
        tooltip="Require new owner approval for repository reads"
        @click="revokeNodeReads"
      />
    </Setting>
  </div>
</template>

<script setup lang="ts">
import { nodeRepositoryToolsHost } from '@/ai/tools/node'
import { revokeObsidianChatNodeApproval } from '@/ai/tools/node/owner'
import { ref, computed } from 'vue'
import Setting from './obsidian/Setting.vue'
import Button from './obsidian/Button.vue'
import Checkbox from './obsidian/Checkbox.vue'
import Search from './obsidian/Search.vue'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { interceptorScripts } from '@/ai/interceptor/runScript'
import InterceptorSettings from './settings/ai/InterceptorSettings.vue'
import { interceptorChoices, SCRIPT_KEY } from './settings/ai/options'
import AgentOverrideNotice from './AgentOverrideNotice.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import Dropdown from './obsidian/Dropdown.vue'
import Input from './obsidian/Input.vue'

defineEmits<{ close: [] }>()

const session = computed(() => ChatService.getInstance().activeSession.value)
function revokeNodeReads() {
  const current = session.value
  if (!current) return
  nodeRepositoryToolsHost.revokeAll(current)
  void revokeObsidianChatNodeApproval(current).catch((error) =>
    console.error('[Abele] Node scope revocation failed', error)
  )
}

/** The chat has been given a node: only then is there repository access to take back. */
const hasNodeAccess = computed(() => {
  const scope = session.value?.overrides?.value.nodeScope
  return Array.isArray(scope) && scope.length > 0
})

// ── Model override ──

const modelOptions = computed(() => {
  const opts: { value: string; display: string }[] = []
  for (const provider of AbeleConfig.getInstance().ai.providers) {
    for (const model of provider.models) {
      opts.push({ value: `${provider.id}::${model.id}`, display: model.name || model.id })
    }
  }
  return opts
})

const modelKey = computed(() => {
  const s = session.value
  if (!s) return ''
  return s.activeModelId.value ? `${s.activeProviderId.value}::${s.activeModelId.value}` : ''
})

function selectModel(key: string) {
  const s = session.value
  if (!s) return
  const [providerId, modelId] = key.split('::')
  s.activeProviderId.value = providerId || ''
  s.activeModelId.value = modelId || ''
  s.save()
}

// ── Interceptor ──

// Any agent may review a draft, utility ones included — that is what most of them are for —
// and any script marked `@interceptor` may decide about one.
const interceptorOptions = computed(() => [
  { value: FOLLOW_AGENT, display: agentDefaultLabel.value },
  { value: '', display: 'Off' },
  ...interceptorChoices(
    AgentRegistry.getInstance().list({ includeUtility: true }),
    interceptorScripts().map((script) => script.meta.name),
    session.value?.interceptor.script.value
  ),
])
const activeInterceptorId = computed(() => session.value?.interceptor.agentId.value ?? '')
const activeScript = computed(() => session.value?.interceptor.script.value ?? '')
const interceptorActive = computed(() => !!(activeInterceptorId.value || activeScript.value))

function setInterceptorPattern(text: string) {
  const s = session.value
  if (!s) return
  s.interceptor.pattern.value = text
  void s.save()
}

function setInterceptorReplyOnly(value: boolean) {
  const s = session.value
  if (!s) return
  s.interceptor.replyOnly.value = value
  void s.save()
}

/** Not an agent id — nanoid never produces a colon — so it cannot collide with one. */
const FOLLOW_AGENT = ':agent'

const followsAgent = computed(() => session.value?.interceptor.followsAgent ?? true)
const interceptorKey = computed(() => {
  if (followsAgent.value) return FOLLOW_AGENT
  return activeScript.value ? `${SCRIPT_KEY}${activeScript.value}` : activeInterceptorId.value
})

/** Names what "the agent's" means right now, so following it is not a blind choice. */
const agentDefaultLabel = computed(() => {
  const choice = session.value?.interceptor.agentDefault.value
  const id = choice?.agentId ?? ''
  const name = choice?.script
    ? `script ${choice.script}`
    : id
      ? AgentRegistry.getInstance().get(id)?.name
      : ''
  return `Agent default (${name || 'off'})`
})

const interceptorDesc = computed(() =>
  followsAgent.value
    ? "Reviews messages. Follows the agent's choice."
    : "Reviews messages. Chosen for this chat; the agent's choice no longer applies here."
)

function setInterceptor(value: string) {
  const s = session.value
  if (!s) return
  if (value === FOLLOW_AGENT) s.interceptor.followAgent()
  else if (value.startsWith(SCRIPT_KEY)) s.interceptor.script.value = value.slice(SCRIPT_KEY.length)
  else {
    s.interceptor.script.value = ''
    s.interceptor.agentId.value = value
  }
  void s.save()
}

function setInterceptorContextDepth(value: number) {
  const s = session.value
  if (!s) return
  s.interceptor.contextDepth.value = Number(value)
  s.save()
}

// ── Hide reasoning ──

const hideReasoning = computed(() => session.value?.hideReasoning.value ?? false)

const toggleHideReasoning = () => {
  if (session.value) {
    session.value.hideReasoning.value = !session.value.hideReasoning.value
  }
}

// ── System prompt ──

type PromptMode = 'default' | 'note' | 'custom'
const promptModes = [
  { value: 'default', display: 'Use global default' },
  { value: 'note', display: 'From vault note' },
  { value: 'custom', display: 'Custom for this chat' },
]

const promptMode = ref<PromptMode>(
  session.value?.customSystemPromptNotePath.value
    ? 'note'
    : session.value?.customSystemPrompt.value
      ? 'custom'
      : 'default'
)
const notePath = ref(session.value?.customSystemPromptNotePath.value ?? '')
const customText = ref(session.value?.customSystemPrompt.value ?? '')

function setPromptMode(m: PromptMode) {
  const s = session.value
  if (!s) return
  promptMode.value = m
  if (m === 'default') {
    s.customSystemPrompt.value = ''
    s.customSystemPromptNotePath.value = ''
  } else if (m === 'note') {
    s.customSystemPrompt.value = ''
  } else if (m === 'custom') {
    s.customSystemPromptNotePath.value = ''
  }
  s.save()
}

function updateNotePath(value: string) {
  const s = session.value
  if (!s) return
  notePath.value = value
  s.customSystemPromptNotePath.value = value
  s.save()
}

function updateCustomText(value: string) {
  const s = session.value
  if (!s) return
  customText.value = value
  s.customSystemPrompt.value = value
  s.save()
}
</script>

<style lang="scss">
.abele-chat-settings {
  padding: var(--size-4-2) 0;
}
</style>
