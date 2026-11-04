<template>
  <!-- How hard the model thinks, beside the agent: bars for the level and its word. Following the
       model it is as quiet as the agent; a level of the chat's own sits on the chosen wash, as a
       model of its own does. Nothing for a model that does not reason, nor on a phone, where
       the agent's menu holds it. -->
  <Icon
    v-if="shown"
    ref="el"
    class="abele-chat-effort"
    :class="{ 'abele-chat-effort_own': own }"
    :tooltip="tip"
    :icon="effortGlyph(facts.effort)"
    :text-right="said"
    aria-haspopup="menu"
    @click="open"
  />
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, ref } from 'vue'
import { Menu, Platform } from 'obsidian'
import Icon from './obsidian/Icon.vue'
import { ChatService } from '@/ai/ChatService'
import { addEffortItems, effortFacts, effortGlyph } from './chatEffort'

// A phone's row has no room for another glyph: there the level is in the agent's menu.
const phone = Platform.isPhone
const session = computed(() => ChatService.getInstance().activeSession.value)
const facts = computed(() => effortFacts(session.value))
const shown = computed(() => !phone && facts.value.shown)
const own = computed(() => facts.value.own)
const said = computed(() => facts.value.said)
const tip = computed(() =>
  facts.value.own
    ? t('chat.effortOwnTip', {
        effort: facts.value.said.toLowerCase(),
        model: facts.value.model,
        modelEffort: facts.value.modelEffort,
      })
    : t('chat.effortFollowTip', { effort: facts.value.modelEffort, model: facts.value.model })
)

const el = ref<InstanceType<typeof Icon>>()

function open() {
  const s = session.value
  const box = (el.value?.$el as HTMLElement | undefined)?.getBoundingClientRect()
  if (!s || !box) return
  const menu = new Menu()
  addEffortItems(menu, s, true)
  menu.showAtPosition({ x: box.left, y: box.top })
}
</script>

<style lang="scss">
// A code of the composer's foot, at the agent's size.
.abele-chat-effort {
  display: inline-flex;
  align-items: center;
  gap: var(--size-2-2);
  min-width: 0;
  flex: 0 0 auto;
  color: var(--text-muted);
  font-size: var(--font-ui-smaller);
}

// Apart from the chat's own model when both are on the wash, so they read as two codes.
.abele-agent-selector__model + .abele-chat-effort {
  margin-inline-start: var(--size-2-2);
}

// This chat's own, on the chosen wash, as the chat's own model is.
.abele-chat-effort.abele-chat-effort_own {
  background-color: var(--abele-selected-background);
  color: var(--abele-selected-color);
}

// A narrow pane keeps one of the two: the bars while the chat follows its model, the word once
// it has a level of its own, since that is the one worth reading at a glance.
@container (max-width: 400px) {
  .abele-chat-effort:not(.abele-chat-effort_own) .abele-obsidian-icon__text,
  .abele-chat-effort_own .abele-obsidian-icon__icon {
    display: none;
  }
}
</style>
