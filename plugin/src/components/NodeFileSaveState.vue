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
        class="clickable-icon"
        icon="refresh-cw"
        tooltip="Reload current version"
        role="button"
        tabindex="0"
        :disabled="busy || offline || !model.canReloadDraft.value"
        @click="reload"
        @keydown.enter.prevent="reload"
      />
      <Icon
        v-if="model.draft.value && !model.draft.value.pending"
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
    <span v-if="error || model.draftError.value" role="alert">{{
      error || model.draftError.value
    }}</span>
    <span v-else-if="model.draft.value?.pending" role="alert"
      >Save outcome unknown · keep this draft. Reconnect and check the same save; do not submit it
      again. Inspect the retained predecessor before recovery.</span
    >
    <span v-else-if="model.draft.value?.status === 'conflict'" role="alert"
      >Conflict · the workspace changed. Your local draft is retained and was not applied. Reload
      and inspect the current version before choosing a new base.</span
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
    <Button
      v-if="
        model.draft.value &&
        !model.draft.value.pending &&
        (model.draft.value.status === 'conflict' ||
          model.document.value?.contentId !== model.draft.value.baseContentId)
      "
      text="Use loaded version as base for this draft"
      tooltip="Keep this draft and use the loaded disk version as its new save precondition"
      :disabled="locked || busy || !model.fileEditable.value"
      @click="act(() => model.rebaseDraft())"
    />
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
import { ref } from 'vue'
import type { NodeFilesModel } from '@/node/NodeFilesModel'
import Button from './obsidian/Button.vue'
import Icon from './obsidian/Icon.vue'
import GithubCode from './github/GithubCode.vue'
const props = defineProps<{
  model: NodeFilesModel
  offline?: boolean
  locked?: boolean
  reload?: () => Promise<unknown>
}>()
const busy = ref(false),
  error = ref('')
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
  act(() => (props.reload ? props.reload() : props.model.openFile(props.model.filePath.value)))
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
