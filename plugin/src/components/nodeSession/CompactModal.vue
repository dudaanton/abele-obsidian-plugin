<template>
  <!-- Asks the session to retell what was said so far and start again from the retelling: what
       to keep in focus, and what to send once it is done, so the work goes on by itself. -->
  <Modal title="Compact the context" close-in-footer phone-sheet @close="emit('close')">
    <p class="abele-compact__said">
      <template v-if="context">{{ used }} of {{ limit }} in the context now. </template>Everything
      said stays readable above the line.
    </p>
    <label class="abele-compact__field">
      <span class="setting-item-name">What to keep in focus</span>
      <textarea
        ref="focusEl"
        v-model="focus"
        rows="3"
        placeholder="The task and where it stopped"
      />
    </label>
    <Setting name="Continue afterwards" desc="Send this once compacting is done">
      <Checkbox :is-enabled="then" @toggle="then = !then" />
    </Setting>
    <Input v-if="then" v-model="next" class="abele-compact__next" />
    <template #footer>
      <Button text="Cancel" tooltip="Close this and change nothing" @click="emit('close')" />
      <Button
        text="Compact"
        accent
        tooltip="Retell the conversation and go on from the retelling"
        @click="confirm"
      />
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import Modal from '../obsidian/Modal.vue'
import Setting from '../obsidian/Setting.vue'
import Checkbox from '../obsidian/Checkbox.vue'
import Input from '../obsidian/Input.vue'
import Button from '../obsidian/Button.vue'
import { tokens, type ContextUse } from './types'

const props = defineProps<{
  context: ContextUse | null
  focus?: string
  /** What the session sends after compacting, as it is set now, and whether it does. */
  continuation?: string
  continues?: boolean
}>()
const emit = defineEmits<{ close: []; compact: [focus: string, then?: string] }>()

const focus = ref(props.focus ?? '')
const then = ref(props.continues ?? true)
const next = ref(props.continuation || 'Continue from where you stopped.')
const used = computed(() => (props.context ? tokens(props.context.used) : ''))
const limit = computed(() => (props.context ? tokens(props.context.limit) : ''))
const focusEl = ref<HTMLTextAreaElement>()
onMounted(() => focusEl.value?.focus())

function confirm(): void {
  emit(
    'compact',
    focus.value.trim(),
    then.value && next.value.trim() ? next.value.trim() : undefined
  )
}
</script>

<style lang="scss">
.abele-compact__said {
  margin: 0 0 var(--size-4-4);
  color: var(--text-muted);
}
.abele-compact__field {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);

  textarea {
    width: 100%;
    resize: vertical;
  }
}
.abele-compact__next {
  width: 100%;
}
</style>
