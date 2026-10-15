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
  // Totals that do not fit beside the name go under it as a whole, rather than squeezing the
  // name onto two lines.
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  column-gap: var(--size-4-2);
  row-gap: var(--size-2-1);
  // In line with the words of the rows under it, which keep their own inset for the light.
  padding-inline: var(--size-2-3);
  // As far from its first row as the rows are from each other, so every row reads as the
  // heading's and not just the first.
  margin-bottom: var(--size-4-2);
  // A step smaller than the rows, muted and a little heavier, as Apple's and Linear's section
  // headings are: told from the rows at a glance, without the bold line at their own size that
  // fought them for the eye.
  color: var(--abele-text-heading-color);
  font-size: var(--abele-text-heading-size);
  font-weight: var(--abele-text-heading-weight);

  // In a window, in line with the window's text, as the rows under it are there.
  .modal-content & {
    padding-inline: 0;
  }

  &_strong {
    color: var(--abele-text-title-color);
  }
}

.abele-group-heading__label {
  min-width: 0;
  overflow-wrap: anywhere;
}

// Several totals — one per currency — each kept whole and wrapped when there is no room: beside
// the name when they fit, otherwise on a line of their own, still at the right edge.
.abele-group-heading__summary {
  flex: 1 1 auto;
  // What the group adds up to is a fact, not the heading: in the heading's size, not its weight.
  color: var(--abele-text-count-color);
  font-weight: var(--font-normal);
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  column-gap: var(--size-4-2);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
</style>
