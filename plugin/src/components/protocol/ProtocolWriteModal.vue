<template>
  <ObsidianModal title="Write to a note?" size="wide" @close="emit('close')">
    <div class="abele-protocol-write">
      <p>
        A link asks to
        {{ write.creates ? 'create' : write.mode === 'replace' ? 'replace' : 'add text to' }} this
        note:
      </p>
      <code class="abele-protocol-write__path">{{ write.path }}</code>
      <details v-if="write.current !== null && write.mode === 'replace'">
        <summary>Current contents</summary>
        <pre>{{ write.current }}</pre>
      </details>
      <p>Contents after this change:</p>
      <pre>{{ write.content }}</pre>
    </div>
    <template #footer>
      <Button text="Cancel" tooltip="Close without writing" @click="emit('close')" />
      <Button
        :text="write.mode === 'replace' ? 'Replace note' : 'Add to note'"
        :warning="write.mode === 'replace'"
        tooltip="Write the contents shown into this note"
        @click="accept"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import ObsidianModal from '../obsidian/Modal.vue'
import Button from '../obsidian/Button.vue'
import type { ProtocolWrite } from '@/helpers/protocolWrite'
defineProps<{ write: ProtocolWrite }>()
const emit = defineEmits<{ (e: 'confirm'): void; (e: 'close'): void }>()
function accept(): void {
  emit('confirm')
  emit('close')
}
</script>

<style scoped>
.abele-protocol-write {
  min-width: 0;
}
.abele-protocol-write__path,
.abele-protocol-write pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
</style>
