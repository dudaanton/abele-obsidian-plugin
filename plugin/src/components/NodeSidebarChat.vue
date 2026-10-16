<template>
  <!-- A node session as a tab of the sidebar chat: the node chat with where its agent works
       and the node's levers, which the node panel's model knows. -->
  <NodeChatView
    :presenter="presenter"
    v-bind="placeProps"
    :open-node-resource="openResource"
    @new-chat="emit('new-chat')"
    @choose-worktree="chooseWorktree"
    @start-with="startWith"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { Notice } from 'obsidian'
import NodeChatView from './NodeChatView.vue'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import type { NodePathModel, PathTarget } from '@/node/NodePathModel'
import { NodePathService } from '@/node/NodePathService'
import { nodeChatPlace, openNodeChatResource } from '@/node/nodeChatPlace'
import type { AgentChoice } from '@/node/providers'

const props = defineProps<{ presenter: NodeChatPresenter }>()
const emit = defineEmits<{ (e: 'new-chat'): void }>()

/** The node panel's model of this node; none while the node's registration cannot be read. */
const model = (() => {
  try {
    return NodePathService.getInstance().model(props.presenter.reference.registrationId)
  } catch (error) {
    console.debug('[Abele node] no place for the chat', error)
    return null
  }
})()
// The panel may never have been opened on this device: its folders name the place.
if (model && !model.folders.value.length) void model.refresh().catch(() => {})
const place = model ? nodeChatPlace(props.presenter, model) : null
const placeProps = computed(() => {
  const p = place?.value
  if (!p) return {}
  return {
    worktree: p.worktree,
    folder: p.folder,
    canSwitchWorktree: p.canSwitchWorktree,
    canSwitchNative: p.canSwitchNative,
    currentTarget: p.currentTarget,
    switches: p.switches,
  }
})
const report = (error: unknown) =>
  new Notice(error instanceof Error ? error.message : 'The node could not do that')
const openResource = (resource: string, bound?: PathTarget) => {
  const target = bound ?? place?.value.target
  if (target) void openNodeChatResource(resource, target).catch(report)
  else props.presenter.openResource(resource)
}
const withModel = (run: (m: NodePathModel) => Promise<unknown> | void) => {
  if (!model) return report(new Error('Reconnect this node from the Node panel first.'))
  void Promise.resolve(run(model)).catch(report)
}
const chooseWorktree = () =>
  withModel(async (m) => {
    const { chooseSessionWorktree } = await import('@/node/NodePathController')
    await chooseSessionWorktree(m, props.presenter.reference.sessionId)
  })
const startWith = (choice: AgentChoice) =>
  withModel(async (m) => {
    const target = place?.value.target
    if (!target) throw new Error('Choose a folder for the new chat in the Node panel.')
    const { startNodePathChat } = await import('@/node/NodePathController')
    startNodePathChat(m, target, choice)
  })
</script>
