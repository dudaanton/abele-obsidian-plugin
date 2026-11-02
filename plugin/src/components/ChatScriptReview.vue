<template>
  <div
    v-if="waiting.length"
    class="abele-chat-script-review setting-item-description"
    :title="waiting.map((script) => script.meta.name).join('\n')"
  >
    <span class="abele-chat-script-review__text">{{
      waiting.length === 1
        ? t('chat.scriptChanged', { name: waiting[0].meta.name })
        : t('chat.scriptsChanged', { count: String(waiting.length) })
    }}</span>
    <span class="abele-chat-script-review__action">
      <span aria-hidden="true">·</span>
      <button type="button" :disabled="reviewing" @click="review">
        {{ t('chat.reviewScripts') }}
      </button>
    </span>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import { t } from '@/i18n'
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
  padding: var(--size-2-2) calc(var(--abele-chat-inset, var(--size-4-4)) / 2);
  flex-shrink: 0;
  min-width: 0;
  white-space: nowrap;
}
.abele-chat-script-review__text {
  flex: 0 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}
.abele-chat-script-review__action {
  display: inline-flex;
  align-items: baseline;
  gap: var(--size-2-2);
  flex: none;
}
.abele-chat-script-review__action button {
  height: auto;
  padding: 0;
  border: none;
  background: none;
  box-shadow: none;
  color: var(--text-accent);
  font: inherit;
  cursor: pointer;
}
.abele-chat-script-review__action button:hover {
  color: var(--text-accent-hover);
  text-decoration: underline;
}
.abele-chat-script-review__action button:disabled {
  cursor: default;
}
</style>
