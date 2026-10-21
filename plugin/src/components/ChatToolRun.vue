<template>
  <!-- The agent's calls in a row, told in one line: what kind of work, in words, how many calls,
       and a dot when something in it waits for you, was refused or failed. The row opens the calls
       one by one, each with what it was given and what came back. -->
  <TreeItem
    class="abele-chat-run"
    :class="[
      `abele-chat-run_${state}`,
      { 'abele-chat-run_inline-file': fileCalls.length && !open },
    ]"
    :icon="icon"
    :text="summary"
    collapsible
    :collapsed="!open"
    :data-message-id="id"
    :data-run-ids="calls.map((c) => c.id).join(' ')"
    @click="emit('update:open', !open)"
  >
    <template #end>
      <span v-if="!open && fileCalls.length" class="abele-chat-run__inline-file">
        <ChatToolFiles
          v-for="entry in fileCalls"
          :key="entry.call.id"
          :message="entry.call"
          :paths="entry.paths"
          compact
          :resource-opener="resourceOpener"
        />
      </span>
      <span class="abele-chat-run__codes">
        <!-- The chat went more than one way from a call inside: opened, the switch is on it. -->
        <span v-if="forks" ref="fork" class="abele-chat-run__fork"
          ><Icon icon="git-branch" size="xs" :interactive="false" />{{ forks }}</span
        >
        <span
          ref="dot"
          class="abele-chat-run__dot"
          :class="state !== 'done' && `abele-chat-run__dot_${state}`"
          :role="state !== 'done' ? 'img' : undefined"
          :aria-label="state !== 'done' ? STATE_LABEL[state] : undefined"
        />
      </span>
    </template>
    <div class="abele-chat-run__calls">
      <slot />
    </div>
  </TreeItem>
  <!-- Saved results stay in the conversation when the work's details fold away. -->
  <slot v-if="!open" name="results" />
  <!-- A node call in the run was refused for want of access: its way through stays in sight
       with the run folded; opened, it is on the call's own line. -->
  <NodeAccessRefusal
    v-if="!open && refused"
    class="abele-chat-run__refusal"
    :refusal="refused"
    :given="nodeAccessGiven?.(refused)"
    :approves="nodeAccessApproves?.(refused)"
    @act="(r: NodeAccessRefusalData, named?: NodeScopeEntry[]) => emit('node-access', r, named)"
  />
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, ref, watchEffect } from 'vue'
import { setTooltip } from 'obsidian'
import TreeItem from './obsidian/TreeItem.vue'
import ChatToolFiles from './chat/ChatToolFiles.vue'
import Icon from './obsidian/Icon.vue'
import NodeAccessRefusal from './chat/NodeAccessRefusal.vue'
import type { NodeAccessRefusal as NodeAccessRefusalData } from '@/ai/tools/node/accessRefusal'
import type { ChatMessage } from '@/ai/types'
import type { NodeScopeEntry } from '@/ai/nodeScope'
import { KIND_ICON, runKind, runState, runSummary, type RunState } from '@/ai/toolRuns'
import { toolFilePaths } from '@/ai/toolFiles'

const props = defineProps<{
  id: string
  calls: ChatMessage[]
  open: boolean
  resourceOpener?: (path: string) => void
  /** Ways the chat went from a call inside the run, when it branched there. */
  forks?: number
  /** Whether the chat has since been given what a refused node call wanted. */
  nodeAccessGiven?: (refusal: NodeAccessRefusalData) => boolean
  /** What approving a refused call here would confirm: the chat's entries on that node. */
  nodeAccessApproves?: (refusal: NodeAccessRefusalData) => NodeScopeEntry[]
}>()
const emit = defineEmits<{
  (e: 'update:open', open: boolean): void
  (e: 'node-access', refusal: NodeAccessRefusalData, named?: NodeScopeEntry[]): void
}>()
/** The last node call in the run refused for want of access. */
const refused = computed(
  () => [...props.calls].reverse().find((c) => c.nodeAccessRefusal)?.nodeAccessRefusal
)

const STATE_LABEL: Record<RunState, string> = {
  running: t('streamB.theAgentIsWorkingOnIt.fd0a64'),
  waiting: t('streamB.waitingForYourApproval.af7a94'),
  failed: t('streamB.refusedOrFailed.18ffb0'),
  done: '',
}

const state = computed(() => runState(props.calls))
const icon = computed(() =>
  state.value === 'running' ? 'loader' : KIND_ICON[runKind(props.calls)]
)
const summary = computed(() => runSummary(props.calls))
const fileCalls = computed(() => {
  const seen = new Set<string>()
  return props.calls.flatMap((call) => {
    const paths = toolFilePaths(call).filter((path) => {
      if (seen.has(path)) return false
      seen.add(path)
      return true
    })
    return paths.length ? [{ call, paths }] : []
  })
})

const dot = ref<HTMLElement>()
watchEffect(() => dot.value && setTooltip(dot.value, STATE_LABEL[state.value]))
const fork = ref<HTMLElement>()
watchEffect(
  () =>
    fork.value &&
    setTooltip(
      fork.value,
      t('streamB.theChatWentWaysFromACall.6a5477', { v0: String(props.forks) })
    )
)
</script>

<style lang="scss">
// A run sits in the chat as a quiet line, level with the messages' text. The line is as wide
// as its words unless file links need the row's room; their codes stay at the row's end.
// The counts are in the words already («Searched 3 · Read»).
.abele-chat-run > .tree-item-self {
  width: fit-content;
  max-width: 100%;
  color: var(--text-muted);
  font-size: var(--font-ui-small);

  .tree-item-flair-outer {
    margin-inline-start: var(--size-4-2);
  }
}
.abele-chat-run_running > .tree-item-self .abele-tree-item__glyph svg {
  animation: abele-chat-run-spin 1.2s linear infinite;
}
.abele-chat-run_inline-file > .tree-item-self {
  width: 100%;
  flex-wrap: wrap;
  row-gap: var(--size-2-1);

  .tree-item-inner {
    flex: 0 0 auto;
  }
  .tree-item-flair-outer,
  .abele-tree-item__end {
    min-width: 0;
    flex: 1 1 auto;
  }
  .abele-tree-item__text {
    white-space: nowrap;
  }
  .abele-chat-run__codes {
    flex-shrink: 0;
    margin-inline-start: auto;
  }
  .tree-item-flair-outer {
    max-width: 100%;
    height: auto;
    min-height: 1lh;
  }
  .abele-tree-item__end {
    align-items: flex-start;
  }
}
.abele-chat-run__inline-file {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--size-2-1) var(--size-4-2);
  min-width: 0;
}
.abele-chat-run_failed > .tree-item-self {
  .tree-item-inner {
    flex: 0 1 auto;
    min-width: 0;
  }
  .abele-tree-item__text {
    white-space: normal;
    overflow-wrap: anywhere;
  }
}
.abele-chat-run_failed.abele-chat-run_inline-file > .tree-item-self {
  align-items: flex-start;

  .tree-item-inner {
    flex: 1 1 0;
  }
  .tree-item-flair-outer {
    flex-basis: 100%;
    margin-inline-start: calc(2 * (var(--icon-xs) + var(--size-4-1)));
  }
}
@keyframes abele-chat-run-spin {
  to {
    transform: rotate(360deg);
  }
}
@media (prefers-reduced-motion: reduce) {
  .abele-chat-run_running > .tree-item-self .abele-tree-item__glyph svg {
    animation: none;
  }
}
.abele-chat-run__codes {
  display: inline-flex;
  align-items: center;
  gap: var(--size-4-2);
  color: var(--text-faint);
  font-size: var(--font-ui-smaller);
  font-variant-numeric: tabular-nums;
}
.abele-chat-run__fork {
  display: inline-flex;
  align-items: center;
  gap: var(--size-2-1);

  .abele-obsidian-icon {
    padding: 0;
  }
}
// The dot keeps its place in every run, empty when all is well, so runs line up.
.abele-chat-run__dot {
  width: var(--size-4-2);
  height: var(--size-4-2);
  border-radius: 50%;

  &_running {
    background-color: var(--interactive-accent);
  }
  &_waiting {
    background-color: var(--color-orange);
  }
  &_failed {
    background-color: var(--color-red);
  }
}
/* A call nests as a tree's child does: its glyph under the run's words, the same size as the
   run's glyph and as close to its own words. The guide's offset and the run's toggle are
   Obsidian's; what is added is the run's glyph and the gap after it. */
.abele-chat-run__calls {
  padding-block: var(--size-2-1);
  padding-inline-start: calc(var(--icon-xs) + var(--size-4-1) + var(--size-4-2));

  > .abele-chat-msg_tool-call {
    column-gap: var(--size-4-1);
  }

  .abele-chat-msg__icon .abele-obsidian-icon {
    padding: 0;
    --icon-size: var(--icon-xs);
  }
}

/* A finger's box stays as tall, but no wider than the glyph, or it would push the words away. */
body.is-mobile .abele-chat-run__calls button.abele-chat-msg__icon {
  min-width: 0;
}
</style>
