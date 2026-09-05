<template>
  <ObsidianModal title="Chat" size="tall" @close="emit('close')">
    <div class="abele-chat-setup">
      <Tabs :tabs="tabs" :model-value="tab" @update:model-value="tab = $event" />

      <div class="abele-chat-setup__body">
        <AiScopeManager v-if="tab === 'scope'" />

        <AiSkillPromptPicker
          v-else-if="tab === 'skills'"
          kind="skills"
          @skill="onSkill"
          @close="emit('close')"
        />

        <AiSkillPromptPicker
          v-else-if="tab === 'prompts'"
          kind="prompts"
          @prompt="onPrompt"
          @close="emit('close')"
        />

        <AiPermissions v-else-if="tab === 'permissions'" />

        <AiChatSettings v-else-if="tab === 'settings'" @close="emit('close')" />

        <div v-else class="abele-chat-setup__tools">
          <Setting
            name="Reload from disk"
            desc="Read this conversation again from its file — after a sync, or an edit made
              outside the app."
          >
            <Button text="Reload" tooltip="Read this chat from its file again" @click="reload" />
          </Setting>

          <Setting
            name="Debug data"
            desc="Copy what this chat is made of — the agent, the model, the scope, the
              messages — to the clipboard and the console."
          >
            <Button text="Copy" tooltip="Copy this chat's debug data" @click="debug" />
          </Setting>
        </div>
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
/**
 * Everything a chat can be set up with, in one dialog.
 *
 * These were six controls in two places: three glyphs in the composer's toolbar (scope, skills
 * and prompts, permissions) and three more in the header (settings, reload, debug). Each opened
 * a dialog of its own, and telling them apart meant learning six glyphs — «должны быть под
 * одной кнопкой в агенте в одной модалке в виде табов».
 *
 * The bodies are the same components as before with their own frames taken off, so nothing
 * about scope, skills, permissions or the chat's settings is reimplemented here. What this adds
 * is the frame, the strip and the last tab, which holds the two actions that are not settings
 * at all: reading the file again, and copying what the chat is made of.
 */
import { ref } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import Tabs, { type Tab } from './obsidian/Tabs.vue'
import Setting from './obsidian/Setting.vue'
import Button from './obsidian/Button.vue'
import AiScopeManager from './AiScopeManager.vue'
import AiSkillPromptPicker from './AiSkillPromptPicker.vue'
import AiPermissions from './AiPermissions.vue'
import AiChatSettings from './AiChatSettings.vue'
import type { TFile } from 'obsidian'

const props = withDefaults(defineProps<{ open?: string }>(), { open: 'scope' })

const emit = defineEmits<{
  (e: 'close'): void
  /** A skill was picked: its name goes into the composer as a command. */
  (e: 'skill', name: string): void
  /** A prompt was picked: the chat fills its variables and applies it. */
  (e: 'prompt', file: TFile): void
  (e: 'reload'): void
  (e: 'debug'): void
}>()

/**
 * Which tab is showing. It opens where the caller asked — the scope badge in the composer
 * leads to the scope, `/prompt` to the prompts — so that a way in that used to be its own
 * dialog still lands on the thing it was about.
 */
const tab = ref(props.open)

/**
 * Words, not glyphs. The kit offers an icon for a strip whose labels are too short to explain
 * themselves; these are plain words that do, and six of them plus six icons is a strip that
 * wraps onto a second row at the width this dialog opens at. The tooltip carries the rest.
 */
const tabs: Tab[] = [
  { id: 'scope', label: 'Scope', tooltip: 'What this chat may read and write' },
  { id: 'skills', label: 'Skills', tooltip: 'Skills this chat can be given' },
  { id: 'prompts', label: 'Prompts', tooltip: 'Prompts to start from' },
  { id: 'permissions', label: 'Tools', tooltip: 'Which tools may run without asking' },
  { id: 'settings', label: 'Settings', tooltip: 'How this chat behaves' },
  { id: 'tools', label: 'Debug', tooltip: 'Reload this chat, or copy what it is made of' },
]

const onSkill = (name: string) => emit('skill', name)
const onPrompt = (file: TFile) => emit('prompt', file)

const reload = () => {
  emit('reload')
  emit('close')
}

const debug = () => {
  emit('debug')
  emit('close')
}
</script>

<style lang="scss">
.abele-chat-setup {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  gap: var(--size-4-2);
}

/**
 * The one thing that scrolls. The dialog is a column capped at the height it is allowed, so a
 * long list of tools or prompts moves inside it rather than growing it past the screen.
 *
 * The padding is room for a focus ring: a scrolling box clips whatever reaches past its edge,
 * and a field's ring reaches past the field on every side. Pulled back by the same margin so
 * the content stands where it did.
 */
.abele-chat-setup__body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--size-2-2);
  margin: calc(-1 * var(--size-2-2));
}

.abele-chat-setup__tools {
  display: flex;
  flex-direction: column;
}
</style>
