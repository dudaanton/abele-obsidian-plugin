<template>
  <Icon
    class="abele-parent-link"
    icon="corner-left-up"
    :text-right="title"
    :tooltip="`Started by ${title}. Open it`"
    @click="emit('open')"
  />
</template>

<script setup lang="ts">
// Where a session came from: the one that started it, a press away, at the end of the line that
// says where it works.
import Icon from '../obsidian/Icon.vue'

defineProps<{ title: string }>()
const emit = defineEmits<{ open: [] }>()
</script>

<style lang="scss">
.abele-parent-link {
  min-width: 0;
  // The worktree beside it says where the work is; this gives way first when the line is short.
  flex: 0 4 auto;
  margin-inline-start: auto;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);

  .abele-obsidian-icon__text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
