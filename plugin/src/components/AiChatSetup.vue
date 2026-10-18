<template>
  <!-- Named after the chat it sets up: opened over one of several tabs, «Chat» said which
       dialog it was, not which chat. -->
  <ObsidianModal :title="title" size="tall" @close="emit('close')">
    <div class="abele-chat-setup">
      <Tabs :tabs="tabs" :model-value="tab" @update:model-value="tab = $event" />

      <div class="abele-chat-setup__body">
        <AiScopeManager v-if="tab === 'scope'" />
        <AiPermissions v-else-if="tab === 'permissions'" />
        <AiChatSettings v-else @close="emit('close')" />
      </div>
    </div>
  </ObsidianModal>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
/**
 * Everything a chat is set up with, in one dialog: what the agent may reach, which tools it may
 * use, and how this chat behaves.
 *
 * Only settings. Skills and prompts are put into a message, so they are offered where a message
 * is written, on «/» in the composer; reloading the file, copying the debug data and deleting the
 * chat are things done to it once in a while, in the header's ⋯. Three tabs fit on a phone's
 * width, where six ran off its edge.
 */
import { computed, ref } from 'vue'
import ObsidianModal from './obsidian/Modal.vue'
import Tabs, { type Tab } from './obsidian/Tabs.vue'
import AiScopeManager from './AiScopeManager.vue'
import AiPermissions from './AiPermissions.vue'
import AiChatSettings from './AiChatSettings.vue'
import { ChatService } from '@/ai/ChatService'

const props = withDefaults(defineProps<{ open?: string }>(), { open: 'scope' })

const emit = defineEmits<{ (e: 'close'): void }>()

/** Which tab is showing: where the caller asked, the access button in the composer on Access. */
const tab = ref(['scope', 'permissions', 'settings'].includes(props.open) ? props.open : 'scope')

/** Words, not glyphs: three plain words explain themselves; the tooltip carries the rest. */
const tabs: Tab[] = [
  {
    id: 'scope',
    label: t('streamB.access.ec5ba0'),
    tooltip: t('streamB.whatThisChatMayReadAndWrite.241f37'),
  },
  {
    id: 'permissions',
    label: t('streamB.tools.ea93d6'),
    tooltip: t('streamB.whichToolsMayRunAndWhichAsk.466c37'),
  },
  {
    id: 'settings',
    label: t('streamB.chat.460b3a'),
    tooltip: t('streamB.theModelThePromptAndHowThis.ad5e02'),
  },
]

const title = computed(
  () =>
    ChatService.getInstance().activeSession.value?.chatTitle.value || t('streamB.newChat.db1838')
)
</script>

<style lang="scss">
.abele-chat-setup {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  gap: var(--size-4-2);
}

/**
 * The one thing that scrolls. The dialog is a column capped at the height it is allowed, so a
 * long list of tools or prompts moves inside it rather than growing it past the screen.
 *
 * The padding is room for a focus ring: a scrolling box clips whatever reaches past its edge,
 * and a field's ring reaches past the field on every side. Pulled back by the same margin so
 * the content stands where it did.
 */
.abele-chat-setup__body {
  display: flex;
  flex-direction: column;
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: var(--size-2-2);
  margin: calc(-1 * var(--size-2-2));
  // The scrollbar takes room of its own on the right, so a full-width field or a button at the
  // row's end never runs under it.
  scrollbar-gutter: stable;
  padding-inline-end: var(--size-4-3);
  margin-inline-end: 0;
}
</style>
