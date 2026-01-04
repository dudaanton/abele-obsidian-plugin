<template>
  <div class="abele-replacement-action">
    <div class="abele-replacement-action__inputs-wrapper">
      <ObsidianDropdown v-model="action.type" :options="typeOptions" />
      <ObisidianInput
        v-if="action.type === 'move'"
        v-model="action.directory"
        class="abele-replacement-action__input"
        placeholder="Directory"
      />
      <ObisidianInput
        v-else-if="action.type !== 'replace-in-content'"
        v-model="action.property"
        class="abele-replacement-action__input"
        placeholder="Property name"
      />
      <ObisidianInput
        v-if="
          action.type === 'replace-in-list' ||
          action.type === 'replace-in-content' ||
          action.type === 'replace-in-property'
        "
        v-model="action.oldValue"
        class="abele-replacement-action__input abele-replacement-action__input_stretch"
        placeholder="Old value"
      />
      <ObisidianInput
        v-if="
          action.type !== 'remove-from-list' &&
          action.type !== 'remove-property' &&
          action.type !== 'move'
        "
        v-model="action.value"
        class="abele-replacement-action__input abele-replacement-action__input_stretch"
        placeholder="Value"
      />
    </div>
    <ObsidianIcon icon="cross" @click="emit('remove')" />
  </div>
</template>

<script setup lang="ts">
import ObsidianDropdown from './obsidian/Dropdown.vue'
import ObisidianInput from './obsidian/Input.vue'
import ObsidianIcon from './obsidian/Icon.vue'
import { ReplacementAction } from '@/entities/ReplacementAction'

const props = defineProps<{
  action: ReplacementAction
}>()

const typeOptions = [
  { value: 'set-property', display: 'Set/Add property' },
  { value: 'remove-property', display: 'Remove property' },
  { value: 'add-to-list', display: 'Add to list' },
  { value: 'remove-from-list', display: 'Remove from list' },
  { value: 'replace-in-list', display: 'Replace in list' },
  { value: 'move', display: 'Move note' },
  { value: 'replace-in-content', display: 'Replace in content' },
  { value: 'replace-in-property', display: 'Replace in property' },
]

const emit = defineEmits<{
  (e: 'remove'): void
}>()
</script>

<style lang="scss">
.abele-replacement-action {
  display: flex;
  align-items: center;
  gap: calc(var(--p-spacing) / 4);

  .abele-obsidian-icon {
    align-self: flex-start;
    height: var(--input-height);
  }
}

.abele-replacement-action__inputs-wrapper {
  display: flex;
  align-items: center;
  width: 100%;
  gap: calc(var(--p-spacing) / 4);
}

@media (max-width: 845px) {
  .abele-replacement-action__inputs-wrapper {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: calc(var(--p-spacing) / 4);

    .abele-obsidian-icon {
      grid-column: 1 / -1;
    }
  }
}

@media (max-width: 460px) {
  .abele-replacement-action__inputs-wrapper {
    grid-template-columns: 1fr;
    gap: calc(var(--p-spacing) / 4);
  }
}

.abele-replacement-action__input {
  flex: 1;
}

.abele-replacement-action__input_stretch {
  @media (max-width: 845px) {
    grid-column: 1 / -1;
  }
}
</style>
