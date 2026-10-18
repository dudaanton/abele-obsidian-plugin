<template>
  <div class="abele-node-refusal" :class="{ 'abele-node-refusal_given': given }">
    <!-- Under a refused node call: what was missing, by name, and the one thing that lets the
         agent through — given here, so nobody has to find the access dialog and rebuild the
         place from a node, a folder and a branch by hand. -->
    <Icon :icon="given ? 'check' : ICONS[refusal.kind]" size="xs" :interactive="false" />
    <span ref="textEl" class="abele-node-refusal__text">{{ text }}</span>
    <Button
      v-if="!given && action"
      class="abele-node-refusal__action"
      :text="action"
      :tooltip="actionTooltip"
      :disabled="refusal.kind === 'not-approved' && !namedInTime"
      @click="emit('act', refusal, refusal.kind === 'not-approved' ? named : undefined)"
    />
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
import { computed, ref, watch, watchEffect } from 'vue'
import { setTooltip } from 'obsidian'
import Icon from '../obsidian/Icon.vue'
import Button from '../obsidian/Button.vue'
import type { NodeAccessRefusal } from '@/ai/tools/node/accessRefusal'
import type { NodeScopeEntry } from '@/ai/nodeScope'
import { nodeScopeNames, nodeScopeTitle, type NodeScopeNames } from '@/ai/tools/node/scopeNames'

const props = defineProps<{
  refusal: NodeAccessRefusal
  /** The chat has since been given what the call wanted. */
  given?: boolean
  /** For a missing approval: the places its button confirms, named before it is pressed. */
  approves?: NodeScopeEntry[]
}>()
const emit = defineEmits<{
  /** For a missing approval, with the entries the line named: exactly those are confirmed. */
  (e: 'act', refusal: NodeAccessRefusal, named?: NodeScopeEntry[]): void
}>()

const ICONS: Record<NodeAccessRefusal['kind'], string> = {
  'no-access': 'folder-lock',
  'not-approved': 'shield-alert',
  'no-worktree': 'git-branch',
  offline: 'server-off',
}

const names = ref<NodeScopeNames>({ node: props.refusal.node_id })
watch(
  () => props.refusal,
  async (r) => (names.value = r.node_id ? await nodeScopeNames(r) : { node: '' }),
  { immediate: true }
)
const place = computed(() => nodeScopeTitle(names.value))
/** What Approve would confirm, each place by name with what it allows. */
const approving = ref<string[]>([])
/** The entries those names belong to; the button waits until they are the current ones. */
const named = ref<NodeScopeEntry[]>([])
const namedInTime = computed(
  () => JSON.stringify(named.value) === JSON.stringify(props.approves ?? [])
)
let naming = 0
watch(
  () => props.approves,
  async (list) => {
    const turn = ++naming,
      entries = [...(list ?? [])]
    const said = await Promise.all(
      entries.map(
        async (e) =>
          `${nodeScopeTitle(await nodeScopeNames(e))}, ${e.access === 'edit' ? t('streamB.readAndEdit.4067e8') : t('streamBMeta.3316348dba')}`
      )
    )
    if (turn !== naming) return
    approving.value = said
    named.value = entries
  },
  { immediate: true }
)

const text = computed(() => {
  const r = props.refusal,
    n = names.value
  if (props.given) return t('streamB.accessGivenAskTheAgentToTry.160b85')
  if (r.kind === 'no-access' && !r.node_id) return t('streamB.thisChatHasNoNodeAccess.4bde3f')
  if (r.kind === 'no-access')
    return r.access === 'edit'
      ? t('streamBMeta.641c6cacec', { place: place.value, node: n.node })
      : t('streamBMeta.c6598f664c', { place: place.value, node: n.node })
  if (r.kind === 'not-approved')
    return approving.value.length
      ? t('streamB.notApprovedOnThisDevice.fbb3a1', { v0: String(approving.value.join(' · ')) })
      : t('streamB.notApprovedOnThisDevice.f3612d')
  if (r.kind === 'no-worktree')
    return t('streamB.hasNoWorktreeNamed.602aac', {
      v0: String(n.folder ?? place.value),
      v1: String(r.wanted ?? t('streamBMeta.8e7fc0236a')),
    })
  return t('streamB.theNodeIsNotConnected.16c387', { v0: String(n.node) })
})
// A worktree that is not there: the tooltip says which ones are.
const textEl = ref<HTMLElement | null>(null)
watchEffect(() => {
  const known = props.refusal.kind === 'no-worktree' ? (props.refusal.known ?? []) : []
  if (textEl.value && known.length)
    setTooltip(textEl.value, t('streamB.worktreesThere.cddd03', { v0: String(known.join(', ')) }))
})
const action = computed(() =>
  props.refusal.kind === 'no-access'
    ? t('streamB.giveThisChatAccess.8eaead')
    : props.refusal.kind === 'not-approved'
      ? t('streamB.approveOnThisDevice.e68f82')
      : props.refusal.kind === 'offline'
        ? t('streamB.openTheNodePanel.489e2d')
        : ''
)
const actionTooltip = computed(() =>
  props.refusal.kind === 'no-access'
    ? props.refusal.node_id
      ? t('streamB.openThisChatSNodeAccessWith.91b58c', { v0: String(place.value) })
      : t('streamB.openThisChatSNodeAccess.6a8fb4')
    : props.refusal.kind === 'not-approved'
      ? t('streamB.thisChatSNodeAccessCameFrom.935985')
      : t('streamB.connectOrWakeTheNode.0e8fa4')
)
</script>

<style lang="scss">
// A quiet line under the call, as its error is: the reason by name, then the way through.
.abele-node-refusal {
  display: grid;
  grid-template-columns: auto minmax(0, 1fr);
  align-items: baseline;
  gap: var(--size-2-2) var(--size-2-3);
  margin-block: var(--size-2-1);
  font-size: var(--font-ui-smaller);
  color: var(--text-muted);

  > .abele-obsidian-icon {
    align-self: center;
    color: var(--text-error);
  }

  &_given > .abele-obsidian-icon {
    color: var(--text-success);
  }
}

.abele-node-refusal__text {
  min-width: 0;
}

// The way through under the words it answers, as wide as its own words.
.abele-node-refusal__action {
  grid-column: 2;
  justify-self: start;
}

// A phone has the row's whole width to press.
body.is-phone .abele-node-refusal__action {
  justify-self: stretch;
}
</style>
