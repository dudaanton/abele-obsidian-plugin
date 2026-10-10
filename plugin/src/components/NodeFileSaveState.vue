<template>
  <div class="abele-node-save" aria-label="File save state">
    <div class="abele-node-save__actions">
      <Button
        v-if="!model.editing.value"
        text="Edit file"
        tooltip="Start a local draft from the loaded file"
        icon="pencil"
        :disabled="locked || busy || !model.fileEditable.value || !!model.draft.value?.pending"
        @click="act(() => model.beginEditing())"
      />
      <Button
        v-else-if="model.draft.value?.pending"
        text="Check save"
        tooltip="Check the original save operation without creating a new save"
        icon="refresh-cw"
        :disabled="busy || offline"
        @click="act(() => model.checkSave())"
      />
      <Button
        v-else
        text="Save file"
        tooltip="Save this draft using its original content identity"
        icon="save"
        :disabled="
          locked ||
          busy ||
          !model.draftDirty.value ||
          !!model.draftError.value ||
          model.draft.value?.status === 'conflict'
        "
        @click="act(() => model.saveFile())"
      />
      <Icon
        v-if="!needsChoice"
        class="clickable-icon"
        icon="refresh-cw"
        tooltip="Reload current version"
        role="button"
        tabindex="0"
        :disabled="busy || offline || !model.canReloadDraft.value || !!model.draft.value?.pending"
        @click="reload"
        @keydown.enter.prevent="reload"
      />
      <Icon
        v-if="!needsChoice && model.draft.value && !model.draft.value.pending"
        class="clickable-icon"
        icon="undo-2"
        tooltip="Discard local draft"
        role="button"
        tabindex="0"
        :disabled="busy || !!model.draftError.value"
        @click="act(() => model.discardDraft())"
        @keydown.enter.prevent="act(() => model.discardDraft())"
      />
    </div>
    <div v-if="needsChoice" class="abele-node-save__state" role="status">
      <span>{{
        error ||
        model.draftError.value ||
        (model.draft.value?.status === 'conflict'
          ? 'Conflict · on disk.'
          : 'Changed on disk.')
      }}</span>
      <Button
        text="Reload"
        tooltip="Discard my draft and load the version now on disk"
        :disabled="busy || offline || !model.canReloadDraft.value"
        @click="reload"
      />
      <Button
        text="Keep mine"
        tooltip="Keep my text and base the next Save on the version now on disk"
        :disabled="locked || busy || offline || !!model.draftError.value || !model.draft.value"
        @click="keepMine"
      />
    </div>
    <span v-else-if="error || model.draftError.value" role="alert">{{
      error || model.draftError.value
    }}</span>
    <span v-else-if="model.draft.value?.pending" role="alert"
      >Save outcome unknown · keep this draft. Reconnect and check the same save; do not submit it
      again. Inspect the retained predecessor before recovery.</span
    >
    <span v-else-if="model.draft.value?.status === 'rejected'" role="alert"
      >Save rejected · {{ model.draft.value.error }}. Your local draft is retained.</span
    >
    <span v-else-if="model.draft.value?.status === 'saved' && !model.draftDirty.value" role="status"
      >Saved · the node confirmed this version. External editors may change it afterwards.</span
    >
    <span v-else-if="model.editing.value && model.draft.value" role="status"
      >Unsent edit · stored only on this device. Save uses the version you started from.</span
    >
    <details v-if="model.draft.value?.result">
      <summary>Save receipt and retained predecessor</summary>
      <div class="abele-node-save__receipt">
        Operation · {{ model.draft.value.result.operation_id }}<br />Outcome ·
        {{ model.draft.value.result.state }}<br />
        Predecessor · {{ model.draft.value.result.predecessor_content_id || 'See recovery path' }}
        <template v-if="model.draft.value.result.recovery_path"
          ><br />Recovery copy · node storage ·
          {{ model.draft.value.result.recovery_path }}</template
        >
      </div>
      <Button
        v-if="model.draft.value.result.predecessor_content_id"
        text="Read retained predecessor"
        tooltip="Read the retained bytes from before the save"
        :disabled="busy || offline"
        @click="act(() => model.readPredecessor())"
      />
      <GithubCode
        v-if="model.predecessorText.value !== undefined"
        :text="model.predecessorText.value"
        :path="model.filePath.value"
      />
    </details>
  </div>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'
import type { NodeFilesModel } from '@/node/NodeFilesModel'
import type { FileDraftSnapshot } from '@/node/fileDrafts'
import { confirmAction } from '@/modal/confirm'
import { GlobalStore } from '@/stores/GlobalStore'
import Button from './obsidian/Button.vue'
import Icon from './obsidian/Icon.vue'
import GithubCode from './github/GithubCode.vue'
const props = defineProps<{
  model: NodeFilesModel
  offline?: boolean
  locked?: boolean
  changedOnDisk?: boolean
  reload?: (shown: FileDraftSnapshot | null) => Promise<unknown>
  keepMine?: (shown: FileDraftSnapshot | null) => Promise<unknown>
}>()
const busy = ref(false),
  error = ref('')
const emit = defineEmits<{ reconciled: [] }>()
const needsChoice = computed(
  () =>
    !props.model.draft.value?.pending &&
    (props.changedOnDisk ||
      props.model.draft.value?.status === 'conflict' ||
      (!!props.model.draft.value &&
        props.model.draft.value.status !== 'saved' &&
        props.model.document.value?.contentId !== props.model.draft.value.baseContentId))
)
async function act(work: () => Promise<unknown>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await work()
  } catch (e) {
    error.value = e instanceof Error ? e.message : String(e)
  } finally {
    busy.value = false
  }
}
const reload = () =>
  act(async () => {
    const model = props.model,
      path = model.filePath.value,
      shown = model.draftSnapshot()
    const hasChanges =
      model.draftDirty.value ||
      ((!model.draft.value || model.draft.value.status !== 'saved') &&
        model.draftText.value !== model.document.value?.text)
    if (
      hasChanges &&
      !(await confirmAction(GlobalStore.getInstance().app, {
        title: 'Discard local draft?',
        message: `Discard your unsaved text in ${path} and load the version now on disk?`,
        confirmText: 'Reload',
        confirmTooltip: 'Discard the local draft and read the file from the node',
      }))
    )
      return
    if (path !== model.filePath.value) throw new Error('File view changed before reload')
    await (props.reload ? props.reload(shown) : model.reloadCurrent(shown))
    emit('reconciled')
  })
const keepMine = () =>
  act(async () => {
    const shown = props.model.draftSnapshot()
    await (props.keepMine ? props.keepMine(shown) : props.model.keepMine(shown))
    emit('reconciled')
  })
</script>
<style lang="scss">
.abele-node-save {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--size-4-2);
  min-width: 0;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  &__state {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--size-4-2);
  }
  &__actions {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--size-4-2);
  }
  &__receipt {
    overflow-wrap: anywhere;
    padding-block: var(--size-4-2);
  }
  details {
    width: 100%;
    min-width: 0;
  }
}
body.is-phone .abele-node-save summary {
  min-height: calc(var(--size-4-10) + var(--size-4-1));
  padding-block: var(--size-4-2);
  box-sizing: border-box;
  align-content: center;
}
body.is-phone .abele-node-save .clickable-icon {
  min-width: calc(var(--size-4-10) + var(--size-4-1));
  min-height: calc(var(--size-4-10) + var(--size-4-1));
}
</style>
