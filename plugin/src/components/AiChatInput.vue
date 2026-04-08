<template>
  <div class="abele-chat-input">
    <!-- Pending attachments -->
    <div v-if="attachments.length" class="abele-chat-input__attachments">
      <div v-for="(a, i) in attachments" :key="a.path" class="abele-chat-input__attachment">
        <Icon :icon="getAttachmentIcon(a.path)" />
        <span class="abele-chat-input__attachment-name">{{ a.name }}</span>
        <Icon
          icon="x"
          class="abele-chat-input__attachment-remove"
          @click="attachments.splice(i, 1)"
        />
      </div>
    </div>

    <div class="abele-chat-input__row">
      <textarea
        ref="inputEl"
        :value="text"
        class="abele-chat-input__textarea"
        placeholder="Message... (/prompt, /compact, /new, /scope)"
        rows="1"
        @input="onInput"
        @keydown="onKeydown"
        @focus="emit('focus', true)"
        @blur="emit('focus', false)"
      />
      <Icon v-if="isStreaming" icon="square" with-bg @click="emit('abort')" />
      <Icon v-else-if="isBusy" icon="loader" no-hover class="abele-chat-input__spinner" />
      <template v-else>
        <Icon icon="paperclip" with-bg @click="showAttachMenu" />
        <Icon
          v-if="canContinue && !text.trim() && !attachments.length"
          icon="play"
          with-bg
          class="abele-chat-input__continue"
          @click="emit('continue')"
        />
        <Icon
          v-else
          icon="send-horizontal"
          with-bg
          :class="{ 'abele-chat-input__disabled': !text.trim() && !attachments.length }"
          @click="send"
        />
      </template>
    </div>

    <!-- Hidden file input for system picker -->
    <input
      ref="fileInputEl"
      type="file"
      multiple
      :accept="ALLOWED_ACCEPT"
      style="display: none"
      @change="onFileSelected"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, nextTick } from 'vue'
import { Menu, TFile, Notice } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import { GlobalStore } from '@/stores/GlobalStore'
import { pickVaultFile } from '@/helpers/suggesters/VaultFilePicker'
import { importExternalFile, getAttachmentIcon, ALLOWED_ACCEPT } from '@/ai/attachments'

const props = defineProps<{
  isStreaming: boolean
  isBusy: boolean
  canContinue: boolean
}>()

const emit = defineEmits<{
  (e: 'send', message: string, attachments: string[]): void
  (e: 'command', command: string): void
  (e: 'abort'): void
  (e: 'continue'): void
  (e: 'focus', focused: boolean): void
}>()

const TEXTAREA_MIN_HEIGHT = 34
const TEXTAREA_MAX_HEIGHT = 80

const text = ref('')
const inputEl = ref<HTMLTextAreaElement | null>(null)
const fileInputEl = ref<HTMLInputElement | null>(null)
const attachments = ref<TFile[]>([])

const autoResize = () => {
  const el = inputEl.value
  if (!el) return
  el.style.height = `${TEXTAREA_MIN_HEIGHT}px`
  const newHeight = Math.min(el.scrollHeight, TEXTAREA_MAX_HEIGHT)
  el.style.height = `${newHeight}px`
  el.style.overflowY = el.scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden'
}

const onInput = (e: Event) => {
  text.value = (e.target as HTMLTextAreaElement).value
  nextTick(autoResize)
}

const send = () => {
  if (props.isStreaming || props.isBusy) return
  const msg = text.value.trim()
  if (!msg && !attachments.value.length) return

  if (msg.startsWith('/')) {
    const cmd = msg.split(' ')[0].toLowerCase()
    if (['/compact', '/new', '/load', '/scope', '/prompt'].includes(cmd)) {
      emit('command', cmd)
    } else {
      emit('command', msg)
    }
    text.value = ''
    nextTick(autoResize)
    return
  }

  const paths = attachments.value.map((f) => f.path)
  emit('send', msg, paths)
  text.value = ''
  attachments.value = []
  nextTick(autoResize)
}

const showAttachMenu = (event: MouseEvent) => {
  const menu = new Menu()
  menu.addItem((item) => {
    item.setTitle('From vault').setIcon('vault').onClick(pickFromVault)
  })
  menu.addItem((item) => {
    item.setTitle('From disk').setIcon('hard-drive').onClick(pickFromDisk)
  })
  menu.showAtMouseEvent(event)
}

const pickFromVault = async () => {
  const { app } = GlobalStore.getInstance()
  const file = await pickVaultFile(app)
  if (file && !attachments.value.some((a) => a.path === file.path)) {
    attachments.value = [...attachments.value, file]
  }
}

const pickFromDisk = () => {
  fileInputEl.value?.click()
}

const onFileSelected = async (e: Event) => {
  const input = e.target as HTMLInputElement
  const files = input.files
  input.value = '' // reset for re-selection
  if (!files?.length) return

  for (const file of Array.from(files)) {
    try {
      const vaultFile = await importExternalFile(file)
      if (!attachments.value.some((a) => a.path === vaultFile.path)) {
        attachments.value = [...attachments.value, vaultFile]
      }
    } catch (err: unknown) {
      new Notice(`Failed to import ${file.name}: ${err instanceof Error ? err.message : err}`)
    }
  }
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

.abele-chat-input__attachments {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-2-2);
  margin-bottom: var(--size-4-1);
}

.abele-chat-input__attachment {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-2-1);
  padding: var(--size-2-1) var(--size-2-3);
  background-color: var(--background-secondary);
  border-radius: var(--radius-s);
  font-size: var(--font-smaller);
  color: var(--text-muted);
  max-width: 200px;

  .abele-obsidian-icon {
    flex-shrink: 0;
  }
}

.abele-chat-input__attachment-remove {
  margin-left: auto;
}

.abele-chat-input__attachment-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  padding: var(--size-2-3) var(--size-4-2);
  font-family: inherit;
  font-size: inherit;
  line-height: 1.5;
  background-color: var(--background-primary);
  color: var(--text-normal);
  height: 34px;
  min-height: 34px;
  max-height: 80px;
  overflow-y: hidden;
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

.abele-chat-input__spinner {
  animation: abele-spin 1s linear infinite;
  color: var(--text-muted);
}

@keyframes abele-spin {
  from {
    transform: rotate(0deg);
  }
  to {
    transform: rotate(360deg);
  }
}

.abele-chat-input__disabled {
  opacity: 0.3;
  pointer-events: none;
}
</style>
