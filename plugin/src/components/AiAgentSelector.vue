<template>
  <div class="abele-agent-selector">
    <Icon
      v-if="compact && options.length"
      icon="bot"
      :text-right="phone ? undefined : activeName"
      :tooltip="activeName"
      aria-haspopup="menu"
      @click="agentMenu"
    />
    <Dropdown
      v-else-if="options.length > 0"
      :model-value="activeId"
      :options="options"
      @update:model-value="onSelect"
    />
    <span v-else class="abele-agent-selector__empty">{{
      t('streamB.noAgentConfigured.ed3683')
    }}</span>

    <!-- The model is the agent's and is not repeated here. Only a chat that answers with a model
         of its own says so, by the agent: the model's name on the chosen wash; pressed, the
         models to change to and the way back to the agent's, at the button. -->
    <!-- A plate, not a form button: it reads as a fact of the header that opens its menu. -->
    <div
      v-if="modelLabel && modelOverridden"
      ref="modelButton"
      role="button"
      tabindex="0"
      class="abele-agent-selector__model"
      aria-haspopup="menu"
      @click="showModels"
      @keydown.enter.prevent="showModels"
      @keydown.space.prevent="showModels"
    >
      <Icon icon="cpu" size="xs" :interactive="false" class="abele-agent-selector__model-icon" />
      <span class="abele-agent-selector__model-name">{{ modelLabel }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, ref, watchEffect } from 'vue'
import { Menu, Notice, Platform, setTooltip } from 'obsidian'
import { AbeleConfig } from '@/services/AbeleConfig'
import Dropdown from './obsidian/Dropdown.vue'
import Icon from './obsidian/Icon.vue'
import { ChatService } from '@/ai/ChatService'
import { AgentRegistry } from '@/ai/agents/AgentRegistry'
import { NodeService } from '@/node/NodeService'
import { pickNodeSession } from '@/node/openSession'

const NODE = 'node:'
defineProps<{ compact?: boolean }>()
const phone = Platform.isPhone
const activeName = computed(
  () => options.value.find((option) => option.value === activeId.value)?.display ?? ''
)
function agentMenu(event: MouseEvent) {
  const menu = new Menu()
  for (const option of options.value)
    menu.addItem((item) =>
      item
        .setTitle(option.display)
        .setChecked(option.value === activeId.value)
        .onClick(() => void onSelect(option.value))
    )
  menu.showAtMouseEvent(event)
}
/** The nodes this vault is connected to; none when node connections did not load. */
const nodes = () => {
  try {
    return NodeService.getInstance().nodes.value
  } catch {
    return []
  }
}

const chatService = ChatService.getInstance()
const registry = AgentRegistry.getInstance()
const session = computed(() => chatService.activeSession.value)

/**
 * Utility agents are deliberately absent: they exist for scripts and delegation, not chat.
 *
 * With one exception, and it is a comment. A comment starts on whatever `commentAgentId` names,
 * which is a utility agent in every vault that took the default — and a `select` handed a value
 * none of its options carry shows the first one instead, so the picker would sit there naming
 * an agent this conversation has nothing to do with. The card in the margin lets the same one
 * back in, for the same reason.
 */
const options = computed(() => {
  // A chat on a node picks from what the node runs.
  const place = session.value?.place?.value
  if (place) return place.agents.map((agent) => ({ value: agent.id, display: agent.name }))
  const listed = registry.list().map((agent) => ({ value: agent.id, display: agent.name }))

  const own = session.value?.kind === 'comment' ? session.value.agent.value : null
  if (own && !listed.some((option) => option.value === own.id)) {
    listed.unshift({ value: own.id, display: own.name })
  }

  // A chat with nothing in it yet can still go to a node: its agents are picked there.
  if (session.value && !session.value.messages.value.length)
    for (const node of nodes())
      listed.push({
        value: `${NODE}${node.id}`,
        display: t('streamB.on.c83a54', { v0: String(node.label) }),
      })

  return listed
})

const activeId = computed(() => session.value?.agent.value?.id ?? '')

/**
 * Shown beside the agent so the model in force is visible without opening settings.
 *
 * Falls back to the id: models fetched from a provider's `/models` endpoint often carry no
 * display name, and an unlabelled model is worse than a technical one.
 */
const modelLabel = computed(() => {
  const model = session.value?.resolveModel()
  return model ? model.name || model.id : ''
})

const modelOverridden = computed(() => {
  const s = session.value
  return (
    !!s?.isOverridden?.('modelId') &&
    (s.activeProviderId.value !== s.agent.value?.providerId ||
      s.activeModelId.value !== s.agent.value?.modelId)
  )
})

/** The agent's own model, named in the tooltip and on the way back. */
const agentModelLabel = computed(() => {
  const agent = session.value?.agent.value
  if (!agent?.modelId) return ''
  for (const provider of AbeleConfig.getInstance().ai.providers)
    if (provider.id === agent.providerId) {
      const model = provider.models.find((m) => m.id === agent.modelId)
      if (model) return model.name || model.id
    }
  return agent.modelId
})

const modelButton = ref<HTMLElement>()
watchEffect(() => {
  const agent = session.value?.agent.value?.name ?? t('streamB.theAgent.c770ef')
  if (modelButton.value)
    setTooltip(
      modelButton.value,
      t('streamB.thisChatAnswersWithChangeOrGo.6b12b6', {
        v0: String(modelLabel.value),
        v1: String(
          agentModelLabel.value && agentModelLabel.value !== modelLabel.value
            ? t('streamB.notS.284282', { v0: String(agent), v1: String(agentModelLabel.value) })
            : ''
        ),
      })
    )
})

function showModels() {
  const s = session.value
  const el = modelButton.value
  if (!s || !el) return
  const menu = new Menu()
  for (const provider of AbeleConfig.getInstance().ai.providers)
    for (const model of provider.models)
      menu.addItem((item) =>
        item
          .setTitle(model.name || model.id)
          .setChecked(
            s.activeProviderId.value === provider.id && s.activeModelId.value === model.id
          )
          .setSection('models')
          .onClick(() => {
            s.activeProviderId.value = provider.id
            s.activeModelId.value = model.id
            void s.save()
          })
      )
  const agent = s.agent.value?.name ?? t('streamB.theAgent.c770ef')
  menu.addItem((item) =>
    item
      .setTitle(
        agentModelLabel.value
          ? t('streamB.follow.4322cb', { v0: String(agent), v1: String(agentModelLabel.value) })
          : t('streamB.follow.810f3e', { v0: String(agent) })
      )
      .setIcon('rotate-ccw')
      .setSection('back')
      .onClick(() => {
        s.clearOverride('modelId')
        s.clearOverride('providerId')
        void s.save()
      })
  )
  const box = el.getBoundingClientRect()
  menu.showAtPosition({ x: box.left, y: box.bottom })
}

const onSelect = (agentId: string) => {
  const s = session.value
  if (!s || agentId === s.agentId.value) return
  if (agentId.startsWith(NODE)) {
    const node = nodes().find((n) => `${NODE}${n.id}` === agentId)
    if (node)
      void pickNodeSession(node).catch(
        (error: unknown) =>
          new Notice(error instanceof Error ? error.message : t('streamB.nodeUnavailable.14c28f'))
      )
    return
  }
  const place = s.place?.value
  if (place) return place.startWith(agentId)

  // Overrides were expressed against the previous agent, so switching drops them. Said out
  // loud rather than silently, since it can undo a scope somebody narrowed on purpose.
  const overridden = Object.keys(s.overrides.value).length
  if (overridden) {
    new Notice(t('streamBCount.clearedOverrides', { count: overridden }))
  }

  s.switchAgent(agentId)
}
</script>

<style lang="scss">
.abele-agent-selector {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  min-width: 0;

  .abele-obsidian-dropdown .dropdown {
    max-width: 12em;
    min-width: 5em;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}

// Chosen for this chat, so on the chosen wash: one code for "this chat's own" wherever it shows.
.abele-agent-selector .abele-agent-selector__model {
  display: inline-flex;
  align-items: center;
  min-width: 0;
  max-width: 12em;
  height: auto;
  padding: var(--size-2-1) var(--size-2-3);
  border: none;
  border-radius: var(--radius-s);
  box-shadow: none;
  background-color: var(--abele-selected-background);
  color: var(--abele-selected-color);
  font-size: var(--font-ui-smaller);
  font-weight: var(--font-normal);
  cursor: var(--cursor);

  &:focus-visible {
    box-shadow: var(--input-shadow);
  }
}

.abele-agent-selector__model-icon {
  flex: 0 0 auto;
  color: inherit;
}

.abele-agent-selector__model-name {
  margin-inline-start: var(--size-2-2);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/**
 * A pane too narrow for both: the agent keeps its room, and a chat's own model keeps only its
 * glyph, named in its tooltip, rather than going, since it is the only sign the chat answers
 * differently.
 * A container query, because what is narrow is the pane.
 */
@container (max-width: 420px) {
  .abele-agent-selector__model-name {
    display: none;
  }
}

.abele-agent-selector__empty {
  font-size: var(--font-small);
  color: var(--text-muted);
  font-style: italic;
}
</style>
