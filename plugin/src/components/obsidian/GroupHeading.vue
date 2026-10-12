<template>
  <div class="abele-group-heading" :class="{ 'abele-group-heading_strong': strong }">
    <span class="abele-group-heading__label"
      ><slot name="label">{{ label }}</slot></span
    >
    <span v-if="$slots.default" class="abele-group-heading__summary"><slot /></span>
  </div>
</template>

<script setup lang="ts">
/**
 * The heading over a group of rows in a list: a day, a kind of account. Its name at the start
 * and what the group adds up to at the end, both a step quieter than the rows and a step bolder
 * than their facts, so the eye finds the groups first and the rows in them second. One heading for
 * every list, so a day in the timeline, in money and in time reads the same.
 */
defineProps<{
  label?: string
  /** The group that matters now, today: in the text colour rather than muted. */
  strong?: boolean
}>()
</script>

<style lang="scss">
.abele-group-heading {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--size-4-2);
  // In line with the words of the rows under it, which keep their own inset for the light.
  padding-inline: var(--size-2-3);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  font-weight: var(--font-semibold);

  &_strong {
    color: var(--text-normal);
  }
}

.abele-group-heading__label {
  min-width: 0;
  overflow-wrap: anywhere;
}

// Several totals — one per currency — each kept whole and wrapped when there is no room.
.abele-group-heading__summary {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  column-gap: var(--size-4-2);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
</style>
