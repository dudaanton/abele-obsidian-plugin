<template>
  <Modal :title="share.label" size="tall" phone-sheet :can-close="() => !busy" @close="close">
    <div class="abele-share-detail">
      <!-- Whether it works, whether it may change things, since when: one quiet line. -->
      <div class="abele-share-detail__state">
        <StatusDot :tone="share.revokedAt ? 'faint' : 'green'" :label="stateWord" />
        <span>{{ stateWord }}</span>
        <span class="abele-share-detail__quiet"
          >· {{ share.readOnly ? 'Read only' : 'Can change files' }} · {{ given }}</span
        >
      </div>

      <Section title="What it opens">
        <ListRow
          v-for="item in share.items"
          :key="item.id"
          :title="itemName(item)"
          :facts="itemPlace(item) ? [{ key: '0', value: itemPlace(item) }] : []"
          class="abele-share-detail__item"
        >
          <template #leading><Icon :icon="itemGlyph(item)" no-hover /></template>
          <template v-if="!share.revokedAt" #actions>
            <Icon
              icon="more-horizontal"
              tooltip="Remove from this share, delete from the server"
              @click="itemMenu($event, item)"
            />
          </template>
          <!-- Asked under the item it is about, as revoking is: nothing goes by one click. -->
          <template v-if="removing?.id === item.id" #detail>
            <div class="abele-share-detail__ask">
              <p>{{ who }} keeps their copy. Nothing is deleted, here or on the server.</p>
              <div class="abele-share-detail__buttons">
                <Button text="Keep" tooltip="Leave it in the share" @click="removing = null" />
                <Button
                  text="Remove"
                  :disabled="busy"
                  :tooltip="`Stop sharing ${itemName(item)}; their copy stays`"
                  @click="run(() => removeItem(item))"
                />
              </div>
            </div>
          </template>
        </ListRow>
        <div v-if="!share.revokedAt" class="abele-share-detail__add">
          <SharePicker
            :model-value="[]"
            :choices="choices"
            :in-share="share.items"
            :disabled="busy"
            placeholder="Add a folder, group or file…"
            @update:model-value="(items) => run(() => addItems(items))"
          />
          <p class="abele-share-detail__quiet">
            What you add reaches {{ who }} by itself. No new token.
          </p>
        </div>
      </Section>

      <Setting
        v-if="revoking"
        :name="`Revoke ${share.label}?`"
        desc="This token stops receiving and sending changes. What they have stays with them."
      >
        <Button text="Keep access" tooltip="Cancel revocation" @click="revoking = false" />
        <Button
          text="Revoke"
          warning
          tooltip="Close access for this token"
          :disabled="busy"
          @click="run(revokeShare)"
        />
      </Setting>
      <p v-if="error" class="abele-share-detail__error" role="alert">{{ error }}</p>
    </div>
    <template #footer>
      <Button
        v-if="!share.revokedAt"
        text="Revoke…"
        warning
        class="abele-share-detail__revoke"
        tooltip="Close this access; what they have stays with them"
        @click="revoking = true"
      />
      <Button text="Close" tooltip="Close this window" :disabled="busy" @click="close" />
    </template>
  </Modal>
</template>

<script setup lang="ts">
/**
 * One token given, opened from its row in Share access: whether it works, what it opens as a
 * list, a way to add to it and to take an item out, each item's way off the server, and revoking
 * at the foot, apart. Taking an item out deletes nothing anywhere; the other side keeps a copy.
 */
import { computed, ref } from 'vue'
import { Menu } from 'obsidian'
import Modal from '../obsidian/Modal.vue'
import Section from '../obsidian/Section.vue'
import Setting from '../obsidian/Setting.vue'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import ListRow from '../obsidian/ListRow.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import SharePicker from './SharePicker.vue'
import { connectionError } from '@/sync/tokenUi'
import { itemGlyph, itemName, itemPlace, type IssuedShare, type ShareItem } from '@/sync/shareSets'

const props = defineProps<{
  share: IssuedShare
  choices: ShareItem[]
  add: (items: ShareItem[]) => Promise<void>
  remove: (item: ShareItem) => Promise<void>
  revoke: () => Promise<void>
}>()
const emit = defineEmits<{ close: []; delete: [item: ShareItem | null] }>()

const busy = ref(false)
const error = ref('')
const removing = ref<ShareItem | null>(null)
const revoking = ref(false)

/** Who the share is for, as the sentences under it name them. */
const who = computed(() => props.share.label || 'They')
const stateWord = computed(() => (props.share.revokedAt ? 'Revoked' : 'Active'))
const given = computed(() => {
  const at = props.share.revokedAt ?? props.share.createdAt
  const day = new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
  return (props.share.revokedAt ? 'revoked ' : 'given ') + day
})

async function run(action: () => Promise<void>) {
  if (busy.value) return
  busy.value = true
  error.value = ''
  try {
    await action()
  } catch (cause) {
    error.value = connectionError(cause)
  } finally {
    busy.value = false
  }
}
function close() {
  if (!busy.value) emit('close')
}
async function addItems(items: ShareItem[]) {
  if (items.length) await props.add(items)
}
async function removeItem(item: ShareItem) {
  await props.remove(item)
  removing.value = null
}
async function revokeShare() {
  await props.revoke()
  revoking.value = false
}

function itemMenu(event: MouseEvent, item: ShareItem) {
  const menu = new Menu()
  menu.addItem((one) =>
    one
      .setTitle('Remove from this share…')
      .setIcon('circle-minus')
      .onClick(() => (removing.value = item))
  )
  menu.addSeparator()
  menu.addItem((one) =>
    one
      .setTitle('Delete from the server…')
      .setIcon('cloud-off')
      .setWarning(true)
      .onClick(() => emit('delete', item))
  )
  menu.showAtMouseEvent(event)
}
</script>

<style lang="scss">
.abele-share-detail__state {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--size-2-3) var(--size-4-2);
}
.abele-share-detail__quiet {
  color: var(--text-muted);
  font-size: var(--font-ui-small);
}
.abele-share-detail__add {
  display: flex;
  flex-direction: column;
  gap: var(--size-4-1);
  margin-top: var(--size-4-3);

  p {
    margin: 0;
  }
}
.abele-share-detail__ask {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-2);

  p {
    margin: 0;
    color: var(--text-muted);
    font-size: var(--font-ui-small);
  }
}
.abele-share-detail__buttons {
  display: flex;
  gap: var(--size-4-2);
}
.abele-share-detail__error {
  margin: var(--size-4-2) 0 0;
  color: var(--text-error);
}
// Apart from Close, at the footer's start: it ends the access.
.abele-share-detail__revoke {
  margin-inline-end: auto;
}
</style>
