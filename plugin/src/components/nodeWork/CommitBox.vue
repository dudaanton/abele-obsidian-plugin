<template>
  <!-- A commit of what is staged: its message, a summary and a body if it needs one, and the
       button. Enter starts a new line, ⌘ Enter commits. Not while a file is in conflict. -->
  <div ref="boxEl" class="abele-commit-box">
    <Input
      v-model="message"
      class="abele-commit-box__message"
      as-text-area
      :rows="1"
      placeholder="Message"
      aria-label="Commit message"
      :disabled="disabled"
      @keydown.enter.meta.prevent="commit"
      @keydown.enter.ctrl.prevent="commit"
    />
    <Button
      class="abele-commit-box__commit"
      text="Commit"
      icon="git-commit-horizontal"
      :disabled="disabled || !message.trim() || conflicts > 0"
      :tooltip="
        conflicts > 0
          ? 'Fix the files in conflict first'
          : `Commit the ${plural(staged, 'staged file')} · ⌘ Enter`
      "
      @click="commit"
    />
  </div>
</template>

<script setup lang="ts">
// The commit field over a worktree's changes, shown while something is staged.
import { nextTick, onMounted, ref, watch } from 'vue'
import Button from '../obsidian/Button.vue'
import Input from '../obsidian/Input.vue'
import { plural } from './codes'

const props = withDefaults(
  defineProps<{
    /** How many files are staged, for the button's tooltip. */
    staged: number
    /** Files in conflict; committing waits for them. */
    conflicts?: number
    /** Offline or busy: the field is shown but cannot be used. */
    disabled?: boolean
  }>(),
  { conflicts: 0, disabled: false }
)
const emit = defineEmits<{ (e: 'commit', message: string): void }>()

const message = ref('')
// A summary line, a blank one and a body, as git keeps it: the field grows with what it holds,
// wrapped lines too, up to six lines, and scrolls past that.
const boxEl = ref<HTMLElement>()
function fit() {
  const field = boxEl.value?.querySelector('textarea')
  if (!field) return
  const line = parseFloat(getComputedStyle(field).lineHeight) || 20
  field.setCssProps({ height: 'auto' })
  const most = line * 6 + field.offsetHeight - field.clientHeight + 12
  field.setCssProps({ height: `${Math.min(field.scrollHeight, most)}px` })
  field.parentElement?.classList.toggle('abele-commit-box__message_full', field.scrollHeight > most)
}
watch(message, () => void nextTick(fit))
onMounted(fit)
function commit() {
  if (props.disabled || !message.value.trim() || props.conflicts) return
  emit('commit', message.value.trim())
  message.value = ''
}
</script>

<style lang="scss">
.abele-commit-box {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}
// One line until there is more; no scroll bar until it is six lines tall.
.abele-commit-box__message textarea {
  overflow-y: hidden;
}
.abele-commit-box__message_full textarea {
  overflow-y: auto;
}
.abele-commit-box__commit {
  width: 100%;
}
</style>
