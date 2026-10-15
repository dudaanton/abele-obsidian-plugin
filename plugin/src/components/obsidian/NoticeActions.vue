<template>
  <div class="abele-notice-actions__message">{{ text }}</div>
  <div v-if="actions.length" class="abele-notice-actions">
    <Button
      v-for="action in actions"
      :key="action.text"
      :text="action.text"
      :tooltip="action.tooltip"
      :accent="action.accent"
      @click="action.run()"
    />
  </div>
</template>

<script setup lang="ts">
// The inside of a notice with buttons — `noticeWithActions` renders it into the notice's message
// element. Flat and prop-only: it reads no store, so a notice the person clicks away takes it
// along with nothing left subscribed.
import Button from './Button.vue'
import type { NoticeAction } from './notice'

defineProps<{ text: string; actions: NoticeAction[] }>()
</script>

<style lang="scss">
.abele-notice-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-2);
  margin-top: var(--size-4-1);
}
</style>
