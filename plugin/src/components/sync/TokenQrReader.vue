<template>
  <Setting :name="t('sync.qr.title')" :desc="t('sync.qr.description')">
    <Button
      :text="t('sync.qr.read')"
      :tooltip="t('sync.qr.readTip')"
      :disabled="busy"
      @click="picker?.click()"
    />
    <input ref="picker" type="file" accept="image/*" capture="environment" hidden @change="read" />
  </Setting>
  <p v-if="error" role="alert">{{ error }}</p>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import Setting from '../obsidian/Setting.vue'
import Button from '../obsidian/Button.vue'
import { readPhoto } from '@/transfer/photo'
import { decodeAccessToken } from '@/sync/v2/client'
import { useI18n } from '@/i18n/useI18n'
const { t } = useI18n()
const emit = defineEmits<{ token: [text: string] }>()
const picker = ref<HTMLInputElement>(),
  busy = ref(false),
  error = ref('')
async function read(event: Event) {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0]
  if (!file || busy.value) return
  busy.value = true
  error.value = ''
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = input.doc.win.createEl('canvas'),
      context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('No image reader')
    const token = await readPhoto(
      image.naturalWidth,
      image.naturalHeight,
      (look, size) => {
        canvas.width = size.width
        canvas.height = size.height
        context.drawImage(
          image,
          look.x,
          look.y,
          look.width,
          look.height,
          0,
          0,
          size.width,
          size.height
        )
        return context.getImageData(0, 0, size.width, size.height)
      },
      (text) => {
        try {
          decodeAccessToken(text)
          return true
        } catch {
          return false
        }
      }
    )
    if (token) {
      emit('token', token)
      return
    }
    error.value = t('sync.qr.missing')
  } catch {
    error.value = t('sync.qr.error')
  } finally {
    URL.revokeObjectURL(url)
    input.value = ''
    busy.value = false
  }
}
</script>
