<template>
  <!-- A node session as a tab of the sidebar chat: the node chat with where its agent works
       and the node's levers, which the node panel's model knows. -->
  <NodeChatView
    :presenter="presenter"
    :rename-in-tree="renameInTree"
    v-bind="placeProps"
    :open-node-resource="openResource"
    @new-chat="emit('new-chat')"
    @choose-worktree="chooseWorktree"
    @start-with="startWith"
  >
    <template #lead
      ><DrawerViewSwitch v-if="!phone" icon="bot" :name="t('streamB.abeleAiChat.08f891')"
    /></template>
    <template #navigation
      ><ChatSwitcher :title="presenter.label.value" :location="nodeLabel"
    /></template>
  </NodeChatView>
</template>

<script setup lang="ts">
import { nodeErrorNotice } from '@/node/errorNotice'
import { t } from '@/i18n'
import { useChatTreeSource } from '@/chats/chatTree'
import { ChatService } from '@/ai/ChatService'
import { Platform } from 'obsidian'
import DrawerViewSwitch from '@/components/obsidian/DrawerViewSwitch.vue'
import { computed } from 'vue'
import NodeChatView from './NodeChatView.vue'
import ChatSwitcher from './chatTree/ChatSwitcher.vue'
import type { NodeChatPresenter } from '@/node/NodeChatPresenter'
import type { NodePathModel, PathTarget } from '@/node/NodePathModel'
import { NodePathService } from '@/node/NodePathService'
import { NodeService } from '@/node/NodeService'
import { nodeChatPlace, openNodeChatResource } from '@/node/nodeChatPlace'
import type { AgentChoice } from '@/node/providers'

const props = defineProps<{ presenter: NodeChatPresenter }>()
const treeSource = useChatTreeSource()
const renameInTree = () => {
  treeSource.value?.rename(props.presenter.id)
  ChatService.getInstance().treeRequest.value++
}
const emit = defineEmits<{ (e: 'new-chat'): void }>()
const phone = Platform.isPhone
const nodeLabel = computed(() => {
  try {
    return (
      NodeService.getInstance().nodes.value.find(
        (node) => node.id === props.presenter.reference.registrationId
      )?.label ?? t('streamB.node.e93372')
    )
  } catch {
    return t('streamB.node.e93372')
  }
})

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
const report = (error: unknown) => nodeErrorNotice(error, t('streamB.theNodeCouldNotDoThat.89c955'))
const openResource = (resource: string, bound?: PathTarget) => {
  const target = bound ?? place?.value.target
  if (target) void openNodeChatResource(resource, target).catch(report)
  else props.presenter.openResource(resource)
}
const withModel = (run: (m: NodePathModel) => Promise<unknown> | void) => {
  if (!model) return report(new Error(t('streamB.reconnectThisNodeFromTheNodePanel.04c245')))
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
    if (!target) throw new Error(t('streamB.chooseAFolderForTheNewChat.da4144'))
    const { startNodePathChat } = await import('@/node/NodePathController')
    startNodePathChat(m, target, choice)
  })
</script>
