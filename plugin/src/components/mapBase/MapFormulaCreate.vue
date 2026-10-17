<template>
  <ObsidianModal title="New note here" close-in-footer @close="emit('close')">
    <p class="abele-map-formula__why">
      This view takes coordinates from <code>{{ formula }}</code
      >, and a formula cannot be written to. Pick the property the new note keeps its coordinates
      in.
    </p>
    <Setting name="Coordinates property" :desc="`The note gets ${coordinates} in it.`">
      <Dropdown
        :options="choices"
        :model-value="picked"
        @update:model-value="(v: string) => (picked = v)"
      />
    </Setting>
    <template #footer>
      <div class="modal-button-container">
        <Button text="Cancel" tooltip="Create nothing" @click="emit('close')" />
        <Button
          text="Create note"
          accent
          :disabled="!picked"
          tooltip="Create the note with these coordinates"
          @click="emit('create', picked)"
        />
      </div>
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
// A note made from the map when the view's coordinates come from a formula: where to write them
// is asked first, from the base's ordinary properties; until then nothing is created, and no
// property named after the formula ever appears.
import { computed, ref } from 'vue'
import ObsidianModal from '../obsidian/Modal.vue'
import Setting from '../obsidian/Setting.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Button from '../obsidian/Button.vue'

const props = defineProps<{ formula: string; coordinates: string; properties: string[] }>()
const emit = defineEmits<{ close: []; create: [property: string] }>()
const picked = ref(props.properties[0] ?? '')
const choices = computed(() => props.properties.map((p) => ({ value: p, display: p })))
</script>

<style>
.abele-map-formula__why {
  margin: 0 0 var(--size-4-2);
  color: var(--text-normal);
}
</style>
