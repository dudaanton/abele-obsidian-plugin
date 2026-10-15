<template>
  <div class="abele-update-dialog">
    <p class="abele-update-dialog__text">
      {{ base }} has {{ plural(behind, 'commit') }} that {{ branch }} has not.
      <template v-if="dirty && clean"
        >Commit or discard the {{ plural(dirty, 'changed file') }} first: only a branch with
        nothing uncommitted is updated.</template
      >
      <template v-else-if="dirty"
        >The {{ plural(dirty, 'file') }} not committed stay as they are.</template
      >
    </p>
    <p v-if="ways.length === 1" class="abele-update-dialog__text">
      {{ how === 'rebase' ? rebaseWords : mergeWords }}
    </p>
    <Setting v-else name="How" :desc="how === 'rebase' ? rebaseWords : mergeWords">
      <Dropdown
        :options="[
          { value: 'rebase', display: `Rebase onto ${base}` },
          { value: 'merge', display: `Merge ${base} in` },
        ]"
        :model-value="how"
        aria-label="How to bring the commits in"
        @update:model-value="(v: string) => (how = v as 'rebase' | 'merge')"
      />
    </Setting>
    <div class="modal-button-container">
      <Button text="Cancel" tooltip="Close and change nothing" @click="emit('cancel')" />
      <Button
        text="Update"
        accent
        :disabled="clean && dirty > 0"
        :tooltip="
          how === 'rebase' ? `Rebase ${branch} onto ${base}` : `Merge ${base} into ${branch}`
        "
        @click="emit('update', how)"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
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
const rebaseWords = `The branch's own commits are replayed on top of ${props.base}; history stays one line.${
  !props.pushed
    ? ''
    : props.force
      ? ' The pushed branch will have to be replaced on the next push.'
      : ' The pushed branch then differs from its copy on the remote, and pushing it is refused until that copy is replaced.'
}`
const mergeWords = `One merge commit brings ${props.base} in; the branch's commits stay as they are.`
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
