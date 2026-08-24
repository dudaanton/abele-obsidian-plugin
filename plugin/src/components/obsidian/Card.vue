<template>
  <div
    class="abele-card"
    :class="{ 'abele-card_clickable': clickable }"
    :role="clickable ? 'button' : undefined"
    :tabindex="clickable ? 0 : undefined"
    @click="clickable && emit('click')"
    @keydown.enter.prevent="clickable && emit('click')"
  >
    <div class="abele-card__head">
      <div class="abele-card__title">
        <span class="abele-card__name">{{ title }}</span>
        <slot name="badges" />
      </div>
      <!-- Actions sit inside a clickable card, so their clicks must not also open it. -->
      <div v-if="$slots.actions" class="abele-card__actions" @click.stop @keydown.enter.stop>
        <slot name="actions" />
      </div>
    </div>

    <div v-if="subtitle" class="abele-card__subtitle">{{ subtitle }}</div>
    <div v-if="description" class="abele-card__description">{{ description }}</div>

    <div v-if="meta?.length" class="abele-card__meta">
      <span v-for="entry in meta" :key="entry">{{ entry }}</span>
    </div>

    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  /** A secondary identifier — a model id, a path. Rendered in the monospace face. */
  subtitle?: string
  description?: string
  /** Short facts about the item, shown as one faint row. */
  meta?: string[]
  clickable?: boolean
}>()

const emit = defineEmits<{
  (e: 'click'): void
}>()
</script>

<style lang="scss">
.abele-card {
  display: flex;
  flex-direction: column;
  gap: var(--size-2-1);
  min-width: 0;
  padding: var(--size-4-3);
  border: 1px solid var(--background-modifier-border);
  border-radius: var(--radius-m);
}

.abele-card_clickable {
  cursor: var(--cursor-link);
  transition: border-color 0.15s;

  &:hover {
    border-color: var(--interactive-accent);
  }
}

.abele-card__head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--size-4-2);
  min-width: 0;
}

.abele-card__title {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--size-2-2);
  min-width: 0;
}

.abele-card__name {
  font-weight: var(--font-semibold);
  font-size: var(--font-ui-small);
  overflow-wrap: anywhere;
}

.abele-card__actions {
  display: flex;
  align-items: center;
  gap: var(--size-2-1);
  flex: 0 0 auto;
}

.abele-card__subtitle {
  font-family: var(--font-monospace);
  font-size: var(--font-smallest);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.abele-card__description {
  font-size: var(--font-small);
  color: var(--text-muted);
  overflow-wrap: anywhere;
}

.abele-card__meta {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-2-1) var(--size-4-2);
  margin-top: var(--size-2-1);
  font-size: var(--font-smallest);
  color: var(--text-faint);
}
</style>
