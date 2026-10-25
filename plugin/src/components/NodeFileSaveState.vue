<template>
  <div class="abele-node-save" :aria-label="t('streamB.fileSaveState.5e9528')">
    <!-- Where the tab's header saves and discards, only an unresolved save keeps its check here. -->
    <div v-if="actions || model.draft.value?.pending" class="abele-node-save__actions">
      <Button
        v-if="!model.editing.value"
        :text="t('streamB.editFile.9608dd')"
        :tooltip="t('streamB.startALocalDraftFromTheLoaded.a1f50f')"
        icon="pencil"
        :disabled="locked || busy || !model.fileEditable.value || !!model.draft.value?.pending"
        @click="act(() => model.beginEditing())"
      />
      <Button
        v-else-if="model.draft.value?.pending"
        :text="t('streamB.checkSave.7d4382')"
        :tooltip="t('streamB.checkTheOriginalSaveOperationWithoutCreating.3e35d0')"
        icon="refresh-cw"
        :disabled="busy || offline"
        @click="act(() => model.checkSave())"
      />
      <Button
        v-else
        :text="t('streamB.saveFile.2a6f7e')"
        :tooltip="t('streamB.saveThisDraftUsingItsOriginalContent.2ae727')"
        icon="save"
        :disabled="
          locked ||
          offline ||
          busy ||
          !model.draftDirty.value ||
          !!presentUiField(model.draftError, 'value') ||
          model.draft.value?.status === 'conflict'
        "
        @click="act(() => model.saveFile())"
      />
      <Icon
        v-if="!needsChoice"
        class="clickable-icon"
        icon="refresh-cw"
        :tooltip="t('streamB.reloadCurrentVersion.6ac0f0')"
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
        :tooltip="t('streamB.discardLocalDraft.ab60bd')"
        role="button"
        tabindex="0"
        :disabled="busy || !!presentUiField(model.draftError, 'value')"
        @click="act(() => model.discardDraft())"
        @keydown.enter.prevent="act(() => model.discardDraft())"
      />
    </div>
    <div v-if="needsChoice" class="abele-node-save__state" role="status">
      <span class="abele-node-save__conflict-message">
        <StatusDot v-if="!actions" tone="orange" :label="t('streamB.nodeChangedWhileEditing')" />
        {{
          error ||
          presentUiField(model.draftError, 'value') ||
          (!actions
            ? t('streamB.nodeChangedWhileEditing')
            : model.draft.value?.status === 'conflict'
              ? t('streamB.conflictOnDisk.6a2045')
              : t('streamB.changedOnDisk.c12f35'))
        }}</span
      >
      <Button
        :text="actions ? t('streamB.reload.bdc090') : t('streamB.useTheirs')"
        :tooltip="t('streamB.discardMyDraftAndLoadTheVersion.3d7ebf')"
        :disabled="busy || offline || !model.canReloadDraft.value"
        @click="reload"
      />
      <Button
        :text="t('streamB.keepMine.0335c8')"
        :tooltip="t('streamB.keepMyTextAndBaseTheNext.792ea5')"
        :disabled="
          locked ||
          busy ||
          offline ||
          !!presentUiField(model.draftError, 'value') ||
          !model.draft.value
        "
        @click="keepMine"
      />
    </div>
    <span v-else-if="error || model.draftError.value" role="alert"
      ><NodeErrorText :error="error || model.draftError.value"
    /></span>
    <span v-else-if="model.draft.value?.pending" role="alert">{{
      t('streamB.saveOutcomeUnknownKeepThisDraftReconnect.8ce6f7')
    }}</span>
    <span v-else-if="model.draft.value?.status === 'rejected'" role="alert"
      >{{ t('streamB.saveRejected.be1e12') }} <NodeErrorText :error="model.draft.value.error" />{{
        t('streamB.yourLocalDraftIsRetained.49b72f')
      }}</span
    >
    <span
      v-else-if="
        model.draft.value?.status === 'saved' &&
        model.document.value?.contentId !== model.draft.value.baseContentId
      "
      role="status"
      >{{ t('streamB.changedOnDisk.c12f35') }}</span
    >
    <span
      v-else-if="model.draft.value?.status === 'saved' && !model.draftDirty.value"
      role="status"
      >{{ t('streamB.savedTheNodeConfirmedThisVersionExternal.f4f869') }}</span
    >
    <span v-else-if="actions && model.editing.value && model.draftDirty.value" role="status">{{
      t('streamB.unsentEditStoredOnlyOnThisDevice.49091f')
    }}</span>
    <Disclosure
      v-if="model.draft.value?.result"
      v-model="receiptOpen"
      :label="t('streamB.saveReceiptAndRetainedPredecessor.25d4a8')"
    >
      <div class="abele-node-save__receipt">
        {{ t('streamBMeta.76be2c0593', { p0: String(model.draft.value.result.operation_id) })
        }}<br />{{ t('streamBMeta.f6c522a17e', { p0: String(model.draft.value.result.state) })
        }}<br />
        {{
          t('streamBMeta.128c2c42e3', {
            p0: String(
              model.draft.value.result.predecessor_content_id || t('streamB.seeRecoveryPath.496219')
            ),
          })
        }}
        <template v-if="model.draft.value.result.recovery_path"
          ><br />{{
            t('streamBMeta.3d39268985', { p0: String(model.draft.value.result.recovery_path) })
          }}</template
        >
      </div>
      <Button
        v-if="model.draft.value.result.predecessor_content_id"
        :text="t('streamB.readRetainedPredecessor.8ffc86')"
        :tooltip="t('streamB.readTheRetainedBytesFromBeforeThe.24a9fc')"
        :disabled="busy || offline"
        @click="act(() => model.readPredecessor())"
      />
      <GithubCode
        v-if="model.predecessorText.value !== undefined"
        :text="model.predecessorText.value"
        :path="model.filePath.value"
      />
    </Disclosure>
  </div>
</template>
<script setup lang="ts">
import NodeErrorText from '@/components/NodeErrorText.vue'
import { presentUiField, presentUiError } from '@/i18n/streamBErrors'
import { t } from '@/i18n'
import { computed, ref } from 'vue'
import type { NodeFilesModel } from '@/node/NodeFilesModel'
import type { FileDraftSnapshot } from '@/node/fileDrafts'
import { confirmDialog } from '@/components/obsidian/dialogs'
import Button from './obsidian/Button.vue'
import Icon from './obsidian/Icon.vue'
import GithubCode from './github/GithubCode.vue'
import Disclosure from './obsidian/Disclosure.vue'
import StatusDot from './obsidian/StatusDot.vue'
const props = withDefaults(
  defineProps<{
    model: NodeFilesModel
    /** Its own edit, save, reload and discard buttons; off where the tab's header has them. */
    actions?: boolean
    offline?: boolean
    locked?: boolean
    changedOnDisk?: boolean
    reload?: (shown: FileDraftSnapshot | null) => Promise<unknown>
    keepMine?: (shown: FileDraftSnapshot | null) => Promise<unknown>
  }>(),
  { actions: true, reload: undefined, keepMine: undefined }
)
const busy = ref(false),
  error = ref('')
const receiptOpen = ref(false)
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
    error.value = presentUiError(e)
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
      !(await confirmDialog({
        title: t('streamB.discardLocalDraft.bdaf92'),
        message: t('streamB.discardYourUnsavedTextInAndLoad.e0be81', { v0: String(path) }),
        confirmText: t('streamB.reload.bdc090'),
        confirmTooltip: t('streamB.discardTheLocalDraftAndReadThe.4dd6dd'),
      }))
    )
      return
    if (path !== model.filePath.value)
      throw new Error(t('streamB.fileViewChangedBeforeReload.9da237'))
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
  overflow-wrap: anywhere;
  color: var(--text-muted);
  font-size: var(--font-ui-small);
  &__state {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: var(--size-4-2);
    font-family: var(--font-interface);
    font-size: var(--font-ui-medium);
  }
  &__conflict-message {
    display: flex;
    align-items: center;
    gap: var(--size-4-2);
    flex-basis: 100%;
    color: var(--text-normal);
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
  .abele-disclosure {
    box-sizing: border-box;
    padding-inline: var(--size-4-2);
    width: 100%;
    min-width: 0;
  }
}
body.is-phone .abele-node-save .clickable-icon {
  min-width: calc(var(--size-4-10) + var(--size-4-1));
  min-height: calc(var(--size-4-10) + var(--size-4-1));
}
</style>
