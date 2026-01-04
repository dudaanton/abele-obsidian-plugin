<template>
  <div class="abele-criterion">
    <div class="abele-criterion__inputs-wrapper">
      <ObsidianDropdown v-model="criterion.type" :options="typeOptions" />
      <ObisidianInput
        v-if="criterion.type === 'property'"
        v-model="criterion.property"
        class="abele-criterion__input"
        placeholder="Property name"
      />
      <ObsidianDropdown v-model="criterion.operator" :options="options" />
      <ObisidianInput
        v-if="criterion.operator !== 'exists' && criterion.operator !== 'notExists'"
        v-model="criterion.value"
        class="abele-criterion__input abele-criterion__input_stretch"
        placeholder="Value"
      />
    </div>
    <ObsidianIcon icon="cross" @click="emit('remove')" />
  </div>
</template>

<script setup lang="ts">
import { Criterion } from '@/entities/Criterion'
import ObsidianDropdown from './obsidian/Dropdown.vue'
import ObisidianInput from './obsidian/Input.vue'
import ObsidianIcon from './obsidian/Icon.vue'
import { computed } from 'vue'

const props = defineProps<{
  criterion: Criterion
}>()

const options = computed(() => {
  switch (props.criterion.type) {
    case 'path':
    case 'name':
    case 'content':
      return [
        { value: 'equals', display: 'Equals' },
        { value: 'contains', display: 'Contains' },
        { value: 'notContains', display: 'Not contains' },
        { value: 'startsWith', display: 'Starts with' },
        { value: 'endsWith', display: 'Ends with' },
        { value: 'regex', display: 'Regex' },
      ]
    case 'property':
      return [
        { value: 'equals', display: 'Equals' },
        { value: 'contains', display: 'Contains' },
        { value: 'notContains', display: 'Not contains' },
        { value: 'startsWith', display: 'Starts with' },
        { value: 'endsWith', display: 'Ends with' },
        { value: 'regex', display: 'Regex' },
        { value: 'exists', display: 'Exists' },
        { value: 'notExists', display: 'Not exists' },
      ]
    default:
      return []
  }
})

const typeOptions = [
  { value: 'path', display: 'Path' },
  { value: 'name', display: 'Name' },
  { value: 'property', display: 'Property' },
  { value: 'content', display: 'Content' },
]

const emit = defineEmits<{
  (e: 'remove'): void
}>()
</script>

<style lang="scss">
.abele-criterion {
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 4);

  .abele-obsidian-icon {
    align-self: flex-start;
    height: var(--input-height);
  }
}

.abele-criterion__inputs-wrapper {
  display: flex;
  align-items: center;
  width: 100%;
  gap: calc(var(--p-spacing) / 4);
}

@media (max-width: 845px) {
  .abele-criterion__inputs-wrapper {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: calc(var(--p-spacing) / 4);

    .abele-obsidian-icon {
      grid-column: 1 / -1;
    }
  }
}

@media (max-width: 460px) {
  .abele-criterion__inputs-wrapper {
    grid-template-columns: 1fr;
    gap: calc(var(--p-spacing) / 4);
  }
}

.abele-criterion__input {
  flex: 1;
}

.abele-criterion__input_stretch {
  @media (max-width: 845px) {
    grid-column: 1 / -1;
  }
}
</style>
