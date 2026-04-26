<template>
  <ObsidianModal title="Chat System Prompt" @close="emit('close')">
    <div class="abele-system-prompt-settings">
      <div class="abele-system-prompt-settings__option">
        <label>
          <input type="radio" :checked="mode === 'default'" @change="setMode('default')" />
          Use global default
        </label>
      </div>

      <div class="abele-system-prompt-settings__option">
        <label>
          <input type="radio" :checked="mode === 'note'" @change="setMode('note')" />
          From vault note
        </label>
        <Search
          v-if="mode === 'note'"
          :model-value="notePath"
          placeholder="Path to note..."
          :suggester="FileSuggest"
          @update:model-value="updateNotePath"
        />
      </div>

      <div class="abele-system-prompt-settings__option">
        <label>
          <input type="radio" :checked="mode === 'custom'" @change="setMode('custom')" />
          Custom for this chat
        </label>
        <textarea
          v-if="mode === 'custom'"
          class="abele-system-prompt-settings__textarea"
          :value="customText"
          placeholder="Enter system prompt..."
          @input="updateCustomText(($event.target as HTMLTextAreaElement).value)"
        />
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import Search from './obsidian/Search.vue'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import { AgentService } from '@/ai/AgentService'

const emit = defineEmits<{ close: [] }>()

const agentService = AgentService.getInstance()
const session = computed(() => agentService.activeSession.value)

type Mode = 'default' | 'note' | 'custom'

const mode = ref<Mode>(
  session.value?.customSystemPromptNotePath.value
    ? 'note'
    : session.value?.customSystemPrompt.value
      ? 'custom'
      : 'default'
)
const notePath = ref(session.value?.customSystemPromptNotePath.value ?? '')
const customText = ref(session.value?.customSystemPrompt.value ?? '')

function setMode(m: Mode) {
  const s = session.value
  if (!s) return
  mode.value = m
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
.abele-system-prompt-settings {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 8px 0;
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
