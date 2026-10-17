<template>
  <PictureEditor
    :model="model"
    :crop="state.crop"
    :cropping="state.cropping"
    :dirty="state.dirty"
    :ready="state.width > 0"
    :status="state.status"
    @cancel="actions.cancel"
    @save="actions.save"
    @crop="state.cropping = true"
    @tool="tool"
    @shape="actions.shape"
    @color="session?.setColor($event)"
    @thickness="actions.thickness"
    @aspect="aspect"
    @turn="turn"
    @flip="flip"
    @reset="reset"
    @undo="actions.undo"
    @redo="actions.redo"
    @zoom="actions.zoom"
  >
    <div ref="stage" class="abele-picture-session">
      <div ref="textLayer" class="abele-picture-session__text" />
    </div>
    <div v-if="state.cropping && state.width" class="abele-picture-session__crop" :style="box">
      <CropFrame
        :surface="stage?.parentElement ?? undefined"
        :rect="state.crop.rect"
        :ratio="ratio"
        :picture="picture"
        @update:rect="state.crop.rect = $event"
        @navigate="navigate"
        @commit="actions.commit"
      />
    </div>
  </PictureEditor>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, shallowRef, watch, watchEffect } from 'vue'
import PictureEditor from './PictureEditor.vue'
import CropFrame from './CropFrame.vue'
import type { DrawingSession } from '@/drawing/DrawingSession'
import type { DrawingModel, DrawingTool } from '@/drawing/model'
import {
  fitRect,
  flipRect,
  frameRatio,
  orientPicture,
  shownRatio,
  turnPictureLeft,
  wholePicture,
  type CropAspect,
} from '@/drawing/crop'
import type { PictureSessionState } from '@/drawing/pictureSession'
import { panBy, zoomAt } from '@/drawing/camera'

const props = defineProps<{
  model: DrawingModel
  state: PictureSessionState
  actions: {
    ready(stage: HTMLElement, textParent: HTMLElement): DrawingSession
    cancel(): void
    save(e: MouseEvent): void
    shape(e: MouseEvent): void
    thickness(e: MouseEvent): void
    zoom(e: MouseEvent): void
    commit(): void
    undo(): void
    redo(): void
    fit(): void
  }
}>()
const stage = ref<HTMLElement | null>(null)
const textLayer = ref<HTMLElement | null>(null)
const session = shallowRef<DrawingSession | null>(null)
onMounted(() => {
  if (stage.value && textLayer.value) {
    session.value = props.actions.ready(stage.value, textLayer.value)
    session.value.surface.mapClientPoint = mapPoint
    session.value.surface.minimumZoom = 0.001
  }
})
watch(
  () => props.state.cropping,
  (cropping) => {
    if (cropping) session.value?.stop()
    else session.value?.start()
  }
)
function mapPoint(point: { clientX: number; clientY: number }): [number, number] {
  const bounds = stage.value.parentElement.getBoundingClientRect()
  const { camera: c, width, height, crop } = props.state
  const cx = (width / 2 - c.x) * c.zoom
  const cy = (height / 2 - c.y) * c.zoom
  const x = (point.clientX - bounds.left - cx) * (crop.flipped ? -1 : 1)
  const y = point.clientY - bounds.top - cy
  const angle = (crop.turns * Math.PI) / 2
  return [
    cx + x * Math.cos(angle) - y * Math.sin(angle),
    cy + x * Math.sin(angle) + y * Math.cos(angle),
  ]
}
function navigate(
  from: { clientX: number; clientY: number },
  to: { clientX: number; clientY: number },
  factor: number
) {
  if (!session.value) return
  const bounds = stage.value.parentElement.getBoundingClientRect()
  const x0 = from.clientX - bounds.left
  const y0 = from.clientY - bounds.top
  const x1 = to.clientX - bounds.left
  const y1 = to.clientY - bounds.top
  session.value.setCamera(
    panBy(
      zoomAt(session.value.camera, x0, y0, factor, session.value.surface.minimumZoom),
      x1 - x0,
      y1 - y0
    )
  )
}
const picture = computed(() =>
  shownRatio(props.state.width, props.state.height, props.state.crop.turns)
)
const ratio = computed(() =>
  frameRatio(props.state.crop.aspect, props.state.crop.upright, picture.value)
)
const box = computed(() => {
  const c = props.state.camera
  const w = props.state.width * c.zoom
  const h = props.state.height * c.zoom
  const odd = props.state.crop.turns % 2
  return {
    left: `${-c.x * c.zoom + (odd ? (w - h) / 2 : 0)}px`,
    top: `${-c.y * c.zoom + (odd ? (h - w) / 2 : 0)}px`,
    width: `${odd ? h : w}px`,
    height: `${odd ? w : h}px`,
  }
})
watchEffect(() => {
  const active = session.value
  if (!active) return
  const { width, height, crop } = props.state
  const turns = crop.turns
  const flipped = crop.flipped
  active.surface.renderer.presentation = (ctx) => {
    orientPicture(ctx, width, height, { turns, flipped })
  }
  active.surface.renderer.paint(active.items.items, active.camera)
  active.surface.paintLive()
})
watchEffect(() => {
  if (!textLayer.value) return
  const { width, height, camera: c, crop } = props.state
  textLayer.value.style.transformOrigin = `${(width / 2 - c.x) * c.zoom}px ${(height / 2 - c.y) * c.zoom}px`
  textLayer.value.style.transform = `scaleX(${crop.flipped ? -1 : 1}) rotate(${-crop.turns * 90}deg)`
})
function tool(t: DrawingTool) {
  props.state.cropping = false
  session.value?.setTool(t)
  session.value?.start()
}
function aspect(a: CropAspect) {
  const c = props.state.crop
  c.upright = c.aspect === a ? !c.upright : false
  c.aspect = a
  const r = frameRatio(a, c.upright, picture.value)
  if (r !== null) c.rect = fitRect(c.rect, r, picture.value)
  props.actions.commit()
}
function turn() {
  props.state.crop = turnPictureLeft(props.state.crop)
  props.actions.commit()
  props.actions.fit()
}
function flip() {
  const c = props.state.crop
  c.rect = flipRect(c.rect)
  c.flipped = !c.flipped
  props.actions.commit()
}
function reset() {
  props.state.crop = wholePicture()
  props.actions.commit()
  props.actions.fit()
}
</script>

<style lang="scss">
.abele-picture-session {
  position: absolute;
  inset: 0;
}
.abele-picture-session__crop {
  position: absolute;
  pointer-events: none;
}
.abele-picture-session__crop .abele-crop-frame {
  pointer-events: auto;
}
.abele-picture-session__text {
  position: absolute;
  inset: 0;
  z-index: 1;
  pointer-events: none;
  textarea {
    pointer-events: auto;
  }
}
</style>
