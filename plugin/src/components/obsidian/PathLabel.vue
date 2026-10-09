<template>
  <details v-if="mode !== 'full'" class="abele-path-label">
    <summary>
      <span v-if="workspace">{{ workspace }} · </span>{{ compact
      }}<span v-if="missing"> · Unavailable</span>
    </summary>
    <div class="abele-path-label__full">{{ path }}</div>
    <div class="abele-path-label__actions">
      <Icon v-if="copyable" icon="copy" tooltip="Copy full path" @click="emit('copy', path)" />
      <Icon
        v-if="revealable"
        icon="folder"
        tooltip="Reveal in file explorer"
        :disabled="missing"
        disabled-reason="Target unavailable"
        @click="emit('reveal', path)"
      />
    </div>
  </details>
  <span v-else class="abele-path-label"
    ><span v-if="workspace">{{ workspace }} · </span
    ><span class="abele-path-label__full">{{ path }}</span
    ><span v-if="missing"> · Unavailable</span></span
  >
</template>
<script setup lang="ts">
import { computed } from 'vue'
import Icon from './Icon.vue'
const props = withDefaults(
  defineProps<{
    path: string
    mode?: 'basename' | 'context' | 'full'
    workspace?: string
    missing?: boolean
    copyable?: boolean
    revealable?: boolean
  }>(),
  { mode: 'context' }
)
const emit = defineEmits<{ copy: [path: string]; reveal: [path: string] }>()
const compact = computed(() => {
  // Preserve remote syntax: a Windows path is not silently rewritten to a vault path.
  const index = Math.max(props.path.lastIndexOf('/'), props.path.lastIndexOf('\\'))
  return props.mode === 'basename'
    ? props.path.slice(index + 1) || props.path
    : index < 0
      ? 'Vault root'
      : props.path.slice(0, index) || props.path.slice(0, 1)
})
</script>
<style>
.abele-path-label {
  min-width: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  overflow-wrap: anywhere;
}
.abele-path-label > summary {
  cursor: var(--cursor-link);
}
.abele-path-label__full {
  user-select: text;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.abele-path-label__actions {
  display: flex;
  gap: var(--size-4-1);
}
</style>
