<template>
  <ObsidianModal
    :size="Platform.isPhone ? 'tall' : undefined"
    :title="t('maps.newHere')"
    close-in-footer
    @close="emit('close')"
  >
    <p v-if="formula" class="abele-map-formula__why">
      {{ t('maps.formulaWhy') }} <code>{{ formula }}</code>
    </p>
    <Setting :name="t('maps.coordinates')" :desc="coordinates">
      <Dropdown
        :options="choices"
        :model-value="picked"
        @update:model-value="(v: string) => (picked = v)"
      />
    </Setting>
    <template #footer>
      <div class="modal-button-container">
        <Button :text="t('maps.cancel')" :tooltip="t('kit.cancelTooltip')" @click="emit('close')" />
        <Button
          :text="t('maps.createNote')"
          accent
          :disabled="!picked"
          :tooltip="t('maps.createNote')"
          @click="emit('create', picked)"
        />
      </div>
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { Platform } from 'obsidian'
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
