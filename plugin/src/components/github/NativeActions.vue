<template>
  <Section title="Conversation actions">
    <Input
      v-model="body"
      as-text-area
      :rows="3"
      aria-label="Comment"
      placeholder="Write a comment"
      :disabled="busy || uncertain"
    />
    <div class="modal-button-container">
      <Button
        text="Comment"
        tooltip="Post this comment to the service"
        :disabled="busy || uncertain || !body.trim()"
        @click="comment"
      />
      <Button
        v-if="pull && open && head"
        text="Merge"
        tooltip="Review and confirm merging this exact pull request head"
        :disabled="busy || uncertain"
        @click="confirming = true"
      />
    </div>
    <p v-if="pull" class="setting-item-description">
      Threaded review replies are not available for this service API. Use Open in browser for those
      conversations.
    </p>
    <p v-if="error" role="alert">{{ error }}</p>
    <ConfirmModal
      v-if="confirming"
      title="Merge pull request"
      :message="`Merge pull request #${number} at ${head}? The branch will be kept.`"
      confirm-text="Merge"
      confirm-tooltip="Merge this exact head without deleting its branch"
      @close="confirming = false"
      @confirm="merge"
    />
  </Section>
</template>
<script setup lang="ts">
import { ref, onBeforeUnmount } from 'vue'
import Section from '../obsidian/Section.vue'
import Input from '../obsidian/Input.vue'
import Button from '../obsidian/Button.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
import { ForgejoUnknownWrite } from '@/forge/forgejoClient'
const props = defineProps<{
  writer: {
    comment(index: number, body: string): Promise<void>
    merge(index: number, head: string): Promise<void>
  }
  number: number
  head?: string
  open: boolean
  pull: boolean
}>()
const emit = defineEmits<{ (e: 'refresh'): void }>()
const body = ref(''),
  error = ref(''),
  busy = ref(false),
  confirming = ref(false),
  uncertain = ref(false)
let active = true
onBeforeUnmount(() => {
  active = false
})
async function send(operation: () => Promise<void>, clear: boolean) {
  if (busy.value || uncertain.value) return
  busy.value = true
  error.value = ''
  try {
    await operation()
    if (active) {
      if (clear) body.value = ''
      emit('refresh')
    }
  } catch (problem) {
    if (active) {
      error.value = problem instanceof Error ? problem.message : String(problem)
      uncertain.value = problem instanceof ForgejoUnknownWrite
    }
  } finally {
    if (active) busy.value = false
  }
}
const comment = () => send(() => props.writer.comment(props.number, body.value), true)
const merge = () => {
  confirming.value = false
  return send(() => props.writer.merge(props.number, props.head), false)
}
</script>
