<template>
  <Setting
    name="Read a QR code"
    desc="Take a photo on your phone, or choose a picture of the code."
  >
    <Button
      text="Read QR…"
      tooltip="Use the camera or choose a QR picture"
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
import { readCodes, readableSize, closerLooks } from '@/transfer/scan'
import { decodeAccessToken } from '@/sync/v2/client'
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
    const looks = [
      { x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight },
      ...closerLooks(image.naturalWidth, image.naturalHeight),
    ]
    for (const look of looks) {
      const size = readableSize(look.width, look.height)
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
      for (const text of await readCodes(context.getImageData(0, 0, size.width, size.height))) {
        try {
          decodeAccessToken(text)
        } catch {
          continue
        }
        emit('token', text)
        return
      }
    }
    error.value = 'No connection token found. Take a clearer picture or paste the token.'
  } catch {
    error.value = 'The picture could not be read. Try another picture or paste the token.'
  } finally {
    URL.revokeObjectURL(url)
    input.value = ''
    busy.value = false
  }
}
</script>
