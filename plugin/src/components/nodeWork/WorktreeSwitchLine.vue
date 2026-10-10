<template>
  <div class="abele-worktree-switch" role="note">
    <div class="abele-worktree-switch__line" />
    <span class="abele-worktree-switch__label">
      <Icon icon="git-branch" size="xs" :interactive="false" />
      <span>{{ by === 'agent' ? 'Agent moved to' : 'Moved to' }}</span>
      <span class="abele-worktree-switch__branch">{{ branch }}</span>
    </span>
    <div class="abele-worktree-switch__line" />
  </div>
</template>

<script setup lang="ts">
// A line in the chat where the work moved to another worktree, like a date divider: everything
// under it happened there.
import Icon from '../obsidian/Icon.vue'

defineProps<{ branch: string; by: 'agent' | 'you' }>()
</script>

<style lang="scss">
.abele-worktree-switch {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  margin: var(--size-4-3) 0;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-worktree-switch__line {
  flex: 1 1 auto;
  border-top: var(--border-width) solid var(--background-modifier-border);
}
.abele-worktree-switch__label {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-1);

  .abele-obsidian-icon {
    padding: 0;
  }
}
.abele-worktree-switch__branch {
  color: var(--text-normal);
  font-family: var(--font-monospace);
}
</style>
