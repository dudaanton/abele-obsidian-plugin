<template>
  <div v-if="message.toolStatus === 'approved' && imageUrl" class="abele-chat-msg__image-wrap">
    <img
      :src="imageUrl"
      class="abele-chat-msg__image-preview"
      @click="openImagePreview"
      @contextmenu.prevent="onImageContextMenu"
    />
    <span
      v-if="imagePath"
      class="abele-chat-msg__image-link"
      :title="imagePath"
      @click="openImagePreview"
      >{{ fileName(imagePath) }}</span
    >
    <GalleryViewer
      v-if="viewerOpen"
      :images="viewerImages"
      :start-index="0"
      :gallery-file-path="imagePath || ''"
      :chat-id="ChatService.getInstance().activeTabId.value ?? ''"
      @close="viewerOpen = false"
    />
  </div>
</template>
<script setup lang="ts">
import type { ChatMessage } from '@/ai/types'
import { fileName } from '@/ai/attachments'
import { useChatMessageMedia } from '@/composables/useChatMessageMedia'
import { ChatService } from '@/ai/ChatService'
import GalleryViewer from '../GalleryViewer.vue'
const props = defineProps<{ message: ChatMessage; resourceOpener?: (path: string) => void }>()
const { imagePath, imageUrl, viewerOpen, viewerImages, openImagePreview, onImageContextMenu } =
  useChatMessageMedia(props)
</script>
