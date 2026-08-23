<template>
  <ObsidianModal title="Chat Settings" @close="emit('close')">
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
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import Setting from './obsidian/Setting.vue'
import Checkbox from './obsidian/Checkbox.vue'
import Search from './obsidian/Search.vue'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'

const emit = defineEmits<{ close: [] }>()

const session = computed(() => ChatService.getInstance().activeSession.value)

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
