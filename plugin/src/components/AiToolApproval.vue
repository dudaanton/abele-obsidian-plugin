<template>
  <div class="abele-tool-approval">
    <div class="abele-tool-approval__header">
      <Icon icon="shield-alert" />
      <span
        >Agent wants to execute <code>{{ request.toolName }}</code></span
      >
    </div>

    <pre class="abele-tool-approval__params">{{ JSON.stringify(request.args, null, 2) }}</pre>

    <div v-if="isEditing" class="abele-tool-approval__editor">
      <Input
        :model-value="editedArgs"
        as-text-area
        placeholder="Edit arguments (JSON)"
        @update:model-value="editedArgs = $event"
      />
    </div>

    <div class="abele-tool-approval__actions">
      <Button text="Approve" accent @click="approve" />
      <Button text="Edit" @click="toggleEdit" />
      <Button text="Reject" @click="reject" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import Icon from './obsidian/Icon.vue'
import Button from './obsidian/Button.vue'
import Input from './obsidian/Input.vue'
import type { ToolApprovalRequest } from '@/ai/types'

const props = defineProps<{
  request: ToolApprovalRequest
}>()

const isEditing = ref(false)
const editedArgs = ref(JSON.stringify(props.request.args, null, 2))

const approve = () => {
  if (isEditing.value) {
    try {
      const modified = JSON.parse(editedArgs.value)
      props.request.resolve({ approved: true, modifiedArgs: modified })
    } catch {
      // Invalid JSON, approve with original args
      props.request.resolve({ approved: true })
    }
  } else {
    props.request.resolve({ approved: true })
  }
}

const reject = () => {
  props.request.resolve({ approved: false, reason: 'User rejected this action' })
}

const toggleEdit = () => {
  isEditing.value = !isEditing.value
}
</script>

<style lang="scss">
.abele-tool-approval {
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-s);
  padding: var(--size-4-3);
  margin: var(--size-4-2) 0;
  background-color: var(--background-secondary);
}

.abele-tool-approval__header {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  margin-bottom: var(--size-4-2);
  color: var(--text-warning);
  font-weight: bold;

  code {
    color: var(--text-accent);
  }
}

.abele-tool-approval__params {
  font-size: var(--font-small);
  background-color: var(--background-primary);
  border-radius: var(--radius-s);
  padding: var(--size-4-2);
  overflow-x: auto;
  max-height: 200px;
  overflow-y: auto;
  margin-bottom: var(--size-4-2);
}

.abele-tool-approval__editor {
  margin-bottom: var(--size-4-2);

  textarea {
    width: 100%;
    min-height: 100px;
    font-family: var(--font-monospace);
    font-size: var(--font-small);
  }
}

.abele-tool-approval__actions {
  display: flex;
  gap: var(--size-4-2);
}
</style>
