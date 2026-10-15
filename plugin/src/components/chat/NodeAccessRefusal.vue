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
      @click="emit('act', refusal)"
    />
  </div>
</template>

<script setup lang="ts">
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
const emit = defineEmits<{ (e: 'act', refusal: NodeAccessRefusal): void }>()

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
watch(
  () => props.approves,
  async (list) =>
    (approving.value = await Promise.all(
      (list ?? []).map(
        async (e) =>
          `${nodeScopeTitle(await nodeScopeNames(e))}, ${e.access === 'edit' ? 'read and edit' : 'read'}`
      )
    )),
  { immediate: true }
)

const text = computed(() => {
  const r = props.refusal,
    n = names.value
  if (props.given) return 'Access given. Ask the agent to try again'
  if (r.kind === 'no-access' && !r.node_id) return 'This chat has no node access'
  if (r.kind === 'no-access')
    return `No ${r.access === 'edit' ? 'edit ' : ''}access to ${place.value} on the ${n.node} node`
  if (r.kind === 'not-approved')
    return approving.value.length
      ? `Not approved on this device: ${approving.value.join(' · ')}`
      : 'Not approved on this device'
  if (r.kind === 'no-worktree')
    return `${n.folder ?? place.value} has no worktree named ${r.wanted ?? 'that'}`
  return `The ${n.node} node is not connected`
})
// A worktree that is not there: the tooltip says which ones are.
const textEl = ref<HTMLElement | null>(null)
watchEffect(() => {
  const known = props.refusal.kind === 'no-worktree' ? (props.refusal.known ?? []) : []
  if (textEl.value && known.length) setTooltip(textEl.value, `Worktrees there: ${known.join(', ')}`)
})
const action = computed(() =>
  props.refusal.kind === 'no-access'
    ? 'Give this chat access'
    : props.refusal.kind === 'not-approved'
      ? 'Approve on this device'
      : props.refusal.kind === 'offline'
        ? 'Open the Node panel'
        : ''
)
const actionTooltip = computed(() =>
  props.refusal.kind === 'no-access'
    ? props.refusal.node_id
      ? `Open this chat's Node access with ${place.value} chosen`
      : "Open this chat's Node access"
    : props.refusal.kind === 'not-approved'
      ? 'This chat’s node access came from another device; confirm these places here'
      : 'Connect or wake the node'
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
