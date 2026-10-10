<template>
  <div
    class="abele-obsidian-input"
    :class="[
      rootClass,
      {
      'abele-obsidian-input_multiline': asTextArea,
      'abele-obsidian-input_sized': asTextArea && rows !== undefined,
      'abele-obsidian-input_leading': hasLeading,
      'abele-obsidian-input_trailing': hasTrailing,
      'abele-obsidian-input_invalid': invalid,
      'abele-obsidian-input_disabled': disabled,
        'abele-obsidian-input_loading': loading,
      },
    ]"
    :style="[rootStyle, trailingWidth ? { '--abele-input-trailing-width': `${trailingWidth}px` } : {}]"
  >
    <span v-if="hasLeading" class="abele-obsidian-input__leading">
      <slot name="leading">
        <span ref="leadingIcon" class="abele-obsidian-input__leading-icon" aria-hidden="true" />
      </slot>
    </span>
    <component
      :is="asTextArea ? 'textarea' : 'input'"
      ref="base"
      v-bind="baseAttrs"
      class="abele-obsidian-input__base"
      :value="modelValue"
      :type="asTextArea ? undefined : inputType"
      :autocomplete="password ? 'off' : (baseAttrs.autocomplete as string | undefined)"
      :rows="asTextArea ? rows : undefined"
      :placeholder="placeholder"
      :disabled="disabled"
      :aria-invalid="invalid || baseAttrs['aria-invalid']"
      @input="(e: InputEvent) => emit('update:model-value', (e.target as HTMLInputElement).value)"
      @change="(e: Event) => emit('commit', (e.target as HTMLInputElement).value)"
      @keydown.enter="(e: KeyboardEvent) => onEnter(e)"
    />
    <span v-if="hasTrailing" ref="trailing" class="abele-obsidian-input__trailing">
      <span
        v-if="loading"
        ref="loadingIcon"
        class="abele-obsidian-input__loading-icon"
        role="status"
        aria-label="Загружаю"
      />
      <slot v-else name="trailing">
        <span ref="trailingIcon" class="abele-obsidian-input__trailing-icon" aria-hidden="true" />
      </slot>
    </span>
  </div>
</template>

<script setup lang="ts">
// A text field shaped like Nuxt UI's Input: the field itself, an optional leading icon and a
// trailing place for an icon, a button or a count. The look is Obsidian's own: its input,
// and its search field's geometry for the icon beside the text.
import { computed, onBeforeUnmount, onMounted, ref, useAttrs, useSlots, watch } from 'vue'
import { setIcon } from 'obsidian'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  modelValue?: string
  disabled?: boolean
  placeholder?: string
  /** The kind of value, as the platform's input knows it. */
  type?: 'text' | 'password' | 'email' | 'url' | 'number' | 'search' | 'tel' | 'datetime-local'
  /** An icon before the text, by Lucide name. */
  icon?: string
  /** An icon after the text, by Lucide name. The trailing slot replaces it. */
  trailingIcon?: string
  /** A value is being fetched or checked; a spinner takes the trailing place. */
  loading?: boolean
  /** The value is wrong. The field says so with its border; the message is the row's to write. */
  invalid?: boolean
  asTextArea?: boolean
  /** Typed characters shown as dots: a passphrase, a key. Single-line only. */
  password?: boolean
  /**
   * A date and a time of day, picked with the platform's own control; the value is
   * `YYYY-MM-DDTHH:mm`, in this device's time zone. Single-line only.
   */
  dateTime?: boolean
  /**
   * How many lines tall the field stands, for a caller that grows it with its content.
   * Ignored on a single-line input, which has no such attribute.
   */
  rows?: number
}>()

/**
 * `update:model-value` on every keystroke; `commit` once the value is finished — on Enter in a
 * single-line field, and on leaving a field whose value changed. A caller whose every save
 * costs something listens to the second. Both can fire for one edit, Enter and then the blur,
 * so a caller treats a commit of the value it already holds as nothing.
 */
const emit = defineEmits<{
  (e: 'update:model-value', value: string): void
  (e: 'commit', value: string): void
}>()

const slots = useSlots()
// As in Nuxt UI, a caller's class and style place the whole field; every other attribute
// (a label, a name, an id) belongs to the input itself.
const attrs = useAttrs()
const rootClass = computed(() => attrs.class)
const rootStyle = computed(() => attrs.style as string | Record<string, string> | undefined)
const baseAttrs = computed(() => {
  const { class: _class, style: _style, ...rest } = attrs
  return rest
})
const inputType = computed(() =>
  props.password ? 'password' : props.dateTime ? 'datetime-local' : (props.type ?? 'text')
)
const hasLeading = computed(() => !props.asTextArea && (!!props.icon || !!slots.leading))
const hasTrailing = computed(
  () => !props.asTextArea && (props.loading || !!props.trailingIcon || !!slots.trailing)
)

const base = ref<HTMLInputElement>()
const leadingIcon = ref<HTMLElement>()
const trailingIcon = ref<HTMLElement>()
const loadingIcon = ref<HTMLElement>()
const trailing = ref<HTMLElement>()
watch([leadingIcon, () => props.icon], ([el, name]) => el && name && setIcon(el, name), {
  immediate: true,
})
watch([trailingIcon, () => props.trailingIcon], ([el, name]) => el && name && setIcon(el, name), {
  immediate: true,
})
watch(loadingIcon, (el) => el && setIcon(el, 'loader-circle'), { immediate: true })

// The trailing place holds anything from one icon to a "12/40" count, so the text stops where
// that place begins rather than at a width guessed for an icon.
const trailingWidth = ref(0)
let observer: ResizeObserver | undefined
onMounted(() => {
  if (typeof ResizeObserver === 'undefined') return
  observer = new ResizeObserver(() => {
    trailingWidth.value = trailing.value?.offsetWidth ?? 0
  })
  watch(
    trailing,
    (el, old) => {
      if (old) observer?.unobserve(old)
      if (el) observer?.observe(el)
      else trailingWidth.value = 0
    },
    { immediate: true }
  )
})
onBeforeUnmount(() => observer?.disconnect())

function onEnter(e: KeyboardEvent): void {
  // The Enter that picks a word in an input method ends the composition, not the value.
  if (props.asTextArea || e.isComposing) return
  emit('commit', (e.target as HTMLInputElement).value)
}

defineExpose({ inputRef: base })
</script>

<style lang="scss">
// The block is a box around Obsidian's own input, so a field keeps the host's height, border,
// focus ring and placeholder; only the room for the icons beside the text is ours.
.abele-obsidian-input {
  position: relative;
  display: flex;
  align-items: center;
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

.abele-obsidian-input__base {
  width: 100%;
  min-width: 0;
  max-width: 100%;
}

// Where Obsidian's search field puts its magnifier, in its colour, and how far its text starts
// after it: the numbers are the host's own search geometry.
.abele-obsidian-input__leading,
.abele-obsidian-input__trailing {
  position: absolute;
  top: 0;
  bottom: 0;
  display: flex;
  align-items: center;
  gap: var(--size-4-1);
  color: var(--search-icon-color);
  --icon-size: var(--search-icon-size);
}
.abele-obsidian-input__leading {
  inset-inline-start: var(--size-4-2);
  pointer-events: none;
}
.abele-obsidian-input__trailing {
  inset-inline-end: var(--input-icon-inset);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
}
.abele-obsidian-input__leading-icon,
.abele-obsidian-input__trailing-icon,
.abele-obsidian-input__loading-icon {
  display: flex;
}
.abele-obsidian-input_leading .abele-obsidian-input__base {
  padding-inline-start: calc(var(--search-icon-size) * 2 - var(--size-2-1));
}
.abele-obsidian-input_trailing .abele-obsidian-input__base {
  padding-inline-end: calc(
    var(--abele-input-trailing-width, var(--search-icon-size)) + var(--input-icon-inset) * 2
  );
}

.abele-obsidian-input__loading-icon svg {
  animation: abele-obsidian-input-spin 1s linear infinite;
}
@media (prefers-reduced-motion: reduce) {
  .abele-obsidian-input__loading-icon svg {
    animation: none;
  }
}
@keyframes abele-obsidian-input-spin {
  to {
    transform: rotate(360deg);
  }
}

// Obsidian's own invalid field: the border turns to the error colour, as in its forms.
.abele-obsidian-input_invalid .abele-obsidian-input__base,
.abele-obsidian-input_invalid .abele-obsidian-input__base:hover {
  border-color: var(--text-error);
}

.abele-obsidian-input_multiline .abele-obsidian-input__base {
  min-height: 6em;
  resize: vertical;
}

/**
 * A field told how many rows it stands at is being sized by its caller, so the floor a
 * free-standing textarea gets would only push it open, and a handle to drag would fight the
 * caller for the same property.
 */
.abele-obsidian-input_sized .abele-obsidian-input__base {
  min-height: auto;
  resize: none;
}
</style>
