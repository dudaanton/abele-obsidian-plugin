<template>
  <div class="abele-update-dialog">
    <p class="abele-update-dialog__text">
      {{ t('streamBMeta.updateSummary', { base, commits: plural(behind, 'commit'), branch }) }}
      <template v-if="dirty && clean">{{
        t('streamBMeta.commitFirst', { files: plural(dirty, 'changed file') })
      }}</template>
      <template v-else-if="dirty">{{
        t('streamBMeta.keepUncommitted', { files: plural(dirty, 'file') })
      }}</template>
    </p>
    <p v-if="ways.length === 1" class="abele-update-dialog__text">
      {{ how === 'rebase' ? rebaseWords : mergeWords }}
    </p>
    <Setting
      v-else
      :name="t('streamB.how.7470bd')"
      :desc="how === 'rebase' ? rebaseWords : mergeWords"
    >
      <Dropdown
        :options="[
          { value: 'rebase', display: t('streamB.rebaseOnto.c43878', { v0: String(base) }) },
          { value: 'merge', display: t('streamB.mergeIn.5f5c6b', { v0: String(base) }) },
        ]"
        :model-value="how"
        :aria-label="t('streamB.howToBringTheCommitsIn.b8e828')"
        @update:model-value="(v: string) => (how = v as 'rebase' | 'merge')"
      />
    </Setting>
    <div class="modal-button-container">
      <Button
        :text="t('streamB.cancel.19766e')"
        :tooltip="t('streamB.closeAndChangeNothing.2ce3af')"
        @click="emit('cancel')"
      />
      <Button
        :text="t('streamB.update.c1c100')"
        accent
        :disabled="clean && dirty > 0"
        :tooltip="
          how === 'rebase'
            ? t('streamB.rebaseOnto.708b25', { v0: String(branch), v1: String(base) })
            : t('streamB.mergeInto.017ff8', { v0: String(base), v1: String(branch) })
        "
        @click="emit('update', how)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { t } from '@/i18n'
// Bringing a branch up to date with its base: rebase it onto the base, or merge the base in. Says
// what each does to the branch; a stop on conflicts is shown on the worktree's page afterwards.
import { ref } from 'vue'
import Button from '../obsidian/Button.vue'
import Dropdown from '../obsidian/Dropdown.vue'
import Setting from '../obsidian/Setting.vue'
import { plural } from './codes'

const props = withDefaults(
  defineProps<{
    branch: string
    base: string
    behind: number
    /** Files not committed. */
    dirty?: number
    /** Already pushed: a rebase means the next push replaces the remote branch. */
    pushed?: boolean
    initial?: 'rebase' | 'merge'
    /** The ways offered; one is said without a choice. */
    ways?: ('rebase' | 'merge')[]
    /** Only a branch with nothing uncommitted can be updated. */
    clean?: boolean
    /** A rebased branch that was pushed can be replaced on the remote by the next push. */
    force?: boolean
  }>(),
  {
    dirty: 0,
    pushed: false,
    initial: 'rebase',
    ways: () => ['rebase', 'merge'],
    clean: false,
    force: true,
  }
)
const emit = defineEmits<{
  (e: 'update', how: 'rebase' | 'merge'): void
  (e: 'cancel'): void
}>()
const how = ref(props.ways.includes(props.initial) ? props.initial : props.ways[0])
const rebaseWords = t('streamB.theBranchSOwnCommitsAreReplayed.d9b3bd', {
  v0: String(props.base),
  v1: String(
    !props.pushed
      ? ''
      : props.force
        ? t('streamB.thePushedBranchWillHaveToBe.72d3c5')
        : t('streamB.thePushedBranchThenDiffersFromIts.56db93')
  ),
})
const mergeWords = t('streamB.oneMergeCommitBringsInTheBranch.80f922', { v0: String(props.base) })
</script>

<style lang="scss">
.abele-update-dialog {
  display: flex;
  flex-direction: column;
}
.abele-update-dialog__text {
  margin: 0 0 var(--size-4-2);
}
.abele-update-dialog .modal-button-container {
  margin-top: var(--size-4-4);
}
</style>
