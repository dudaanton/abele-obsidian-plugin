<template>
  <section class="abele-section">
    <h3 class="abele-section__heading">{{ title }}</h3>
    <p v-if="desc" class="abele-section__desc">{{ desc }}</p>
    <slot />
  </section>
</template>

<script setup lang="ts">
defineProps<{
  title: string
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
