<template>
  <div class="abele-chat-input">
    <div class="abele-chat-input__row">
      <textarea
        ref="inputEl"
        :value="text"
        class="abele-chat-input__textarea"
        placeholder="Message... (/prompt, /compact, /new, /scope)"
        rows="1"
        @input="onInput"
        @keydown="onKeydown"
      />
      <Icon v-if="isStreaming" icon="square" with-bg @click="emit('abort')" />
      <Icon
        v-else-if="canContinue && !text.trim()"
        icon="play"
        with-bg
        class="abele-chat-input__continue"
        @click="emit('continue')"
      />
      <Icon
        v-else
        icon="send-horizontal"
        with-bg
        :class="{ 'abele-chat-input__disabled': !text.trim() }"
        @click="send"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import Icon from './obsidian/Icon.vue'

const props = defineProps<{
  isStreaming: boolean
  canContinue: boolean
}>()

const emit = defineEmits<{
  (e: 'send', message: string): void
  (e: 'command', command: string): void
  (e: 'abort'): void
  (e: 'continue'): void
}>()

const TEXTAREA_MIN_HEIGHT = 34
const TEXTAREA_MAX_HEIGHT = 80

const text = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)

const autoResize = () => {
  const el = inputEl.value
  if (!el) return
  el.style.height = `${TEXTAREA_MIN_HEIGHT}px`
  el.style.height = `${Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)}px`
}

const onInput = (e: Event) => {
  text.value = (e.target as HTMLTextAreaElement).value
  nextTick(autoResize)
}

const send = () => {
  const msg = text.value.trim()
  if (!msg) return

  if (msg.startsWith('/')) {
    const cmd = msg.split(' ')[0].toLowerCase()
    if (['/compact', '/new', '/load', '/scope', '/prompt'].includes(cmd)) {
      emit('command', cmd)
      text.value = ''
      nextTick(autoResize)
      return
    }
  }

  emit('send', msg)
  text.value = ''
  nextTick(autoResize)
}

const setText = (value: string) => {
  text.value = value
  nextTick(autoResize)
}

defineExpose({ setText })

const onKeydown = (e: KeyboardEvent) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault()
    send()
  }
}
</script>

<style lang="scss">
.abele-chat-input {
  border-top: 1px solid var(--background-modifier-border);
  padding: var(--size-4-2);
  flex-shrink: 0;
}

.abele-chat-input__row {
  display: flex;
  align-items: flex-end;
  gap: var(--size-4-1);

  > .abele-obsidian-icon {
    flex-shrink: 0;
    height: 34px;
    width: 34px;
    box-sizing: border-box;
  }
}

.abele-chat-input__textarea {
  flex: 1;
  resize: none;
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  padding: 6px var(--size-4-2);
  font-family: inherit;
  font-size: inherit;
  line-height: 20px;
  background-color: var(--background-primary);
  color: var(--text-normal);
  height: 34px;
  min-height: 34px;
  max-height: 80px;
  overflow-y: auto;
  box-sizing: border-box;

  &:focus {
    border-color: var(--interactive-accent);
    outline: none;
  }
}

.abele-chat-input__continue {
  opacity: 0.5;

  &:hover {
    opacity: 1;
  }
}

.abele-chat-input__disabled {
  opacity: 0.3;
  pointer-events: none;
}
</style>
