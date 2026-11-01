<template>
  <div v-if="waiting.length" class="abele-chat-script-review setting-item-description">
    <span class="abele-chat-script-review__text">{{
      waiting.length === 1
        ? t('chat.scriptChanged', { name: waiting[0].meta.name })
        : t('chat.scriptsChanged', { count: String(waiting.length) })
    }}</span>
    <span aria-hidden="true">·</span>
    <Button quiet :text="t('chat.reviewScripts')" :disabled="reviewing" @click="review" />
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '@/i18n'
import Button from './obsidian/Button.vue'
import { ScriptService } from '@/scripting/ScriptService'
import { chatWaitingScripts } from '@/scripting/scriptReview'
const props = defineProps<{ chatId?: string }>()
const service = ScriptService.getInstance()
const waiting = computed(() => {
  void service.scriptList?.value
  return chatWaitingScripts(service, props.chatId)
})
const reviewing = ref(false)
async function review() {
  if (reviewing.value) return
  reviewing.value = true
  try {
    for (const script of [...waiting.value]) {
      // A changed or removed version must not be substituted by a newer, unrelated one.
      if (waiting.value.some((s) => s.path === script.path && s.hash === script.hash))
        await service.review(script)
    }
  } finally {
    reviewing.value = false
  }
}
</script>
<style scoped>
.abele-chat-script-review {
  display: flex;
  align-items: baseline;
  gap: var(--size-2-2);
  padding: var(--size-2-2) var(--size-4-2);
  flex-shrink: 0;
  min-width: 0;
}
.abele-chat-script-review__text {
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
