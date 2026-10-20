<template>
  <TreeItem
    class="abele-chat-run abele-chat-letter"
    :class="{ 'abele-chat-letter_running': running, 'abele-chat-run_running': running }"
    :icon="running ? 'loader' : 'message-square-share'"
    :text="t('chat.letterAsked', { title: letter.to.title })"
    :where="letter.to.folder"
    :collapsible="letter.reply !== undefined"
    :collapsed="!open"
    @click="open = !open"
  >
    <template #actions>
      <Icon
        icon="external-link"
        size="xs"
        :tooltip="t('chat.letterOpen', { title: letter.to.title })"
        @click.stop="openLetterChat(letter.to)"
      />
    </template>
    <Markdown v-if="letter.reply !== undefined" :text="letter.reply" />
  </TreeItem>
  <div v-if="letter.refusal" class="abele-chat-msg__letter-refusal" role="status">
    {{ t('chat.letterRefused') }}: {{ letter.refusal }}
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '@/i18n'
import { openLetterChat } from '@/ai/chatMessaging'
import type { ChatLetter } from '@/chats/chatLetters'
import TreeItem from '../obsidian/TreeItem.vue'
import Icon from '../obsidian/Icon.vue'
import Markdown from '../obsidian/Markdown.vue'

const props = defineProps<{ letter: ChatLetter }>()
const open = ref(false)
const running = computed(() => props.letter.reply === undefined && !props.letter.refusal)
</script>
