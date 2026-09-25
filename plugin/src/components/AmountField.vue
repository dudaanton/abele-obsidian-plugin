<template>
  <div class="abele-amount-field">
    <ObsidianInput
      ref="input"
      class="abele-amount-field__input"
      :model-value="text"
      :placeholder="placeholder ?? '0.00'"
      inputmode="decimal"
      @update:model-value="onType"
      @blur="settle"
      @keydown.enter="settle"
    />
    <!-- mousedown is stopped so that pressing a key leaves the field focused and the phone's
         keyboard up. -->
    <div v-if="keys" class="abele-amount-field__keys" @mousedown.prevent>
      <ObsidianIcon
        v-for="key in KEYS"
        :key="key.label"
        :text-right="key.label"
        :tooltip="key.tooltip"
        with-bg
        @click="insert(key.insert)"
      />
    </div>
    <div v-if="hint" class="abele-amount-field__hint" :class="{ 'mod-error': invalid }">
      {{ hint }}
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * An amount that is also a calculator. `12.50 + 3×2` is worked out as it is typed, the answer
 * shown beneath, and written into the field when it is left. The operator keys are there for a
 * phone, whose number pad has none.
 */
import { computed, ref, watch } from 'vue'
import ObsidianInput from './obsidian/Input.vue'
import ObsidianIcon from './obsidian/Icon.vue'
import { evaluateAmount, isArithmetic } from '@/helpers/calculator'
import { formatAmount } from '@/helpers/moneyFormat'

const props = defineProps<{
  modelValue: number | null
  placeholder?: string
  /** Shows the operator keys. */
  keys?: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: number | null): void
}>()

const KEYS = [
  { label: '+', insert: ' + ', tooltip: 'Add' },
  { label: '−', insert: ' − ', tooltip: 'Subtract' },
  { label: '×', insert: ' × ', tooltip: 'Multiply' },
  { label: '÷', insert: ' ÷ ', tooltip: 'Divide' },
  { label: '(', insert: '(', tooltip: 'Open a bracket' },
  { label: ')', insert: ')', tooltip: 'Close a bracket' },
]

const shown = (value: number | null) => (value == null ? '' : String(value))

const input = ref<{ $el: HTMLInputElement } | null>(null)
const text = ref(shown(props.modelValue))

watch(
  () => props.modelValue,
  (value) => {
    // A value set from outside — the rate worked the other amount out — replaces the text; the
    // one this field emitted itself does not, or a sum being typed would collapse mid-way.
    if (evaluateAmount(text.value) !== value) text.value = shown(value)
  }
)

const value = computed(() => evaluateAmount(text.value))
const invalid = computed(() => text.value.trim() !== '' && value.value === null)

const hint = computed(() => {
  if (invalid.value) return 'Not a number or a sum'
  if (value.value !== null && isArithmetic(text.value)) return `= ${formatAmount(value.value)}`
  return ''
})

const onType = (next: string) => {
  text.value = next
  if (!next.trim()) emit('update:modelValue', null)
  else if (value.value !== null) emit('update:modelValue', value.value)
}

/** A sum that adds up is replaced by its answer. */
const settle = () => {
  if (value.value !== null && isArithmetic(text.value)) text.value = shown(value.value)
}

const insert = (piece: string) => {
  const el = input.value?.$el
  if (!el) return
  const start = el.selectionStart ?? el.value.length
  const end = el.selectionEnd ?? start
  const next = el.value.slice(0, start) + piece + el.value.slice(end)
  onType(next)
  el.value = next
  const at = start + piece.length
  el.setSelectionRange(at, at)
  el.focus()
}

defineExpose({ focus: () => input.value?.$el?.focus() })
</script>

<style lang="scss">
.abele-amount-field {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
  min-width: 0;
}

.abele-amount-field__input {
  font-variant-numeric: tabular-nums;
}

.abele-amount-field__keys {
  display: flex;
  flex-wrap: wrap;
  gap: var(--size-4-1);
}

/* A thumb needs keys the height of a field, spread across the row. */
body.is-phone .abele-amount-field__keys > .abele-obsidian-icon {
  flex: 1 1 0;
  justify-content: center;
  min-height: var(--input-height);
}

.abele-amount-field__hint {
  font-size: var(--font-ui-small);
  color: var(--text-muted);
  font-variant-numeric: tabular-nums;

  &.mod-error {
    color: var(--text-error);
  }
}
</style>
