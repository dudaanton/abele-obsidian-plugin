<template>
  <section class="abele-section">
    <h3 v-if="title" class="abele-section__heading">{{ title }}</h3>
    <p v-if="desc || $slots.desc" class="abele-section__desc">
      <slot name="desc">{{ desc }}</slot>
    </p>
    <slot />
  </section>
</template>

<script setup lang="ts">
defineProps<{
  /** Omitted when the group already has a heading above it — a tab label, say. */
  title?: string
  /** Plain text. For a description carrying markup, fill the `desc` slot instead. */
  desc?: string
}>()
</script>

<style lang="scss">
.abele-section {
  margin-top: var(--size-4-8);

  &:first-child {
    margin-top: 0;
  }
}

.abele-section__heading {
  margin: 0 0 var(--size-4-2);
}

.abele-section__desc {
  margin: 0 0 var(--size-4-3);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
</style>
