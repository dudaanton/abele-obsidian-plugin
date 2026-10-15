<template>
  <!-- Where the branch stands, in codes: the base it is compared with, how far ahead and behind,
       a rebase that stopped, the pull request and its checks. Words in the tooltips. -->
  <span class="abele-branch-codes" :class="`abele-branch-codes_${size}`">
    <span
      v-if="state.base"
      ref="baseEl"
      class="abele-branch-codes__base"
      :class="{ 'abele-branch-codes__base_pick': pickable }"
      :role="pickable ? 'button' : undefined"
      :tabindex="pickable ? 0 : undefined"
      @click="pickable && emit('choose-base')"
      @keydown.enter.prevent="pickable && emit('choose-base')"
      ><Icon icon="arrow-left" size="xs" :interactive="false" />{{ state.base }}</span
    >
    <span
      v-else
      ref="baseEl"
      class="abele-branch-codes__base abele-branch-codes__base_none abele-branch-codes__base_pick"
      role="button"
      tabindex="0"
      @click="emit('choose-base')"
      @keydown.enter.prevent="emit('choose-base')"
      ><Icon icon="circle-help" size="xs" :interactive="false" />no base</span
    >
    <span
      v-if="state.base"
      ref="driftEl"
      class="abele-branch-codes__drift"
      :class="{ 'abele-branch-codes__drift_even': !state.ahead && !state.behind }"
      ><span :class="{ 'abele-branch-codes__on': state.ahead }"
        ><Icon icon="arrow-up" size="xs" :interactive="false" />{{ state.ahead }}</span
      ><span :class="{ 'abele-branch-codes__on': state.behind }"
        ><Icon icon="arrow-down" size="xs" :interactive="false" />{{ state.behind }}</span
      ></span
    >
    <span v-if="state.stopped" ref="stopEl" class="abele-branch-codes__stopped"
      ><Icon icon="triangle-alert" size="xs" color="red" :interactive="false" />{{
        state.stopped.conflicts
      }}</span
    >
    <span
      v-if="state.pr"
      ref="prEl"
      class="abele-branch-codes__pr"
      role="link"
      tabindex="0"
      @click="emit('open-pr')"
      @keydown.enter.prevent="emit('open-pr')"
      ><Icon :icon="prGlyph.icon" size="xs" :color="prGlyph.color" :interactive="false" />#{{
        state.pr.number
      }}<StatusDot
        v-if="state.pr.checks && state.pr.checks !== 'none'"
        :tone="checkTone"
        :pulse="state.pr.checks === 'pending'"
        :label="checkWords"
    /></span>
  </span>
</template>

<script setup lang="ts">
// The branch's codes, in one line: «← main ↑2 ↓1», a red triangle with the files still in
// conflict, the pull request's glyph and number with a dot for its checks. Used in the worktree's
// page header and, smaller, over the side panel's files, so both say it the same way.
import { computed, onMounted, ref, watch } from 'vue'
import { setTooltip } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import { plural } from './codes'
import type { BranchState } from './types'
import type { KitColor } from '@/constants/colors'

const props = withDefaults(
  defineProps<{
    state: BranchState
    branch: string
    size?: 'page' | 'panel'
    /** The base can be changed from here. */
    pickable?: boolean
  }>(),
  { size: 'page', pickable: false }
)
const emit = defineEmits<{
  (e: 'choose-base'): void
  (e: 'open-pr'): void
}>()

const prGlyph = computed((): { icon: string; color?: KitColor } => {
  switch (props.state.pr?.state) {
    case 'draft':
      return { icon: 'git-pull-request-draft' }
    case 'merged':
      return { icon: 'git-merge', color: 'purple' }
    case 'closed':
      return { icon: 'git-pull-request-closed', color: 'red' }
    default:
      return { icon: 'git-pull-request', color: 'green' }
  }
})
const checkTone = computed(() =>
  props.state.pr?.checks === 'failing'
    ? 'red'
    : props.state.pr?.checks === 'passing'
      ? 'green'
      : 'orange'
)
const checkWords = computed(
  () =>
    ({
      passing: 'Checks passed',
      failing: 'A check failed',
      pending: 'Checks are running',
      none: '',
    })[props.state.pr?.checks ?? 'none']
)

const baseEl = ref<HTMLElement>()
const driftEl = ref<HTMLElement>()
const stopEl = ref<HTMLElement>()
const prEl = ref<HTMLElement>()
function tips() {
  const s = props.state
  if (baseEl.value)
    setTooltip(
      baseEl.value,
      s.base
        ? `Compared with ${s.base}${props.pickable ? ' · click to compare with another branch' : ''}`
        : 'No branch to compare with was found · choose one'
    )
  if (driftEl.value)
    setTooltip(
      driftEl.value,
      !s.ahead && !s.behind
        ? `The same as ${s.base}`
        : `${plural(s.ahead, 'commit')} not in ${s.base} · ${s.base} has ${plural(s.behind, 'commit')} this branch has not`
    )
  if (stopEl.value && s.stopped)
    setTooltip(
      stopEl.value,
      `The ${s.stopped.kind} onto ${s.stopped.onto} stopped · ${plural(s.stopped.conflicts, 'file')} in conflict`
    )
  if (prEl.value && s.pr)
    setTooltip(
      prEl.value,
      `Pull request #${s.pr.number} · ${s.pr.state}${checkWords.value ? ` · ${checkWords.value.toLowerCase()}` : ''}${
        s.pr.review === 'changes'
          ? ' · changes requested'
          : s.pr.review === 'approved'
            ? ' · approved'
            : ''
      } · open it`
    )
}
onMounted(tips)
watch(() => [props.state, props.pickable], tips, { deep: true, flush: 'post' })
</script>

<style lang="scss">
.abele-branch-codes {
  display: inline-flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-4-1);
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  font-variant-numeric: tabular-nums;

  .abele-obsidian-icon {
    padding: 0;
  }
}
.abele-branch-codes_panel {
  font-size: var(--font-ui-smaller);
}
.abele-branch-codes__base,
.abele-branch-codes__drift > span,
.abele-branch-codes__stopped,
.abele-branch-codes__pr {
  display: inline-flex;
  align-items: center;
  gap: var(--size-2-1);
}
.abele-branch-codes__drift {
  display: inline-flex;
  gap: var(--size-4-2);
  color: var(--text-faint);
}
.abele-branch-codes__on {
  color: var(--text-muted);
}
.abele-branch-codes__base_none {
  color: var(--text-warning);
}
.abele-branch-codes__base_pick,
.abele-branch-codes__pr {
  // The patch under the pointer stands around the words, not over the neighbours: its sides are
  // the gap, and only the first chip reaches back to the line's edge.
  margin: calc(-1 * var(--size-2-1)) 0;
  padding: var(--size-2-1) var(--size-4-2);

  &:first-child {
    margin-left: calc(-1 * var(--size-4-2));
  }
  border-radius: var(--radius-s);
  cursor: var(--cursor);

  &:hover {
    background-color: var(--background-modifier-hover);
    color: var(--text-normal);
  }
}
.abele-branch-codes__stopped {
  margin-left: var(--size-4-2);
  color: var(--text-error);
}
.abele-branch-codes__pr {
  color: var(--text-normal);

  .abele-status-dot {
    margin-left: var(--size-2-1);
  }
}
</style>
