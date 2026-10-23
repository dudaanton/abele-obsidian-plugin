<template>
  <!-- What this side discussion is about, before anything was said in it: the words, where they
       live, and what the agent was given with them, folded. It scrolls with the messages. -->
  <section v-if="view" class="abele-discussion-anchor" :aria-label="t('discussion.about')">
    <Quote :text="view.quote" :class="{ 'abele-discussion-anchor__quote_code': view.code }" />
    <div class="abele-discussion-anchor__source">
      <a
        v-if="view.source.open && view.source.missing !== 'deleted'"
        href="#"
        class="abele-discussion-anchor__back"
        :aria-label="t('discussion.backTo', { where: view.source.text })"
        @click.prevent="view.source.open"
      >
        <Icon :icon="view.source.icon" size="xs" :interactive="false" />
        <span class="abele-discussion-anchor__where">{{ view.source.text }}</span>
      </a>
      <span v-else class="abele-discussion-anchor__back abele-discussion-anchor__back_off">
        <Icon :icon="view.source.icon" size="xs" :interactive="false" />
        <span class="abele-discussion-anchor__where">{{ view.source.text }}</span>
      </span>
      <span v-if="view.source.missing" class="abele-discussion-anchor__missing">{{
        view.source.missing === 'deleted' ? t('discussion.deleted') : t('discussion.changed')
      }}</span>
    </div>
    <Disclosure
      v-if="view.context.length"
      v-model="open"
      class="abele-discussion-anchor__context"
      :label="t('discussion.whatTheAgentSees')"
      :count="view.context.length"
    >
      <div class="abele-discussion-anchor__items">
        <ListRow
          v-for="item in view.context"
          :key="item.key"
          :title="item.title"
          :icon="item.icon"
          :facts="item.detail ? [{ key: '0', value: item.detail }] : undefined"
          :interactive="!!item.open"
          @open="item.open?.()"
        />
      </div>
    </Disclosure>
  </section>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { ref, watch, onMounted, onUnmounted } from 'vue'
import { GlobalStore } from '@/stores/GlobalStore'
import Icon from './obsidian/Icon.vue'
import Quote from './obsidian/Quote.vue'
import Disclosure from './obsidian/Disclosure.vue'
import ListRow from './obsidian/ListRow.vue'
import type { ChatSession } from '@/ai/ChatSession'
import { discussionAnchor, type DiscussionAnchorView } from '@/ai/discussionAnchor'

const props = defineProps<{ session: ChatSession }>()
const view = ref<DiscussionAnchorView | null>(null)
/** Folded every time a discussion opens: a glance when wanted, never a wall of text. */
const open = ref(false)

let generation = 0
const revision = ref(0)
const disposers: (() => void)[] = []
onMounted(() => {
  const vault = GlobalStore.getInstance().app.vault
  for (const event of ['modify', 'delete', 'rename', 'create'] as const) {
    const listener = vault.on(event, (file) => {
      if (file.path === props.session.anchor.value?.note || file.path.endsWith('.abchat'))
        revision.value++
    })
    disposers.push(() => vault.offref(listener))
  }
})
onUnmounted(() => {
  generation++
  for (const dispose of disposers) dispose()
})
watch(
  () => [props.session.id, props.session.anchor.value] as const,
  () => {
    open.value = false
  }
)
watch(
  () =>
    [
      props.session,
      props.session.anchor.value,
      props.session.agent.value,
      props.session.toolModes.value,
      props.session.permissionMode.value,
      revision.value,
    ] as const,
  async ([session]) => {
    const mine = ++generation
    try {
      const next = await discussionAnchor(session)
      if (mine === generation) view.value = next
    } catch (error) {
      console.debug('[Abele] discussion context unavailable', error)
      if (mine === generation) view.value = null
    }
  },
  { immediate: true }
)
</script>

<style lang="scss">
.abele-discussion-anchor {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
  padding-block: var(--size-4-2) var(--size-4-3);
  margin-block-end: var(--size-4-3);
  border-bottom: var(--border-width) solid var(--background-modifier-border);

  // The words are what the discussion is about: they read at the messages' size, not as a
  // quoted aside.
  .abele-quote blockquote.abele-quote__text {
    margin-block-end: 0;
    font-size: inherit;
  }
}
.abele-discussion-anchor .abele-discussion-anchor__quote_code blockquote.abele-quote__text {
  font-family: var(--font-monospace);
  font-size: var(--font-ui-small);
  // A sidebar is narrow: long lines wrap rather than hide behind a sideways scroll.
  overflow-wrap: anywhere;
  white-space: pre-wrap;
}
.abele-discussion-anchor__source {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--size-4-1) var(--size-4-2);
  min-width: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}
.abele-discussion-anchor__back {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-1);
  min-width: 0;
  max-width: 100%;
  color: inherit;
  text-decoration: none;
  cursor: var(--cursor-link);

  &:hover {
    color: var(--text-normal);
  }
}
// A finger's height for the way back on a phone, the line itself as quiet as on a computer.
body.is-phone .abele-discussion-anchor__back {
  min-height: var(--touch-size-l, 44px);
}
.abele-discussion-anchor__back_off {
  cursor: default;

  &:hover {
    color: inherit;
  }
}
.abele-discussion-anchor__where {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.abele-discussion-anchor__missing {
  color: var(--text-faint);
}
.abele-discussion-anchor__items {
  display: flex;
  flex-direction: column;
}
</style>
