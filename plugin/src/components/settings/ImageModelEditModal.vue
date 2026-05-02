<template>
  <ObsidianModal :title="isNew ? 'Add Image Model' : 'Edit Image Model'" @close="emit('close')">
    <div class="abele-model-edit">
      <Setting name="Model ID" desc="API model identifier (e.g. gpt-image-1, flux-pro).">
        <Input v-model:model-value="form.id" placeholder="e.g. gpt-image-1" />
      </Setting>

      <Setting name="Display name" desc="Optional label shown in model selector.">
        <Input v-model:model-value="form.name" placeholder="e.g. GPT Image 1" />
      </Setting>

      <template v-if="isOpenAi">
        <Setting name="Size" desc="Image dimensions.">
          <Dropdown
            :model-value="form.size"
            :options="sizeOptions"
            @update:model-value="form.size = $event"
          />
        </Setting>

        <Setting name="Quality">
          <Dropdown
            :model-value="form.quality"
            :options="qualityOptions"
            @update:model-value="form.quality = $event"
          />
        </Setting>

        <Setting name="Output format">
          <Dropdown
            :model-value="form.outputFormat"
            :options="formatOptions"
            @update:model-value="form.outputFormat = $event"
          />
        </Setting>
      </template>

      <div class="abele-model-edit__actions">
        <Button text="Save" :disabled="!form.id" @click="onSave" />
        <Button v-if="!isNew" text="Delete" @click="onDelete" />
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { reactive } from 'vue'
import ObsidianModal from '../obsidian/Modal.vue'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Button from '../obsidian/Button.vue'
import type { ImageModelConfig2 } from '@/ai/types'

const props = defineProps<{
  model: ImageModelConfig2
  isNew?: boolean
  isOpenAi?: boolean
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'save', model: ImageModelConfig2): void
  (e: 'delete'): void
}>()

const form = reactive<ImageModelConfig2>({ ...props.model })

const sizeOptions = [
  { value: '1024x1024', display: '1024×1024' },
  { value: '1536x1024', display: '1536×1024 (landscape)' },
  { value: '1024x1536', display: '1024×1536 (portrait)' },
  { value: 'auto', display: 'Auto' },
]

const qualityOptions = [
  { value: 'low', display: 'Low' },
  { value: 'medium', display: 'Medium' },
  { value: 'high', display: 'High' },
]

const formatOptions = [
  { value: 'png', display: 'PNG' },
  { value: 'jpeg', display: 'JPEG' },
  { value: 'webp', display: 'WebP' },
]

const onSave = () => {
  emit('save', { ...form })
  emit('close')
}

const onDelete = () => {
  emit('delete')
  emit('close')
}
</script>
