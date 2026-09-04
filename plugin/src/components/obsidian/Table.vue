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
          :tabindex="clickable ? 0 : undefined"
          @click="click($event, row, index)"
          @keydown.enter="press($event, row, index)"
          @keydown.space="press($event, row, index)"
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
 * A row stays a row: it is reachable from the keyboard when it is clickable, but it is not
 * given `role="button"` — that would take a row out of the table for anyone reading it with
 * a screen reader, which is the one thing a table is for.
 */
const props = defineProps<{
  columns: { key: string; label: string }[]
  rows: Record<string, unknown>[]
  /** Makes each row a target: hovered, reachable from the keyboard, and reported on click. */
  clickable?: boolean
}>()

const emit = defineEmits<{
  (e: 'rowClick', row: Record<string, unknown>, index: number): void
}>()

/**
 * What a cell may hold that is pressed in its own right. A key or a click that started in
 * one of these is that control's — Space in a field is a space — and not the row being
 * chosen as well. The walk stops at the row, so a button the whole table sits inside does
 * not count.
 */
const INTERACTIVE = 'button, a, input, select, textarea, [role="button"], [contenteditable]'

const fromControl = (event: Event): boolean => {
  let el = event.target as Element | null
  while (el && el !== event.currentTarget) {
    if (el.matches?.(INTERACTIVE)) return true
    el = el.parentElement
  }
  return false
}

const click = (event: MouseEvent, row: Record<string, unknown>, index: number) => {
  if (!props.clickable || fromControl(event)) return
  emit('rowClick', row, index)
}

/**
 * Enter and Space, the two keys that press a thing.
 *
 * The default is only prevented for a row that is a target — Space scrolls the page, and
 * taking that away from a table nobody can click would be taking away the way through it.
 */
const press = (event: KeyboardEvent, row: Record<string, unknown>, index: number) => {
  if (!props.clickable || fromControl(event)) return
  event.preventDefault()
  emit('rowClick', row, index)
}

/**
 * A cell the caller does not fill, written out.
 *
 * This is what makes the component safe to point at data whose shape nobody has checked, and
 * every branch of it is a thing a script has handed a table: a date reads as a date rather
 * than as a quoted ISO string, a list reads as its items, and anything left is JSON — behind
 * a `try`, because a vault file knows its folder and that folder knows the file back, and one
 * circular row would otherwise take the whole view down.
 */
const text = (value: unknown): string => {
  if (value === undefined || value === null) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return String(value)
  }
  if (value instanceof Date) return value.toLocaleString()
  if (Array.isArray(value)) return (value as unknown[]).map(text).join(', ')
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value) ?? ''
    } catch {
      return '[object]'
    }
  }
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
