<template>
  <!-- The one deliberate horizontal scroller: a table cannot be made narrower than its
       columns, so it scrolls within itself rather than dragging the view sideways. -->
  <div class="abele-table__scroll">
    <table class="abele-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column.key" class="abele-table__head">
            {{ column.label }}
          </th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="(row, index) in rows"
          :key="index"
          class="abele-table__row"
          :class="{ 'abele-table__row_clickable': clickable }"
          :role="clickable ? 'button' : undefined"
          :tabindex="clickable ? 0 : undefined"
          @click="clickable && emit('rowClick', row, index)"
          @keydown.enter.prevent="clickable && emit('rowClick', row, index)"
        >
          <td v-for="column in columns" :key="column.key" class="abele-table__cell">
            <slot name="cell" :value="row[column.key]" :row="row" :column="column">{{
              text(row[column.key])
            }}</slot>
          </td>
        </tr>
      </tbody>
    </table>
  </div>
</template>

<script setup lang="ts">
/**
 * Columns and rows, with a `cell` slot for anything richer than text.
 *
 * A cell the caller does not fill is written out here, which is what makes the component safe
 * to point at data whose shape nobody has checked: a number and a boolean read as themselves,
 * an absent value leaves the cell empty rather than saying "undefined", and a list or a nested
 * map is written as JSON rather than as `[object Object]`.
 */
defineProps<{
  columns: { key: string; label: string }[]
  rows: Record<string, unknown>[]
  /** Makes each row a target: hovered, reachable from the keyboard, and reported on click. */
  clickable?: boolean
}>()

const emit = defineEmits<{
  (e: 'rowClick', row: Record<string, unknown>, index: number): void
}>()

const text = (value: unknown): string => {
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  // Narrowed positively rather than by exclusion: `String` on an unknown is the call that
  // produces `[object Object]`, and the type checker is what stops it being written by mistake.
  if (value !== null && typeof value === 'object') return JSON.stringify(value)
  return ''
}
</script>

<style lang="scss">
/** Deliberate, and the one element allowed it: see the note in the template. */
.abele-table__scroll {
  overflow-x: auto;
}

.abele-table {
  width: 100%;
  border-collapse: collapse;
}

.abele-table__head,
.abele-table__cell {
  padding: var(--size-4-1) var(--size-4-2);
  text-align: left;
  border-bottom: 1px solid var(--background-modifier-border);
  vertical-align: top;
}

.abele-table__head {
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
  font-weight: var(--font-semibold);
}

.abele-table__row_clickable {
  cursor: var(--cursor-link);

  &:hover {
    background-color: var(--background-modifier-hover);
  }
}
</style>
