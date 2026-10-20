<template>
  <Section :title="t('settings.nodes.title')" :desc="t('settings.nodes.description')">
    <!-- A node as one row: its state as a dot, check, open; the rarer things in ⋯. -->
    <Setting
      v-for="node in service.nodes.value"
      :key="node.id"
      :name="node.label"
      :desc="nodeLine(node)"
      :title="service.connection(node.id).error.value || undefined"
    >
      <StatusDot
        :tone="stateTone(service.connection(node.id).state.value)"
        :label="stateLabel(service.connection(node.id).state.value)"
      />
      <Icon icon="refresh-cw" :tooltip="t('settings.nodes.check')" @click="check(node.id)" />
      <Button
        :text="t('settings.nodes.open')"
        :tooltip="t('settings.nodes.openTip')"
        @click="open(node)"
      />
      <Icon
        icon="more-horizontal"
        :tooltip="t('settings.nodes.more')"
        @click="more($event, node)"
      />
    </Setting>
    <!-- Adding a node is a row like the nodes: what it is, and the one button that starts it. -->
    <Setting :name="t('settings.nodes.pairTitle')" :desc="t('settings.nodes.pairDesc')">
      <Button
        :text="t('settings.nodes.pair')"
        :tooltip="t('settings.nodes.pairTip')"
        @click="showPairing()"
      />
    </Setting>
    <Setting :name="t('settings.nodes.addTitle')" :desc="t('settings.nodes.addDesc')">
      <Button
        :text="t('settings.nodes.add')"
        :tooltip="t('settings.nodes.addTip')"
        data-testid="node-settings-add-local"
        @click="addingLocal = true"
      />
    </Setting>
    <Setting :name="t('settings.nodes.traceTitle')" :desc="t('settings.nodes.traceDesc')">
      <Input
        :model-value="traceNotesFolder"
        :placeholder="t('settings.nodes.traceExample')"
        :aria-label="t('settings.nodes.traceFolder')"
        :suggester="FolderSuggest"
        @update:model-value="updateTraceNotesFolder"
      />
      <Button
        v-if="Platform.isDesktopApp"
        icon="folder-open"
        :tooltip="t('settings.nodes.chooseFolderTip')"
        :aria-label="t('settings.nodes.chooseFolder')"
        @click="chooseTraceNotesFolder"
      />
    </Setting>
    <DebuggerGrantsDialog
      v-if="debuggerGrantNode"
      :label="debuggerGrantNode.label"
      :connection="service.connection(debuggerGrantNode.id)"
      @close="debuggerGrantNode = undefined"
    />
    <NodePairingDialog
      v-if="pairing"
      :service="service"
      :resume-node-id="resumeNodeId"
      @close="pairing = false"
    />
    <!-- What the last check, open or add said, under the list it was about. -->
    <p v-if="message && !addingLocal" class="setting-item-description" role="status">
      <NodeErrorText :error="message" />
    </p>
    <ObsidianModal
      v-if="addingLocal"
      :title="t('settings.nodes.addTitle')"
      modal-class="abele-node-settings-local-dialog"
      @close="addingLocal = false"
    >
      <Setting :name="t('settings.nodes.name')" :desc="t('settings.nodes.nameDesc')">
        <Input
          v-model="label"
          :placeholder="t('settings.nodes.localPlaceholder')"
          :aria-label="t('settings.nodes.label')"
        />
      </Setting>
      <Setting :name="t('settings.nodes.address')" :desc="t('settings.nodes.addressDesc')">
        <Input
          v-model="url"
          placeholder="http://127.0.0.1:7777"
          :aria-label="t('settings.nodes.url')"
        />
      </Setting>
      <Setting :name="t('settings.nodes.token')" :desc="t('settings.nodes.tokenDesc')">
        <Input
          v-model="token"
          password
          :placeholder="t('settings.nodes.pasteToken')"
          :aria-label="t('settings.nodes.installationToken')"
        />
      </Setting>
      <p v-if="message" class="setting-item-description" role="status">
        <NodeErrorText :error="message" />
      </p>
      <template #footer>
        <div class="abele-modal__actions">
          <Button
            :text="t('settings.nodes.cancel')"
            :tooltip="t('settings.nodes.cancelTip')"
            data-testid="node-settings-local-cancel"
            @click="addingLocal = false"
          />
          <Button
            :text="t('settings.nodes.add')"
            accent
            :tooltip="t('settings.nodes.authenticateTip')"
            :disabled="busy || !label.trim() || !token.trim()"
            @click="add"
          />
        </div>
      </template>
    </ObsidianModal>
  </Section>
</template>

<script setup lang="ts">
import { nodeErrorWords } from '@/node/errorWords'
import NodeErrorText from '@/components/NodeErrorText.vue'
import { useI18n } from '@/i18n/useI18n'
import { ref } from 'vue'
import { ChatService } from '@/ai/ChatService'
import { NodeService } from '@/node/NodeService'
import { isPairedNode } from '@/node/NodeRegistry'
import { claimedEnrollment } from '@/node/NodeDeviceKeyStore'
import NodePairingDialog from '../NodePairingDialog.vue'
import DebuggerGrantsDialog from '@/debugger/DebuggerGrantsDialog.vue'
import { pickNodeSession } from '@/node/openSession'
import type { RegisteredNode } from '@/node/NodeRegistry'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Input from '../obsidian/Input.vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import ObsidianModal from '../obsidian/Modal.vue'
import { Menu, Platform, debounce } from 'obsidian'
import { FolderSuggest } from '@/helpers/suggesters/FolderSuggester'
import { chooseOutsideFolder, notesFolder } from '@/debugger/trace/notesFolder'
import { AbeleConfig } from '@/services/AbeleConfig'
import { GlobalStore } from '@/stores/GlobalStore'
const { t } = useI18n()
const service = NodeService.getInstance()
const config = AbeleConfig.getInstance()
const traceNotesFolder = ref(config.traceNotesFolder)
const saveTraceNotesFolder = debounce(async (value: string) => {
  config.traceNotesFolder = value.trim()
  await config.saveSettings()
}, 500)
const updateTraceNotesFolder = (value: string) => {
  traceNotesFolder.value = value
  saveTraceNotesFolder(value)
}
const chooseTraceNotesFolder = async () => {
  const chosen = await chooseOutsideFolder()
  if (!chosen) return
  // A folder picked inside the vault is kept as the vault's own path, so it travels as one.
  const adapter = GlobalStore.getInstance().app.vault.adapter as { getBasePath?: () => string }
  const folder = notesFolder(chosen, adapter.getBasePath?.())
  updateTraceNotesFolder(folder.kind === 'vault' && folder.path ? folder.path : chosen)
}
const debuggerGrantNode = ref<RegisteredNode>()
const pairing = ref(false)
const resumeNodeId = ref<string>()
const showPairing = (nodeId?: string) => {
  resumeNodeId.value = nodeId
  pairing.value = true
}
const label = ref('Local node')
const url = ref('http://127.0.0.1:7777')
const token = ref('')
const busy = ref(false)
const message = ref('')
const report = (error: unknown) => {
  message.value = error instanceof Error ? error.message : t('settings.nodes.unavailable')
}
const add = async () => {
  busy.value = true
  message.value = ''
  try {
    await service.add(label.value.trim(), url.value.trim(), token.value.trim())
    token.value = ''
    message.value = t('settings.nodes.added')
    addingLocal.value = false
  } catch (error) {
    report(error)
  } finally {
    busy.value = false
  }
}
const check = async (id: string) => {
  try {
    const node = service.nodes.value.find((n) => n.id === id)
    const expected =
      node && isPairedNode(node)
        ? claimedEnrollment(await service.deviceKeys.load(node.expectedNodeId))
        : undefined
    await service.connection(id).connect()
    if (
      node &&
      isPairedNode(node) &&
      expected &&
      expected.endpoint === node.url &&
      expected.node_fingerprint === node.nodeFingerprint &&
      expected.installation_id === node.installationId
    )
      await service.deviceKeys.finishEnrollment(node.expectedNodeId, expected)
    message.value = t('settings.nodes.connected')
  } catch (error) {
    report(error)
  }
}
const open = async (node: RegisteredNode) => {
  try {
    await pickNodeSession(node)
  } catch (error) {
    report(error)
  }
}
const stateTone = (state: string) =>
  state === 'connected' ? 'green' : state === 'connecting' ? 'orange' : 'red'
/** The add window for the node on this computer. */
const addingLocal = ref(false)

/** Under a node's name: how it is in words, then where it is; a code from the node in words too. */
const nodeLine = (node: RegisteredNode) => {
  const conn = service.connection(node.id)
  const error = conn.error.value ? nodeErrorWords(conn.error.value) : ''
  return [error || stateLabel(conn.state.value), node.url].join(' · ')
}

const stateLabel = (state: string) =>
  state === 'connected'
    ? t('settings.nodes.connected')
    : state === 'connecting'
      ? t('settings.nodes.connecting')
      : t('settings.nodes.disconnected')

const more = (event: MouseEvent, node: RegisteredNode) => {
  const menu = new Menu()
  if (isPairedNode(node))
    menu.addItem((i) =>
      i
        .setTitle(t('settings.nodes.repair'))
        .setIcon('link')
        .onClick(() => showPairing(node.expectedNodeId))
    )
  menu.addSeparator()
  menu.addItem((i) =>
    i
      .setTitle(t('debuggerAccess.title'))
      .setIcon('bug')
      .onClick(() => {
        debuggerGrantNode.value = node
      })
  )
  menu.addItem((i) =>
    i
      .setTitle(t('settings.nodes.remove'))
      .setIcon('trash-2')
      .setWarning(true)
      .onClick(() => remove(node.id))
  )
  menu.showAtMouseEvent(event)
}

const remove = async (id: string) => {
  const chats = ChatService.getInstance()
  for (const tab of [...chats.tabOrder.value])
    if (chats.getNodeSession(tab)?.reference.registrationId === id) await chats.closeTab(tab)
  service.remove(id)
  message.value = t('settings.nodes.removed')
}
</script>
