<template>
  <section class="abele-items" :aria-busy="state === 'loading'" :aria-label="title">
    <div v-if="title" class="tree-item-self abele-items__heading">
      <div class="tree-item-inner abele-items__title">{{ title }}</div>
      <div class="tree-item-flair-outer abele-items__side">
        <span v-if="count !== undefined && state === 'ready'" class="tree-item-flair">{{
          count
        }}</span>
        <a
          v-if="more && state === 'ready'"
          class="abele-items__more"
          href="#"
          @click.prevent="emit('more')"
          >{{ more }}</a
        >
        <slot name="actions" />
      </div>
    </div>
    <div v-if="state === 'loading'" class="search-empty-state abele-items__state" role="status">
      {{ loadingText }}
    </div>
    <div v-else-if="state === 'error'" class="search-empty-state abele-items__state" role="alert">
      <span>{{ errorText }}</span>
      <a href="#" class="abele-items__retry" @click.prevent="emit('retry')">Повторить</a>
    </div>
    <div v-else-if="state === 'empty'" class="search-empty-state abele-items__state" role="status">
      {{ emptyText }}
    </div>
    <div v-else class="abele-items__rows"><slot /></div>
  </section>
</template>

<script setup lang="ts">
// A titled list, the way Obsidian's Backlinks pane titles "Linked mentions": a heading row with
// the count beside it. Its text starts where the row titles start; row icons hang left of it.
// Loading, empty and failure replace the rows as one quiet line, so a
// broken source never multiplies into a broken row per object.
withDefaults(
  defineProps<{
    title?: string
    count?: number
    more?: string
    state?: 'ready' | 'loading' | 'empty' | 'error'
    loadingText?: string
    emptyText?: string
    errorText?: string
  }>(),
  {
    state: 'ready',
    loadingText: 'Загружаю…',
    emptyText: 'Здесь пока пусто',
    errorText: 'Не получилось загрузить.',
  }
)
const emit = defineEmits<{ more: []; retry: [] }>()
</script>

<style>
.abele-items + .abele-items {
  margin-top: var(--size-4-4);
}
.abele-items .abele-items__heading {
  padding-inline: var(--size-4-6) var(--size-4-2);
  align-items: baseline;
  color: var(--nav-heading-color);
}
.abele-items .abele-items__title {
  font-weight: var(--nav-heading-weight);
}
.abele-items__side {
  gap: var(--size-4-2);
  align-items: baseline;
}
.abele-items__more,
.abele-items__retry {
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);
  text-decoration: none;
}
.is-phone .abele-items__more,
.is-phone .abele-items__retry {
  display: inline-flex;
  align-items: center;
  min-height: var(--touch-size-m);
}
.abele-items__more:hover,
.abele-items__retry:hover {
  color: var(--text-accent);
}
.abele-items .abele-items__state {
  display: flex;
  gap: var(--size-4-2);
  margin: var(--size-4-1) 0 0;
  padding-block: var(--size-4-1);
  padding-inline-start: var(--size-4-6);
}
</style>
