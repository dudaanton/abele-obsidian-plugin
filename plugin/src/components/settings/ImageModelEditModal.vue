<template>
  <ObsidianModal
    :title="
      isNew
        ? t('settings.ImageModelEditModal.add_image_model.6b3a2d66')
        : t('settings.ImageModelEditModal.edit_image_model.ca72d086')
    "
    @close="emit('close')"
  >
    <div class="abele-model-edit">
      <Setting
        :name="t('settings.ImageModelEditModal.model_id.089ef2b6')"
        :desc="t('settings.ImageModelEditModal.api_model_identifier_e_g.c112d31d')"
      >
        <Input
          v-model:model-value="form.id"
          :placeholder="
            t('settings.ImageModelEditModal.e_g_gpt_image.c781dc87', {
              literal0: String('gpt-image-1'),
            })
          "
        />
      </Setting>

      <Setting
        :name="t('settings.ImageModelEditModal.display_name.2b7f6a84')"
        :desc="t('settings.ImageModelEditModal.optional_label_shown_in_model.3bf6fb7f')"
      >
        <Input
          v-model:model-value="form.name"
          :placeholder="
            t('settings.ImageModelEditModal.e_g_gpt_image.5ae53afd', {
              literal0: String('GPT Image 1'),
            })
          "
        />
      </Setting>

      <template v-if="isOpenAi">
        <Setting
          :name="t('settings.ImageModelEditModal.size.1af85190')"
          :desc="t('settings.ImageModelEditModal.image_dimensions.1a4bb2f3')"
        >
          <Dropdown
            :model-value="form.size"
            :options="sizeOptions"
            @update:model-value="form.size = $event"
          />
        </Setting>

        <Setting :name="t('settings.ImageModelEditModal.quality.1b2c08a8')">
          <Dropdown
            :model-value="form.quality"
            :options="qualityOptions"
            @update:model-value="form.quality = $event"
          />
        </Setting>

        <Setting :name="t('settings.ImageModelEditModal.output_format.93c53d37')">
          <Dropdown
            :model-value="form.outputFormat"
            :options="formatOptions"
            @update:model-value="form.outputFormat = $event"
          />
        </Setting>
      </template>
    </div>

    <ConfirmModal
      v-if="confirming"
      :title="t('settings.ImageModelEditModal.delete_image_model.f28aaecc')"
      :message="
        t('settings.ImageModelEditModal.delete_value_agents_using_it.c65217d0', {
          value0: String(form.name || form.id),
        })
      "
      :confirm-tooltip="
        t('settings.ImageModelEditModal.delete_value.8782b778', {
          value0: String(form.name || form.id),
        })
      "
      @confirm="onDelete"
      @close="confirming = false"
    />
    <template #footer>
      <Button
        :text="t('settings.ImageModelEditModal.save.1509f561')"
        :disabled="!form.id"
        :tooltip="t('settings.ImageModelEditModal.keep_these_settings_and_close.88a64dfa')"
        @click="onSave"
      />
      <Button
        v-if="!isNew"
        :text="t('settings.ImageModelEditModal.delete.e2d0a549')"
        warning
        :tooltip="t('settings.ImageModelEditModal.remove_this_image_model_from.c139edec')"
        @click="confirming = true"
      />
    </template>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { reactive, ref } from 'vue'
import ObsidianModal from '../obsidian/Modal.vue'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Button from '../obsidian/Button.vue'
import ConfirmModal from '../obsidian/ConfirmModal.vue'
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

/** Held open until the question is answered — see docs/Design.md. */
const confirming = ref(false)

const sizeOptions = [
  { value: '1024x1024', display: '1024×1024' },
  { value: '1536x1024', display: t('settings.ImageModelEditModal.landscape.caa8642b') },
  { value: '1024x1536', display: t('settings.ImageModelEditModal.portrait.29d9d2d0') },
  { value: 'auto', display: t('settings.ImageModelEditModal.auto.02862497') },
]

const qualityOptions = [
  { value: 'low', display: t('settings.ImageModelEditModal.low.f793de20') },
  { value: 'medium', display: t('settings.ImageModelEditModal.medium.8e588cd1') },
  { value: 'high', display: t('settings.ImageModelEditModal.high.c4ebc6d4') },
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
