<template>
  <!-- The option's mark as a note draws it: its icon in its colour, a dot of the colour without
       one, an empty ring for a name the list does not have. -->
  <span
    class="abele-property-select__mark"
    :class="[
      option ? (option.icon ? '' : 'is-dot') : 'is-unknown',
      option?.color && option.color !== 'grey' ? `abele-property-select__mark_${option.color}` : '',
    ]"
    aria-hidden="true"
  >
    <Icon v-if="option?.icon" :icon="option.icon" no-hover />
  </span>
</template>

<script setup lang="ts">
import Icon from '../obsidian/Icon.vue'
import type { SelectOption } from '@/properties/select'
import '@/properties/kinds.css'

defineProps<{ option: SelectOption | null }>()
</script>
