<template>
  <div class="abele-chat-settings">
    <Setting name="Hide reasoning" desc="Show only a spinner while the model is thinking.">
      <Checkbox :is-enabled="hideReasoning" @toggle="toggleHideReasoning" />
    </Setting>

    <Setting
      v-if="interceptorOptions.length"
      name="Interceptor"
      desc="Review messages before sending to the main AI."
    >
      <select
        class="dropdown"
        :value="activeInterceptorId"
        @change="setInterceptor(($event.target as HTMLSelectElement).value)"
      >
        <option value="">Off</option>
        <option v-for="opt in interceptorOptions" :key="opt.id" :value="opt.id">
          {{ opt.name }}
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

    <Setting
      v-if="activeInterceptorId"
      name="Interceptor context"
      desc="How much of the conversation the reviewer sees."
    >
      <select
        class="dropdown"
        :value="String(interceptorContextDepth)"
        @change="setInterceptorContextDepth(($event.target as HTMLSelectElement).value)"
      >
        <option value="0">Draft only</option>
        <option value="4">Last 4 messages</option>
        <option value="10">Last 10 messages</option>
        <option value="-1">Whole conversation</option>
      </select>
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
import { ref, computed } from 'vue'
import Setting from './obsidian/Setting.vue'
import Button from './obsidian/Button.vue'
import ConfirmModal from './obsidian/ConfirmModal.vue'
import Checkbox from './obsidian/Checkbox.vue'
import Search from './obsidian/Search.vue'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { AbeleConfig } from '@/services/AbeleConfig'
import Dropdown from './obsidian/Dropdown.vue'
import Icon from './obsidian/Icon.vue'

const emit = defineEmits<{ close: [] }>()

const session = computed(() => ChatService.getInstance().activeSession.value)

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

// Any agent may review a draft, utility ones included — that is what most of them are for.
const interceptorOptions = computed(() =>
  AgentRegistry.getInstance()
    .list({ includeUtility: true })
    .map((a) => ({ id: a.id, name: a.name }))
)
const activeInterceptorId = computed(() => session.value?.interceptor.agentId.value ?? '')
const interceptorContextDepth = computed(() => session.value?.interceptor.contextDepth.value ?? 0)

function setInterceptor(id: string) {
  const s = session.value
  if (!s) return
  s.interceptor.agentId.value = id
  s.save()
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
