<template>
  <div
    ref="el"
    class="abele-obsidian-dropdown"
    :class="[$attrs.class, { 'abele-obsidian-dropdown_disabled': disabled }]"
    :style="rootStyle"
  />
</template>

<script setup lang="ts">
// Obsidian's own select, the dropdown of its settings: what Nuxt UI calls a Select. Obsidian
// builds the element, so the attributes a caller gives (a label, an id) are handed to it.
import { computed, ref, onMounted, watch, useAttrs } from 'vue'
import { DropdownComponent } from 'obsidian'
import { fitInBatches } from './dropdownFit'

defineOptions({ inheritAttrs: false })

const props = defineProps<{
  /** The choices; one marked `disabled` is shown but cannot be picked. */
  options: { value: string; display: string; disabled?: boolean }[]
  modelValue: string
  /** Cannot be changed now. */
  disabled?: boolean
}>()

const attrs = useAttrs()
const rootStyle = computed(() => attrs.style as string | Record<string, string> | undefined)

const el = ref<HTMLElement>()
const dropdown = ref<DropdownComponent>()

const updateDropdown = () => {
  if (el.value) {
    el.value.empty()

    dropdown.value = new DropdownComponent(el.value)
    fitInBatches(dropdown.value)
    dropdown.value.selectEl.classList.add('abele-obsidian-dropdown__base')

    props.options.forEach((option) => {
      dropdown.value.addOption(option.value, option.display)
      if (option.disabled) {
        const added = dropdown.value.selectEl.querySelector<HTMLOptionElement>(
          `option[value="${CSS.escape(option.value)}"]`
        )
        if (added) added.disabled = true
      }
    })
    applyAttrs()
    dropdown.value.setDisabled(!!props.disabled)

    if (props.modelValue !== undefined) {
      dropdown.value.setValue(props.modelValue)
    }

    dropdown.value.onChange((value) => {
      emit('update:model-value', value)
    })
  }
}

// The wrapper keeps a caller's class and style, so it can be placed; the rest is the select's.
const applyAttrs = () => {
  const select = dropdown.value?.selectEl
  if (!select) return
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'class' || name === 'style' || name.startsWith('on')) continue
    if (value === false || value === undefined || value === null) select.removeAttribute(name)
    else if (value === true) select.setAttribute(name, '')
    else if (typeof value === 'string' || typeof value === 'number')
      select.setAttribute(name, String(value))
  }
}

// Setting a value sizes the select to it: not again for the value it already shows.
const updateValue = () => {
  if (props.modelValue !== undefined && dropdown.value?.getValue() !== props.modelValue) {
    dropdown.value?.setValue(props.modelValue)
  }
}

onMounted(() => {
  updateDropdown()
})
// The choices by what they say: a caller writing them inline hands a new array on every render
// of its own, and rebuilding the select for the same choices is all cost and no change.
watch(() => JSON.stringify(props.options), updateDropdown)
watch(() => props.modelValue, updateValue)
watch(
  () => props.disabled,
  (value) => dropdown.value?.setDisabled(!!value)
)
watch(() => ({ ...attrs }), applyAttrs)

const emit = defineEmits<{
  (e: 'update:model-value', value: string): void
}>()
</script>

<style lang="scss">
/**
 * Obsidian sizes a dropdown by cloning the select into `.dropdown.is-measuring`, which it
 * leaves in the DOM absolutely positioned with an explicit `left`. Without a positioned
 * ancestor here that offset resolves against a container far up the tree, so the clone lands
 * a few hundred pixels past the pane's right edge and gives the whole settings tab a
 * horizontal scrollbar. Positioning the wrapper makes it the clone's containing block; the
 * clip keeps the clone from widening anything.
 */
.abele-obsidian-dropdown {
  position: relative;
  overflow: hidden;
  // Room for the select's focus ring, which Obsidian draws 3px outside it and the clip above
  // would otherwise cut off (2026-09-05). Content-box, so a `width: 100%` from a settings
  // row still means the select's own width and the padding and margin cancel outside it.
  box-sizing: content-box;
  padding: var(--size-4-1);
  margin: calc(-1 * var(--size-4-1));

  // The host clone's left coordinate is viewport-relative, not wrapper-relative.
  // Keep it in that coordinate space so its hidden intrinsic width cannot widen the scroller.
  .dropdown.is-measuring {
    position: fixed;
  }

  .dropdown {
    width: 100%;
    min-width: 0;
    max-width: 100%;
    text-overflow: ellipsis;
  }
}
</style>
