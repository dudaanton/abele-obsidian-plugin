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

    <AgentOverrideNotice field="modelId" from-agent="Model comes from this chat's agent." />
    <Setting name="Model" desc="Changing it here affects only this chat.">
      <Dropdown
        :model-value="modelKey"
        :options="modelOptions"
        @update:model-value="selectModel($event)"
      />
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
import { interceptorScripts } from '@/ai/interceptor/runScript'
import InterceptorSettings from './settings/ai/InterceptorSettings.vue'
import { interceptorChoices, SCRIPT_KEY } from './settings/ai/options'
import AgentOverrideNotice from './AgentOverrideNotice.vue'
import { AbeleConfig } from '@/services/AbeleConfig'
import Dropdown from './obsidian/Dropdown.vue'

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
