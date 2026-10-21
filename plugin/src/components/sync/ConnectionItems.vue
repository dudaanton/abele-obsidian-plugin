<template>
  <Section title="What's shared" class="abele-connection-items">
    <ListRow
      v-for="item in items"
      :key="item.id"
      :title="itemName(item)"
      class="abele-connection-items__item"
      :class="{ 'abele-connection-items__item_detached': item.state.kind === 'detached' }"
    >
      <template #leading><Icon :icon="itemGlyph(item)" no-hover /></template>
      <!-- What it is doing as a dot and a line, where it lies after, quiet. -->
      <template #metadata>
        <span class="abele-connection-items__line">
          <span class="abele-connection-items__state">
            <StatusDot
              :tone="itemTone(item.state)"
              :label="itemLine(item.state)"
              :pulse="item.state.kind === 'syncing' && item.state.total > 0"
            />
            <span :class="{ 'mod-warning': itemTone(item.state) === 'red' }">{{
              itemLine(item.state)
            }}</span>
          </span>
          <span v-if="itemPlace(item)" class="abele-connection-items__place">{{
            '· ' + itemPlace(item)
          }}</span>
        </span>
      </template>
      <template #actions>
        <Icon
          icon="more-horizontal"
          :tooltip="
            item.state.kind === 'detached'
              ? 'Show in files, remove your copy'
              : item.state.kind === 'moved'
                ? 'Follow it, pause on this device, show in files'
                : 'Pause on this device, show in files'
          "
          @click="menu($event, item)"
        />
      </template>
    </ListRow>
  </Section>
</template>

<script setup lang="ts">
/**
 * The items of a connection opened by a token for several, one row each: the kind as a glyph,
 * the name, what it is doing as a dot and a line. One taken out of the share stays, faint, with
 * its copy here; only then may the copy be removed. Deleting from the server is not here: only
 * whoever gave the token may.
 */
import { Menu } from 'obsidian'
import Section from '../obsidian/Section.vue'
import ListRow from '../obsidian/ListRow.vue'
import Icon from '../obsidian/Icon.vue'
import StatusDot from '../obsidian/StatusDot.vue'
import {
  itemGlyph,
  itemLine,
  itemName,
  itemPlace,
  itemTone,
  type ConnectionItem,
} from '@/sync/shareSets'

defineProps<{ items: ConnectionItem[] }>()
const emit = defineEmits<{
  pause: [item: ConnectionItem, paused: boolean]
  follow: [item: ConnectionItem]
  reveal: [item: ConnectionItem]
  'remove-copy': [item: ConnectionItem]
}>()

function menu(event: MouseEvent, item: ConnectionItem) {
  const menu = new Menu().setUseNativeMenu(false)
  const detached = item.state.kind === 'detached'
  const state = item.state
  if (state.kind === 'moved')
    menu.addItem((one) =>
      one
        .setTitle(`Follow it to ${state.to}`)
        .setIcon('folder-input')
        .onClick(() => emit('follow', item))
    )
  if (!detached) {
    const paused = item.state.kind === 'paused'
    menu.addItem((one) =>
      one
        .setTitle(paused ? 'Resume on this device' : 'Pause on this device')
        .setIcon(paused ? 'play' : 'pause')
        .onClick(() => emit('pause', item, !paused))
    )
  }
  menu.addItem((one) =>
    one
      .setTitle('Show in files')
      .setIcon('folder-search')
      .onClick(() => emit('reveal', item))
  )
  if (detached) {
    menu.addSeparator()
    menu.addItem((one) =>
      one
        .setTitle('Remove your copy…')
        .setIcon('trash-2')
        .setWarning(true)
        .onClick(() => emit('remove-copy', item))
    )
  }
  menu.showAtMouseEvent(event)
}
</script>

<style lang="scss">
.abele-connection-items__line {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0 var(--size-4-2);
  color: var(--text-muted);
  font-size: var(--font-ui-small);

  .mod-warning {
    color: var(--text-error);
  }
}
// The dot stays with the first word of its line however the line wraps.
.abele-connection-items__state {
  display: inline-flex;
  align-items: baseline;
  gap: var(--size-4-2);
  min-width: 0;

  .abele-status-dot {
    flex: 0 0 auto;
    align-self: center;
  }
}
.abele-connection-items__place {
  color: var(--text-faint);
  overflow-wrap: anywhere;
}
// Taken out of the share: still listed, quiet, its copy here.
.abele-connection-items__item_detached .abele-list-row__title-text {
  color: var(--text-muted);
}
</style>
