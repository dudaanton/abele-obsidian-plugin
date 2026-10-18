<template>
  <div class="abele-picture-editor" :class="{ 'is-phone-layout': phone }">
    <!-- On a computer one row over the picture, as a drawing has; on a phone only what ends the
         editing stays on top, and the tools go down under the thumb. -->
    <ToolBar v-if="!phone" class="abele-picture-editor__bar" :label="t('streamC.7ae5d29673559b54')">
      <div class="abele-picture-editor__primary">
        <Button :text="t('kit.cancel')" plain :tooltip="cancelTooltip" @click="emit('cancel')" />
        <ToolBarGroup class="abele-picture-editor__group abele-picture-editor__desktop-tools">
          <Icon
            v-for="tool in TOOLS"
            :key="tool.id"
            :icon="tool.id === 'shape' ? SHAPE_ICONS[model.shape] : tool.icon"
            :tooltip="tool.tooltip"
            :active="toolNow === tool.id"
            class="abele-picture-editor__tool"
            :class="`abele-picture-editor__tool_${tool.id}`"
            @click="pick(tool.id, $event)"
          />
        </ToolBarGroup>
        <ToolBarGroup class="abele-picture-editor__group abele-picture-editor__history">
          <Icon
            icon="undo-2"
            :tooltip="t('streamC.a8283ade31856f71')"
            :disabled="!canUndo"
            @click="emit('undo')"
          />
          <Icon
            icon="redo-2"
            :tooltip="t('streamC.74273989b0966e23')"
            :disabled="!canRedo"
            @click="emit('redo')"
          />
        </ToolBarGroup>
        <span class="abele-picture-editor__save" @click="saveAt">
          <Button
            :text="t('settings.GithubConnectionEditor.save.1509f561')"
            accent
            trailing-icon="chevron-down"
            :loading="saving"
            :disabled="!ready"
            :tooltip="saveTooltip"
          />
        </span>
      </div>
      <div class="abele-picture-editor__secondary">
        <ToolBarGroup class="abele-picture-editor__group abele-picture-editor__context">
          <template v-if="cropping">
            <Icon
              v-for="a in CROP_ASPECTS"
              :key="a.id"
              :text-right="aspectLabel(a.id, crop.aspect === a.id && crop.upright)"
              :tooltip="a.tooltip"
              :active="crop.aspect === a.id"
              class="abele-picture-editor__aspect"
              @click="emit('aspect', a.id)"
            />
            <Icon
              icon="rotate-ccw"
              :tooltip="t('streamC.af50d37815f01c07')"
              @click="emit('turn')"
            />
            <Icon
              icon="flip-horizontal-2"
              :tooltip="t('streamC.151dfcb49d7e932e')"
              @click="emit('flip')"
            />
            <Button
              v-if="cropping && changed"
              :text="t('area.rangeReset')"
              quiet
              :tooltip="t('streamC.58163234e0425e98')"
              @click="emit('reset')"
            />
          </template>
          <template v-else>
            <Icon
              v-for="c in colors"
              :key="c"
              icon="circle"
              :color="c === 'black' ? undefined : c"
              :active="current === c"
              :tooltip="t('streamC.acd278bfc91387ff', { v1: streamCLabel(c) })"
              class="abele-picture-editor__swatch"
              :class="{ 'abele-picture-editor__swatch_ink': c === 'black' }"
              @click="emit('color', c)"
            />
            <Icon
              icon="line-squiggle"
              :tooltip="t('streamC.a14055dd728bec45', { v1: streamCLabel(model.thickness) })"
              @click="emit('thickness', $event)"
            />
          </template>
        </ToolBarGroup>
        <Icon
          :text-right="zoomText"
          icon="zoom-in"
          class="abele-picture-editor__desktop-zoom"
          :tooltip="t('streamC.51df535f2ea188dd')"
          @click="emit('zoom', $event)"
        />
      </div>
    </ToolBar>

    <div v-else class="abele-picture-editor__top">
      <Button :text="t('kit.cancel')" plain :tooltip="cancelTooltip" @click="emit('cancel')" />
      <Icon
        :text-right="zoomText"
        :tooltip="t('streamC.d0a3885a1d7dbab0', { v1: String(zoomText) })"
        class="abele-picture-editor__zoom"
        @click="emit('zoom', $event)"
      />
      <span class="abele-picture-editor__save" @click="saveAt">
        <Button
          :text="t('settings.GithubConnectionEditor.save.1509f561')"
          accent
          trailing-icon="chevron-down"
          :loading="saving"
          :disabled="!ready"
          :tooltip="saveTooltip"
        />
      </span>
    </div>

    <!-- What saving is doing, or why it did not: under what ends the editing, never over the
         picture. -->
    <div
      v-if="status"
      class="abele-picture-editor__status"
      :class="`is-${status.kind}`"
      role="status"
    >
      <Progress v-if="status.kind === 'saving'" :label="status.text" :value="status.progress" />
      <span class="abele-picture-editor__status-text">{{ status.text }}</span>
    </div>

    <div class="abele-picture-editor__stage" data-ignore-swipe="true">
      <slot />
    </div>

    <div v-if="phone" class="abele-picture-editor__bottom" data-ignore-swipe="true">
      <!-- The tool's own row: its shapes for the frame, its colours for the pen. -->
      <div
        class="abele-picture-editor__row abele-picture-editor__row_context"
        role="toolbar"
        :aria-label="cropping ? t('streamC.98caf7c43c6f2c35') : t('streamC.0db96133695cbad7')"
      >
        <template v-if="cropping">
          <Icon
            v-for="a in CROP_ASPECTS"
            :key="a.id"
            :text-right="aspectLabel(a.id, crop.aspect === a.id && crop.upright)"
            :tooltip="a.tooltip"
            :active="crop.aspect === a.id"
            class="abele-picture-editor__aspect"
            @click="emit('aspect', a.id)"
          />
          <span class="abele-picture-editor__divider" aria-hidden="true" />
          <Icon icon="rotate-ccw" :tooltip="t('streamC.af50d37815f01c07')" @click="emit('turn')" />
          <Icon
            icon="flip-horizontal-2"
            :tooltip="t('streamC.151dfcb49d7e932e')"
            @click="emit('flip')"
          />
          <Button
            v-if="changed"
            :text="t('area.rangeReset')"
            quiet
            :tooltip="t('streamC.58163234e0425e98')"
            @click="emit('reset')"
          />
        </template>
        <template v-else>
          <Icon
            v-for="c in colors"
            :key="c"
            icon="circle"
            :color="c === 'black' ? undefined : c"
            :active="current === c"
            :tooltip="t('streamC.acd278bfc91387ff', { v1: streamCLabel(c) })"
            class="abele-picture-editor__swatch"
            :class="{ 'abele-picture-editor__swatch_ink': c === 'black' }"
            @click="emit('color', c)"
          />
          <span class="abele-picture-editor__divider" aria-hidden="true" />
          <Icon
            icon="line-squiggle"
            :tooltip="t('streamC.a14055dd728bec45', { v1: streamCLabel(model.thickness) })"
            @click="emit('thickness', $event)"
          />
        </template>
      </div>
      <!-- Undo and redo hold their place at the start; the tools after them slide sideways. -->
      <div
        class="abele-picture-editor__row abele-picture-editor__row_tools"
        role="toolbar"
        :aria-label="t('settings.ai.AgentEditorModal.tools.ea93d6a2')"
      >
        <Icon
          icon="undo-2"
          :tooltip="t('streamC.a8283ade31856f71')"
          :disabled="!canUndo"
          @click="emit('undo')"
        />
        <Icon
          icon="redo-2"
          :tooltip="t('streamC.74273989b0966e23')"
          :disabled="!canRedo"
          @click="emit('redo')"
        />
        <span class="abele-picture-editor__divider" aria-hidden="true" />
        <div class="abele-picture-editor__tools">
          <Icon
            v-for="tool in TOOLS"
            :key="tool.id"
            :icon="tool.id === 'shape' ? SHAPE_ICONS[model.shape] : tool.icon"
            :tooltip="tool.tooltip"
            :active="toolNow === tool.id"
            class="abele-picture-editor__tool"
            :class="`abele-picture-editor__tool_${tool.id}`"
            @click="pick(tool.id, $event)"
          />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { streamCLabel } from '@/i18n/streamCLabels'
import { t } from '@/i18n'

/**
 * Editing a picture: cropping it, turning and mirroring it, and drawing on it, all in one place,
 * with Cancel and Save always in sight. On a computer the tools stand in one row over the picture,
 * as a drawing's do. On a phone Cancel, the zoom and Save stay on top, and the tools go to the
 * bottom in two rows a thumb reaches: the tool's own options, then undo, redo and the tools.
 *
 * The picture itself and the ink are the host's, put in the default slot; the crop frame goes over
 * the picture there too, so this shell only lays out what is pressed.
 */
import { computed } from 'vue'
import { Platform } from 'obsidian'
import Button from '../obsidian/Button.vue'
import Icon from '../obsidian/Icon.vue'
import Progress from '../obsidian/Progress.vue'
import ToolBar from '../obsidian/ToolBar.vue'
import ToolBarGroup from '../obsidian/ToolBarGroup.vue'
import type { DrawingModel, DrawingTool } from '@/drawing/model'
import type { ShapeKind } from '@/drawing/items'
import { INK_COLORS, type InkColor } from '@/reader/ink/stroke'
import {
  aspectLabel,
  CROP_ASPECTS,
  cropChanged,
  type CropAspect,
  type CropState,
} from '@/drawing/crop'

import type { PictureEditorStatus } from '@/drawing/pictureSession'

type Tool = DrawingTool | 'crop'

const props = withDefaults(
  defineProps<{
    model: DrawingModel
    crop: CropState
    /** The frame is in hand rather than a drawing tool. */
    cropping: boolean
    /** Something was drawn, cropped or turned since the picture was opened. */
    dirty?: boolean
    ready?: boolean
    status?: PictureEditorStatus | null
    /** The tools at the bottom, under the thumb; by default on a phone. */
    phone?: boolean
  }>(),
  { dirty: false, ready: true, status: null, phone: () => Platform.isPhone }
)

const emit = defineEmits<{
  cancel: []
  save: [event: MouseEvent]
  crop: []
  tool: [tool: DrawingTool]
  shape: [event: MouseEvent]
  color: [color: InkColor]
  thickness: [event: MouseEvent]
  aspect: [aspect: CropAspect]
  turn: []
  flip: []
  reset: []
  undo: []
  redo: []
  zoom: [event: MouseEvent]
}>()

const TOOLS: { id: Tool; icon: string; tooltip: string }[] = [
  { id: 'crop', icon: 'crop', tooltip: t('streamC.528d7dc2527ae94e') },
  { id: 'pen', icon: 'pen-line', tooltip: t('streamC.a04bd35be1678964') },
  { id: 'marker', icon: 'highlighter', tooltip: t('streamC.13ce08699c85c1f2') },
  { id: 'eraser', icon: 'eraser', tooltip: t('streamC.84f2425d2b761cc5') },
  { id: 'lasso', icon: 'lasso', tooltip: t('streamC.58e075d61c229017') },
  { id: 'shape', icon: 'square', tooltip: t('streamC.bcdc888c7fede40c') },
  { id: 'text', icon: 'type', tooltip: t('streamC.535ec9652a4e8de6') },
]
const SHAPE_ICONS: Record<ShapeKind, string> = {
  rect: 'square',
  ellipse: 'circle',
  line: 'minus',
  arrow: 'move-up-right',
}

const toolNow = computed<Tool>(() => (props.cropping ? 'crop' : props.model.tool))
const changed = computed(() => cropChanged(props.crop))
const saving = computed(() => props.status?.kind === 'saving')
const canUndo = computed(() => props.model.canUndo)
const canRedo = computed(() => props.model.canRedo)

const colors = computed<readonly InkColor[]>(() =>
  props.model.tool === 'marker' ? INK_COLORS.marker : INK_COLORS.pen
)
const current = computed(() =>
  props.model.tool === 'marker' ? props.model.markerColor : props.model.penColor
)
const zoomText = computed(() => `${Math.round(props.model.zoom * 100)}%`)
const cancelTooltip = computed(() =>
  props.dirty ? t('streamC.c35c5dd6abf8ecb6') : t('streamC.12be2f0c2bd83ba6')
)
const saveTooltip = t('streamC.051a1bd811f7a73e')

function pick(tool: Tool, e: MouseEvent) {
  if (tool === 'crop') emit('crop')
  else if (tool === 'shape' && props.model.tool === 'shape' && !props.cropping) emit('shape', e)
  else emit('tool', tool)
}

function saveAt(e: MouseEvent) {
  if (!saving.value && props.ready) emit('save', e)
}
</script>

<style lang="scss">
.abele-picture-editor {
  container-type: inline-size;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background-color: var(--background-primary);
}

.abele-picture-editor__bar {
  flex-wrap: nowrap;
}

.abele-picture-editor__primary,
.abele-picture-editor__secondary {
  display: contents;
}

.abele-picture-editor__desktop-tools {
  order: 1;
}
.abele-picture-editor__context {
  order: 2;
  padding-block: var(--size-4-1);
  min-width: 0;
  flex-shrink: 1;
  // Tool options scroll within their group when the single desktop row has no more room.
  overflow-x: auto;
  > * {
    flex: 0 0 auto;
  }
}
.abele-picture-editor__history {
  order: 3;
  margin-left: auto;
}
.abele-picture-editor__desktop-zoom {
  order: 4;
  flex: 0 0 auto;
}
.abele-picture-editor__primary > .abele-picture-editor__save {
  order: 5;
  flex: 0 0 auto;
}
.abele-picture-editor__primary > button {
  flex: 0 0 auto;
}

@container (max-width: 42em) {
  .abele-picture-editor__bar {
    flex-direction: column;
    align-items: stretch;
  }
  .abele-picture-editor__primary,
  .abele-picture-editor__secondary {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    gap: var(--size-2-1);
    min-width: 0;
  }
  .abele-picture-editor__secondary {
    // A narrow pane keeps options on one row and lets them scroll, as the phone context row does.
    overflow-x: auto;
    .abele-picture-editor__context {
      flex: 0 0 auto;
      overflow: visible;
    }
    .abele-picture-editor__desktop-zoom {
      margin-left: auto;
    }
  }
}

@container (max-width: 26em) {
  .abele-picture-editor__primary .abele-picture-editor__desktop-tools {
    flex: 1 1 auto;
    min-width: 0;
    padding-block: var(--size-4-1);
    // Only the tools slide; Cancel, undo/redo and Save remain within reach at the pane edges.
    overflow-x: auto;
    > * {
      flex: 0 0 auto;
    }
  }
}

.abele-picture-editor__save {
  display: inline-flex;
}

// The picture fills what the rows leave; the dimming of the crop frame stops at this edge.
.abele-picture-editor__stage {
  position: relative;
  flex: 1 1 auto;
  min-height: 0;
  overflow: hidden;
  background-color: var(--background-secondary);
}

.abele-picture-editor__aspect,
.abele-picture-editor__zoom {
  width: auto;
  font-variant-numeric: tabular-nums;
  white-space: nowrap;

  .abele-obsidian-icon__text {
    font-size: var(--font-ui-small);
  }
}

.abele-picture-editor__swatch_ink {
  color: var(--text-normal);
}

.abele-picture-editor__status {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
  // Its words start where Cancel's do, above it.
  padding: var(--size-4-1) var(--size-4-2) var(--size-4-1) calc(var(--size-4-2) + var(--size-2-3));
  border-bottom: 1px solid var(--background-modifier-border);
  color: var(--text-muted);
  font-size: var(--font-ui-small);

  .abele-progress {
    flex: 0 0 var(--size-4-16);
  }

  &.is-error {
    color: var(--text-error);
  }
}

.abele-picture-editor__status-text {
  min-width: 0;
  overflow-wrap: anywhere;
}

// On a phone: Cancel, the zoom and Save in a quiet row under the tab's header.
.abele-picture-editor__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--size-4-2);
  padding: var(--size-4-1) var(--size-4-2);
  border-bottom: 1px solid var(--background-modifier-border);
}

// The two rows under the thumb, as Obsidian's own bar over the keyboard: on the primary
// background, a hairline above, glyphs a finger's size.
.abele-picture-editor__bottom {
  display: flex;
  flex-direction: column;
  // Above Obsidian's own floating bar at the bottom of a phone and the home indicator, the way its
  // views end their content there.
  padding-bottom: var(--safe-area-inset-bottom);

  .is-floating-nav & {
    padding-bottom: calc(var(--navbar-bottom-offset) + var(--navbar-height) + var(--size-4-2));
  }
  border-top: 1px solid var(--background-modifier-border);
  background-color: var(--background-primary);
}

.abele-picture-editor__row {
  display: flex;
  align-items: center;
  gap: var(--size-2-2);
  padding: var(--size-2-2) var(--size-4-2);
  // A row wider than the phone slides sideways, as Obsidian's bar over the keyboard does, rather
  // than wrapping onto a second line the thumb would have to reach for.
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }

  > * {
    flex: 0 0 auto;
  }

  & + & {
    border-top: 1px solid var(--background-modifier-border);
  }
}

// The tool's options stand in the middle over the tools, as a photo editor's shapes do, and
// slide sideways from the start when they are wider than the screen.
.abele-picture-editor__row_context {
  justify-content: center;
  justify-content: safe center;
}

.abele-picture-editor__row_tools {
  overflow: hidden;
}

.abele-picture-editor__tools {
  display: flex;
  flex: 1 1 auto;
  align-items: center;
  gap: var(--size-2-2);
  min-width: 0;
  // The tools slide sideways behind undo and redo, which stay where the thumb knows them.
  overflow-x: auto;
  scrollbar-width: none;

  &::-webkit-scrollbar {
    display: none;
  }

  > * {
    flex: 0 0 auto;
  }
}

.abele-picture-editor__divider {
  align-self: stretch;
  width: 1px;
  margin-block: var(--size-4-1);
  background-color: var(--background-modifier-border);
}
</style>
