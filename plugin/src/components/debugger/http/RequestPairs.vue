<template>
  <!-- Names and values in two columns, as a note's properties: a check to leave a line out
       without losing it, the remove glyph shown on pointing, and an empty line at the end to add
       one more. A key of the plugin is said by its name, never its value. -->
  <div class="abele-http-pairs" role="table" :aria-label="label">
    <div
      v-for="(pair, i) in pairs"
      :key="i"
      class="abele-http-pairs__row"
      :class="{
        'abele-http-pairs__row_off': pair.off,
        'abele-http-pairs__row_missing': pair.missing,
      }"
      role="row"
    >
      <input
        type="checkbox"
        class="abele-http-pairs__on"
        :checked="!pair.off"
        :aria-label="pair.off ? `Send ${pair.key}` : `Leave ${pair.key} out`"
        @change="emit('change', i, { ...pair, off: !pair.off })"
      />
      <input
        type="text"
        class="abele-http-pairs__key"
        :value="pair.key"
        :aria-label="`Name of line ${i + 1}`"
        spellcheck="false"
        @change="emit('change', i, { ...pair, key: ($event.target as HTMLInputElement).value })"
      />
      <span
        v-if="pair.secret"
        ref="secretEls"
        class="abele-http-pairs__value abele-http-pairs__secret"
        :data-missing="pair.missing"
        ><Icon icon="key-round" size="xs" no-hover />{{ keyName(pair.value) }}</span
      >
      <input
        v-else
        type="text"
        class="abele-http-pairs__value"
        :value="pair.value"
        :aria-label="`Value of ${pair.key}`"
        :aria-invalid="pair.missing ? 'true' : undefined"
        spellcheck="false"
        @change="emit('change', i, { ...pair, value: ($event.target as HTMLInputElement).value })"
      />
      <Icon
        class="abele-http-pairs__remove"
        icon="x"
        size="xs"
        :tooltip="`Remove ${pair.key}`"
        @click="emit('remove', i)"
      />
    </div>
    <div class="abele-http-pairs__row abele-http-pairs__row_new" role="row">
      <span class="abele-http-pairs__spacer" />
      <input
        type="text"
        class="abele-http-pairs__key"
        :placeholder="adding"
        :aria-label="adding"
        spellcheck="false"
        @change="add"
      />
      <span />
      <span class="abele-http-pairs__spacer" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUpdated, ref } from 'vue'
import { setTooltip } from 'obsidian'
import Icon from '../../obsidian/Icon.vue'
import type { HttpPair } from './types'

defineProps<{
  pairs: HttpPair[]
  /** The table in words: `Headers`. */
  label: string
  /** The empty last line's placeholder: `Add a header`. */
  adding: string
}>()
const emit = defineEmits<{
  (e: 'change', index: number, pair: HttpPair): void
  (e: 'remove', index: number): void
  (e: 'add', pair: HttpPair): void
}>()

const keyName = (value: string) => /\$\{abele_key:([^}]+)\}/.exec(value)?.[1] ?? value
function add(event: Event) {
  const input = event.target as HTMLInputElement
  if (!input.value.trim()) return
  emit('add', { key: input.value.trim(), value: '' })
  input.value = ''
}

// A key's tooltip says where it comes from, or which one is missing.
const secretEls = ref<HTMLElement[]>([])
const tips = () => {
  for (const el of secretEls.value)
    setTooltip(
      el,
      el.dataset.missing ?? 'From the keys of the plugin, by name; the node gets it for one send'
    )
}
onMounted(tips)
onUpdated(tips)
</script>

<style lang="scss">
.abele-http-pairs {
  display: flex;
  flex-direction: column;
}

.abele-http-pairs__row {
  display: grid;
  grid-template-columns: auto minmax(6em, 10em) minmax(0, 1fr) auto;
  align-items: center;
  gap: var(--size-4-2);
  padding: var(--size-2-1) var(--size-2-3);
  border-radius: var(--radius-s);

  &:hover {
    background-color: var(--background-modifier-hover);
  }

  // As a note's properties: the fields stand on the row, their frame only while typing.
  input.abele-http-pairs__on {
    margin: 0;
  }
  input:not([type='checkbox']) {
    min-width: 0;
    height: auto;
    padding: var(--size-2-1) var(--size-2-2);
    border: none;
    background: transparent;
    font-family: var(--font-monospace);
    font-size: var(--font-ui-small);
    color: var(--text-normal);

    &:focus {
      box-shadow: var(--input-shadow);
      background-color: var(--background-modifier-form-field);
    }
  }
}

.abele-http-pairs__key {
  color: var(--text-muted) !important;
}

.abele-http-pairs__secret {
  display: inline-flex;
  align-items: center;
  gap: var(--size-2-2);
  min-width: 0;
  padding: var(--size-2-1) var(--size-2-2);
  font-family: var(--font-monospace);
  font-size: var(--font-ui-small);
  color: var(--text-muted);

  .abele-obsidian-icon {
    height: auto;
    padding: 0;
    color: var(--text-faint);
  }
}

.abele-http-pairs__row_off {
  .abele-http-pairs__key,
  .abele-http-pairs__value {
    color: var(--text-faint) !important;
    text-decoration: line-through;
  }
}

// A value that cannot be sent as it is: said in red, the reason in its tooltip.
.abele-http-pairs__row_missing .abele-http-pairs__value,
.abele-http-pairs__row_missing .abele-http-pairs__secret .abele-obsidian-icon {
  color: var(--text-error) !important;
}

.abele-http-pairs__remove {
  visibility: hidden;
}
.abele-http-pairs__row:hover .abele-http-pairs__remove,
.abele-http-pairs__row:focus-within .abele-http-pairs__remove,
.is-mobile .abele-http-pairs__remove {
  visibility: visible;
}

// On a phone the value goes under its name: side by side neither had room to be read.
.is-phone .abele-http-pairs__row {
  grid-template-columns: auto minmax(0, 1fr) auto;
  grid-template-areas: 'on key remove' '. value .';
  row-gap: 0;

  > :nth-child(1) {
    grid-area: on;
  }
  > :nth-child(2) {
    grid-area: key;
  }
  > :nth-child(3) {
    grid-area: value;
  }
  > :nth-child(4) {
    grid-area: remove;
  }
}
.is-phone .abele-http-pairs__row_new {
  grid-template-areas: 'on key remove';
}

.abele-http-pairs__row_new:hover {
  background: none;
}

// Where the check stands on the empty line, so the name under it starts with the others.
.abele-http-pairs__spacer {
  width: var(--checkbox-size);
}
</style>
