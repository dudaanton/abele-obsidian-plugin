<template>
  <span class="abele-label-dot" :class="color ? `abele-label-dot_${color}` : undefined"
    ><slot>{{ text }}</slot></span
  >
</template>

<script setup lang="ts">
/** A label as a quiet word with a dot of its colour: on a task, in a list, in the settings. */
defineProps<{ text?: string; color?: string }>()
</script>

<style lang="scss">
.abele-label-dot {
  white-space: nowrap;

  &::before {
    content: '';
    display: inline-block;
    width: var(--size-2-3);
    height: var(--size-2-3);
    margin-inline-end: var(--size-2-2);
    border-radius: 50%;
    vertical-align: middle;
    background-color: var(--abele-label-color, var(--text-faint));
  }
}

@each $name in red, orange, yellow, green, cyan, blue, purple, pink {
  .abele-label-dot_#{$name} {
    --abele-label-color: var(--color-#{$name});
  }
}
</style>
