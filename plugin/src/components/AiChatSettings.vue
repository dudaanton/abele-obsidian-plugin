<template>
  <div class="abele-chat-settings">
    <Setting
      name="Node repository access"
      desc="Revoke this chat's repository read grants. Later reads require a new owner approval."
    >
      <Button
        text="Revoke repository access"
        tooltip="Require new owner approval for repository reads"
        @click="revokeNodeReads"
      />
    </Setting>
    <Setting name="Hide reasoning" desc="Show only a spinner while the model is thinking.">
      <Checkbox :is-enabled="hideReasoning" @toggle="toggleHideReasoning" />
    </Setting>

    <Setting v-if="interceptorOptions.length" name="Interceptor" :desc="interceptorDesc">
      <select
        class="dropdown"
        :value="interceptorKey"
        @change="setInterceptor(($event.target as HTMLSelectElement).value)"
      >
        <option :value="FOLLOW_AGENT">{{ agentDefaultLabel }}</option>
        <option value="">Off</option>
        <option v-for="opt in interceptorOptions" :key="opt.id" :value="opt.id">
          {{ opt.name }}
        </option>
      </select>
    </Setting>

    <template v-if="interceptorActive">
      <Setting
        name="Only messages matching"
        desc="A regular expression, bare or as /pattern/flags. Other messages go straight to the agent."
      >
        <Input
          :model-value="patternText"
          placeholder="Every message"
          @update:model-value="typePattern($event)"
        />
      </Setting>
      <p v-if="patternProblem" class="setting-item-description mod-warning">
        Not saved: {{ patternProblem }}
      </p>
    </template>

    <Setting
      v-if="interceptorActive"
      name="Reply only"
      desc="Send messages unchanged straight to the main agent. The interceptor may answer beside
        each message, without holding it, rewriting it or deciding tool approvals."
    >
      <Checkbox :is-enabled="interceptorReplyOnly" @toggle="toggleInterceptorReplyOnly" />
    </Setting>

    <Setting
      v-if="activeInterceptorId && !activeScript"
      name="Interceptor context"
      desc="How much of the conversation the reviewer sees."
    >
      <select
        class="dropdown"
        :value="String(interceptorContextDepth)"
        @change="setInterceptorContextDepth(($event.target as HTMLSelectElement).value)"
      >
        <option v-for="opt in INTERCEPTOR_CONTEXT_OPTIONS" :key="opt.value" :value="opt.value">
          {{ opt.display }}
        </option>
      </select>
    </Setting>

    <Setting name="Model" :desc="modelDesc">
      <div class="abele-chat-settings__override">
        <Dropdown
          :model-value="modelKey"
          :options="modelOptions"
          @update:model-value="selectModel($event)"
        />
        <Icon
          v-if="modelOverridden"
          icon="rotate-ccw"
          title="Back to the agent's model"
          @click="resetModel"
        />
      </div>
    </Setting>

    <h4 style="margin: var(--size-4-3) 0 var(--size-4-1)">System Prompt</h4>

    <div class="abele-system-prompt-settings">
      <div class="abele-system-prompt-settings__option">
        <label>
          <input
            type="radio"
            :checked="promptMode === 'default'"
            @change="setPromptMode('default')"
          />
          Use global default
        </label>
      </div>

      <div class="abele-system-prompt-settings__option">
        <label>
          <input type="radio" :checked="promptMode === 'note'" @change="setPromptMode('note')" />
          From vault note
        </label>
        <Search
          v-if="promptMode === 'note'"
          :model-value="notePath"
          placeholder="Path to note..."
          :suggester="FileSuggest"
          @update:model-value="updateNotePath"
        />
      </div>

      <div class="abele-system-prompt-settings__option">
        <label>
          <input
            type="radio"
            :checked="promptMode === 'custom'"
            @change="setPromptMode('custom')"
          />
          Custom for this chat
        </label>
        <textarea
          v-if="promptMode === 'custom'"
          class="abele-system-prompt-settings__textarea"
          :value="customText"
          placeholder="Enter system prompt..."
          @input="updateCustomText(($event.target as HTMLTextAreaElement).value)"
        />
      </div>
    </div>

    <!-- Last, and on its own: everything above changes how this chat behaves and can be
           changed back. This one ends it. -->
    <Setting
      name="Delete chat"
      desc="Remove this conversation, its delegated runs and its place in the history."
    >
      <!-- "Delete", not "Delete chat": the row beside it already says what goes. -->
      <Button
        text="Delete"
        warning
        :disabled="!savedToFile"
        :tooltip="
          savedToFile
            ? 'Delete this conversation for good'
            : 'Nothing has been written to this chat yet'
        "
        @click="pendingRemoval = true"
      />
    </Setting>

    <ConfirmModal
      v-if="pendingRemoval"
      title="Delete chat"
      message="Delete this chat? Its file, the runs it delegated and its entry in the history
        all go. This cannot be undone."
      confirm-tooltip="Delete this chat"
      @confirm="remove"
      @close="pendingRemoval = false"
    />
  </div>
</template>

<script setup lang="ts">
import { nodeRepositoryToolsHost } from '@/ai/tools/node'
import { ref, computed } from 'vue'
import Setting from './obsidian/Setting.vue'
import Button from './obsidian/Button.vue'
import ConfirmModal from './obsidian/ConfirmModal.vue'
import Checkbox from './obsidian/Checkbox.vue'
import Search from './obsidian/Search.vue'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { INTERCEPTOR_CONTEXT_OPTIONS } from '@/ai/agents/types'
import { interceptorScripts } from '@/ai/interceptor/runScript'
import { patternError } from '@/ai/interceptor/pattern'
import Input from './obsidian/Input.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import Dropdown from './obsidian/Dropdown.vue'
import Icon from './obsidian/Icon.vue'

const emit = defineEmits<{ close: [] }>()

const session = computed(() => ChatService.getInstance().activeSession.value)
function revokeNodeReads() {
  if (session.value) nodeRepositoryToolsHost.revokeAll(session.value)
}

// ── Deleting this chat ──

const pendingRemoval = ref(false)

/** A tab nobody has written to has no file yet, and no file is nothing to throw away. */
const savedToFile = computed(() => !!session.value?.currentChatFile.value)

/**
 * The dialog closes behind it either way: what it was showing the settings of is gone, and a
 * refusal — a tab that turned out to have no file — has already been said by the dark button.
 */
const remove = () =>
  void (async () => {
    const current = session.value
    if (!current) return

    await ChatService.getInstance().deleteChat(current.id)
    emit('close')
  })()

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

const modelOverridden = computed(() => session.value?.isOverridden('modelId') ?? false)

const modelDesc = computed(() =>
  modelOverridden.value
    ? "Overridden for this chat. The agent's own model no longer applies here."
    : `From the agent. Changing it here affects only this chat.`
)

function selectModel(key: string) {
  const s = session.value
  if (!s) return
  const [providerId, modelId] = key.split('::')
  s.activeProviderId.value = providerId || ''
  s.activeModelId.value = modelId || ''
  s.save()
}

function resetModel() {
  const s = session.value
  if (!s) return
  s.clearOverride('providerId')
  s.clearOverride('modelId')
  s.save()
}

// ── Interceptor ──

/** A script's option is its name after this; agent ids never contain a colon. */
const SCRIPT_KEY = 'script:'

// Any agent may review a draft, utility ones included — that is what most of them are for —
// and any script marked `@interceptor` may decide about one.
const interceptorOptions = computed(() => {
  const known = interceptorScripts().map((s) => s.meta.name)
  const scripts = [...known]
  // A script chosen before it was renamed or deleted still shows, said to be missing, as the
  // agent editor says it: every message is going to it and failing over to the agent.
  const chosen = session.value?.interceptor.script.value
  if (chosen && !scripts.includes(chosen)) scripts.push(chosen)
  return [
    ...AgentRegistry.getInstance()
      .list({ includeUtility: true })
      .map((a) => ({ id: a.id, name: a.name })),
    ...scripts.map((name) => ({
      id: `${SCRIPT_KEY}${name}`,
      name: `Script: ${name}${known.includes(name) ? '' : ' · missing'}`,
    })),
  ]
})
const activeInterceptorId = computed(() => session.value?.interceptor.agentId.value ?? '')
const activeScript = computed(() => session.value?.interceptor.script.value ?? '')
const interceptorActive = computed(() => !!(activeInterceptorId.value || activeScript.value))

/** What is typed, kept here while it does not compile; the chat keeps its last good one. */
const typedPattern = ref<string | null>(null)
const patternText = computed(
  () => typedPattern.value ?? session.value?.interceptor.pattern.value ?? ''
)
const patternProblem = computed(() =>
  typedPattern.value === null ? null : patternError(typedPattern.value)
)

function typePattern(text: string) {
  typedPattern.value = text
  const s = session.value
  if (!s || patternError(text)) return
  s.interceptor.pattern.value = text
  void s.save()
}
const interceptorContextDepth = computed(() => session.value?.interceptor.contextDepth.value ?? 0)
const interceptorReplyOnly = computed(() => session.value?.interceptor.replyOnly.value ?? false)

function toggleInterceptorReplyOnly() {
  const s = session.value
  if (!s) return
  s.interceptor.replyOnly.value = !s.interceptor.replyOnly.value
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
  typedPattern.value = null
  void s.save()
}

function setInterceptorContextDepth(value: string) {
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
.abele-chat-settings__override {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  min-width: 0;
}

.abele-chat-settings {
  padding: 8px 0;
}

.abele-system-prompt-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.abele-system-prompt-settings__option {
  display: flex;
  flex-direction: column;
  gap: 6px;

  label {
    display: flex;
    align-items: center;
    gap: 8px;
    cursor: pointer;
  }

  input[type='radio'] {
    margin: 0;
  }
}

.abele-system-prompt-settings__textarea {
  width: 100%;
  min-height: 120px;
  padding: 8px;
  font-size: var(--font-ui-small);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  background: var(--background-primary);
  color: var(--text-normal);
  resize: vertical;

  &::placeholder {
    color: var(--text-faint);
  }
}
</style>
