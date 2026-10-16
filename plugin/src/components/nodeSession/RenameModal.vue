<template>
  <!-- A new name for the session: one field, as Obsidian asks for a note's. -->
  <Modal title="Rename the session" close-in-footer phone-sheet @close="emit('close')">
    <Input v-model="name" class="abele-rename__field" @keydown.enter.prevent="confirm" />
    <template #footer>
      <Button text="Cancel" tooltip="Keep the name it has" @click="emit('close')" />
      <Button
        text="Rename"
        accent
        :disabled="!name.trim() || name.trim() === title"
        tooltip="Rename it here, in the node panel and in Agents"
        @click="confirm"
      />
    </template>
  </Modal>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Modal from '../obsidian/Modal.vue'
import Input from '../obsidian/Input.vue'
import Button from '../obsidian/Button.vue'

const props = defineProps<{ title: string }>()
const emit = defineEmits<{ close: []; rename: [title: string] }>()
const name = ref(props.title)

function confirm(): void {
  const next = name.value.trim()
  if (next && next !== props.title) emit('rename', next)
}
</script>

<style lang="scss">
.abele-rename__field {
  width: 100%;
}
</style>
