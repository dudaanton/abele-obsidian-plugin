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
import { ref, watch } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import Search from './obsidian/Search.vue'
import { FileSuggest } from '@/helpers/suggesters/FileSuggester'
import { AgentService } from '@/ai/AgentService'

const emit = defineEmits<{ close: [] }>()

const agent = AgentService.getInstance()

type Mode = 'default' | 'note' | 'custom'

const mode = ref<Mode>(
  agent.customSystemPromptNotePath.value
    ? 'note'
    : agent.customSystemPrompt.value
      ? 'custom'
      : 'default'
)
const notePath = ref(agent.customSystemPromptNotePath.value)
const customText = ref(agent.customSystemPrompt.value)

function setMode(m: Mode) {
  mode.value = m
  if (m === 'default') {
    agent.customSystemPrompt.value = ''
    agent.customSystemPromptNotePath.value = ''
  } else if (m === 'note') {
    agent.customSystemPrompt.value = ''
  } else if (m === 'custom') {
    agent.customSystemPromptNotePath.value = ''
  }
  agent.saveCurrentChat()
}

function updateNotePath(value: string) {
  notePath.value = value
  agent.customSystemPromptNotePath.value = value
  agent.saveCurrentChat()
}

function updateCustomText(value: string) {
  customText.value = value
  agent.customSystemPrompt.value = value
  agent.saveCurrentChat()
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
