<template>
  <ConfirmModal
    v-if="page === 'confirm'"
    title="Delete sample?"
    message="Only the synthetic sample would be removed."
    @close="emit('close')"
    @confirm="announce('Confirmed sample')"
  />
  <IconPicker
    v-else-if="page === 'icon-picker'"
    current="folder"
    @choose="announce"
    @close="emit('close')"
  />
  <Modal
    v-else
    :title="page === 'comment' ? 'New comment' : 'Design catalogue'"
    :size="page === 'comment' ? undefined : 'tall'"
    @close="emit('close')"
  >
    <div class="abele-design-catalogue" :data-catalogue-page="page">
      <p v-if="page !== 'comment'" class="setting-item-description">
        {{ references[page] }} · Synthetic fixtures · {{ variant }}
      </p>
      <template v-if="page === 'rows' || page === 'artifact'">
        <SheetHeaderActions
          :context="{ id: 'attach', label: 'Attach…', icon: 'plus' }"
          :actions="[{ id: 'refresh', label: 'Refresh', icon: 'refresh-cw' }]"
          @action="announce"
        />
        <ListSectionHeader text="Notes" :count="3" />
        <ListRow
          v-for="(title, index) in titles"
          :key="title"
          :title="title"
          icon="file-text"
          interactive
          :selected="selected === index"
          :disabled="index === 2"
          disabled-reason="File unavailable"
          :state="index === 2 ? 'missing' : 'ready'"
          :message="index === 2 ? 'File unavailable. Relink it or keep its history.' : undefined"
          @open="selectRow(index, title)"
        >
          <template #metadata
            ><PathLabel :path="paths[index]" :expandable="false" /><MetaLine
              :facts="[
                { key: 'type', value: 'Note' },
                { key: 'count', value: index === 0 ? '2 sources' : '1 source' },
              ]"
          /></template>
          <template #actions
            ><Icon
              icon="folder"
              tooltip="Reveal in file explorer"
              :disabled="index === 2"
              disabled-reason="File unavailable"
              @click="announce('Reveal')" /><SheetHeaderActions
              :actions="[
                { id: 'unlink', label: 'Unlink artifact', icon: 'unlink' },
                { id: 'copy', label: 'Copy full path', icon: 'copy' },
              ]"
              overflow-label="More artifact actions"
              @action="announce"
          /></template>
          <template #detail>
            <EventList v-if="variant === 'stacked'" :events="events.slice(0, 1)" :now="now" />
            <MetaLine
              v-else-if="variant === 'inline'"
              :facts="[
                { key: 'source', value: 'Attached from sample discussion' },
                { key: 'time', value: 'Source retained' },
              ]"
            />
            <Disclosure
              v-else
              v-model="history[index]"
              label="Source history"
              :count="index === 0 ? 2 : 1"
              ><PathLabel :path="paths[index]" mode="full" /><EventList
                :events="events.slice(0, 2)"
                :now="now"
                @jump="announce"
            /></Disclosure>
          </template>
        </ListRow>
        <template v-if="page === 'artifact'"
          ><ListSectionHeader text="Images" :count="1" /><ListRow
            title="sample-diagram.png"
            :facts="[{ key: 'location', value: 'Media' }]"
            ><template #leading
              ><Image :src="sampleImage" alt="Sample diagram" variant="thumbnail" /></template
            ><template #actions
              ><Icon
                icon="unlink"
                tooltip="Unlink sample image"
                @click="announce('Unlink')" /></template></ListRow
          ><ListSectionHeader text="Scripts" :count="0" /><EmptyState text="No scripts attached"
        /></template>
      </template>
      <template v-else-if="page === 'states'">
        <ListSectionHeader text="Empty states" :count="0" />
        <EmptyState variant="empty" /><EmptyState variant="no-matches" /><EmptyState
          variant="loading"
        /><EmptyState variant="error"
          ><template #action
            ><Icon
              icon="refresh-cw"
              text-right="Retry"
              tooltip="Retry loading items"
              @click="announce('Retry')" /></template
        ></EmptyState>
        <ListSectionHeader text="Retained content" :count="3" :total="10" loading />
        <ListRow
          title="sample.md"
          state="loading"
          message="Refreshing… Existing content stays visible."
        />
        <ListRow
          title="failed-sample.md"
          state="error"
          message="Could not refresh. Retry when connected."
        />
        <ListRow title="missing-sample.md" state="missing" />
      </template>
      <template v-else-if="page === 'details'">
        <ListSectionHeader text="Location and time" :count="3" />
        <PathLabel
          path="Work/Deep/Long segment/sample.md"
          copyable
          revealable
          @copy="announce('Copy requested')"
          @reveal="announce('Reveal requested')"
        />
        <PathLabel path="Archive/sample.md" mode="basename" />
        <PathLabel
          path="C:\Synthetic workspace\sample.md"
          mode="full"
          workspace="Demo node"
          missing
        />
        <RelativeTime value="2026-04-05T10:15:00Z" :now="now" time-zone="UTC" /><RelativeTime
          value="bad"
        />
        <RelativeTime
          value="2026-11-01T05:30:00Z"
          mode="absolute"
          time-zone="America/New_York"
          diagnostic
        />
        <Disclosure v-model="expanded" label="Expanded details" :count="0"
          ><Quote :text="longQuote" source="sample.md" unresolved
        /></Disclosure>
        <Quote text="" />
      </template>
      <template v-else-if="page === 'swatches'">
        <ListSectionHeader text="Annotation colour" :count="9" />
        <SwatchPicker v-model="color" label="Annotation colour" v-model:underline="underline" />
        <Setting name="Disabled selection" desc="Selection retained while unavailable"
          ><SwatchPicker
            model-value="yellow"
            label="Disabled colour"
            :colors="['yellow', 'green']"
            disabled
        /></Setting>
        <Setting name="Busy selection" desc="Selection retained while saving"
          ><SwatchPicker
            model-value="green"
            label="Saving colour"
            :colors="['yellow', 'green']"
            busy
        /></Setting>
        <div class="abele-design-catalogue__icons">
          <Icon icon="pencil" tooltip="Edit annotation" @click="announce('Edit')" /><Icon
            icon="folder"
          /><Icon
            icon="search"
            tooltip="Search unavailable"
            disabled
            disabled-reason="Loading index"
            interactive
          /><Icon icon="check" tooltip="Selected option" :active="true" interactive />
        </div>
      </template>
      <template v-else-if="page === 'images'">
        <ListSectionHeader text="Attachments" :count="4" />
        <ListRow title="sample-diagram.png" snippet="Contain preserves the complete diagram"
          ><template #leading
            ><Image
              :src="sampleImage"
              alt="Sample diagram"
              variant="thumbnail"
              preview
              @click="announce('Preview')" /></template
        ></ListRow>
        <ListRow title="missing.png" state="missing"
          ><template #leading
            ><Image
              src="Synthetic/missing.png"
              alt="Missing sample"
              variant="thumbnail"
              preview /></template
        ></ListRow>
        <ListRow title="broken.png" state="error"
          ><template #leading
            ><Image
              src="data:image/png;base64,broken"
              alt="Broken sample"
              variant="thumbnail"
              preview /></template
        ></ListRow>
        <ListRow title="resolving.png" state="loading"
          ><template #leading
            ><Image src="" pending alt="Pending sample" variant="thumbnail" /></template
        ></ListRow>
        <Image :src="sampleImage" alt="Full sample diagram" fit="natural" />
      </template>
      <EventList
        v-else-if="page === 'events'"
        :events="events"
        :now="now"
        @jump="announce"
        @retry="announce"
      />
      <template v-else-if="page === 'comment'">
        <Quote text="A short passage from the synthetic document." source="sample.md" />
        <label for="catalogue-comment">Comment</label
        ><Input
          id="catalogue-comment"
          v-model="draft"
          as-text-area
          :rows="3"
          placeholder="Write a comment…"
        />
        <SwatchPicker
          v-model="color"
          label="Annotation colour"
          :colors="['yellow', 'green', 'blue', 'pink']"
          v-model:underline="underline"
        />
      </template>
      <template v-else-if="page === 'comment-thread'">
        <SheetHeaderActions
          :context="{ id: 'reply', label: 'Reply', icon: 'message-square' }"
          @action="announce"
        />
        <ListSectionHeader text="Comments" :count="3" />
        <Quote text="A retained excerpt from the synthetic document." source="sample.md" />
        <ListRow title="Sample reader" snippet="A short comment associated with the passage."
          ><template #metadata><RelativeTime value="2026-04-05T10:15:00Z" :now="now" /></template
          ><template #actions
            ><Icon
              icon="pencil"
              tooltip="Edit sample comment"
              @click="announce('Edit sample comment')" /></template
        ></ListRow>
        <ListRow
          title="Sample reviewer"
          state="loading"
          message="Saving… Draft retained"
          snippet="A retained comment draft that stays readable while saving."
        />
        <ListRow
          title="Sample helper"
          state="error"
          message="Could not save. Retry without losing your draft."
          ><template #actions
            ><Icon
              icon="refresh-cw"
              tooltip="Retry saving comment"
              @click="announce('Retry sample comment')" /></template
        ></ListRow>
      </template>
      <template v-else-if="page === 'waiting'">
        <ListSectionHeader text="Agents" :count="3" />
        <ListRow
          title="Sample researcher"
          icon="bot"
          interactive
          :facts="[
            { key: 'model', value: 'Sample model' },
            { key: 'scope', value: 'Workspace notes' },
          ]"
          ><template #actions
            ><Icon
              icon="message-square"
              tooltip="Open pending question"
              @click="announce('Question')" /></template
          ><template #detail
            ><MetaLine :facts="[{ key: 'status', value: 'Waiting for your answer' }]" /><Disclosure
              v-model="expanded"
              label="Question"
              ><Quote text="Which synthetic folder should be used?" /></Disclosure></template
        ></ListRow>
        <ListRow
          title="Sample reviewer"
          icon="bot"
          state="loading"
          message="Working… Last result retained"
        />
        <ListRow
          title="Unavailable helper"
          icon="bot"
          state="error"
          message="Connection unavailable. Retry when online."
        />
      </template>
      <template v-else-if="page === 'controls'">
        <Section title="Native form controls" desc="Setting rows, not object rows">
          <Setting name="Name" desc="Single line"
            ><Input v-model="draft" placeholder="Sample name" aria-label="Sample name"
          /></Setting>
          <Setting name="Password"
            ><Input model-value="synthetic" password aria-label="Synthetic password"
          /></Setting>
          <Setting name="Search"><Search v-model="query" placeholder="Search samples" /></Setting>
          <Setting name="Choice"
            ><Dropdown
              v-model="choice"
              :options="[
                { value: 'one', display: 'One' },
                { value: 'two', display: 'Two' },
              ]"
          /></Setting>
          <Setting name="Enabled"
            ><Checkbox
              :is-enabled="enabled"
              aria-label="Enable sample"
              @toggle="enabled = !enabled"
          /></Setting>
          <Setting name="Position"
            ><Slider v-model="position" :min="0" :max="100" aria-label="Sample position"
          /></Setting>
          <Setting name="Notes"
            ><NotePicker v-model="notes" disabled placeholder="Synthetic-only selection"
          /></Setting>
          <Button
            text="Neutral action"
            tooltip="Perform sample action"
            @click="announce('Action')"
          /><Button text="Unavailable" tooltip="Unavailable while loading" disabled />
        </Section>
      </template>
      <template v-else-if="page === 'navigation'">
        <Tabs
          v-model="tab"
          :tabs="[
            { id: 'notes', label: 'Notes' },
            { id: 'history', label: 'History' },
          ]"
        />
        <Breadcrumbs
          :items="[
            { id: 'root', label: 'Root' },
            { id: 'folder', label: 'Folder' },
            { id: 'sample', label: 'sample.md' },
          ]"
          @choose="announce('Navigate')"
        />
        <FoldHeading
          text="Folded group"
          :count="0"
          collapsible
          :collapsed="!expanded"
          @toggle="expanded = !expanded"
        />
        <div role="tree">
          <TreeItem
            text="Synthetic folder"
            icon="folder"
            collapsible
            :collapsed="!expanded"
            @click="expanded = !expanded"
            ><TreeItem text="sample.md" icon="file-text" active /><TreeItem
              text="Read-only sample"
              plain
          /></TreeItem>
        </div>
        <DateDivider date="2026-04-05" /><PeriodSelector v-model:start="start" v-model:end="end" />
      </template>
      <template v-else-if="page === 'previews'">
        <CardGrid
          ><Card
            title="Sample choice"
            path="Work/sample.md"
            :meta="['Ready', '2 sources']"
            :thumbnail="sampleImage"
            selected
            clickable
            @click="announce('Choice')"
            ><template #badges><Badge text="Ready" color="green" /></template
            ><template #actions
              ><Icon
                icon="ellipsis"
                tooltip="More sample actions"
                @click="announce('Actions')" /></template></Card
          ><Card
            title="Rich preview"
            :cover="sampleImage"
            description="A selectable preview rather than a dense inventory row."
            large
        /></CardGrid>
        <Avatar name="Synthetic helper" /><Avatar name="Synthetic helper" :src="sampleImage" />
        <Markdown :text="sampleMarkdown" />
      </template>
      <template v-else-if="page === 'specialized'">
        <Table
          :columns="[
            { key: 'name', label: 'Name' },
            { key: 'status', label: 'Status' },
          ]"
          :rows="[{ name: 'Synthetic row', status: 'Ready' }]"
        />
        <Waveform :levels="[0.2, 0.4, 0.7, 0.3, 0.9, 0.4]" :progress="0.5" /><Waveform
          :levels="[]"
          label="Empty waveform"
        />
        <QrCode text="https://example.invalid/synthetic" label="Synthetic link QR" />
        <Chart class="abele-design-catalogue__chart" :source="[1, 3, 2]" :render="renderChart" />
        <div class="abele-design-catalogue__panel abele-panel-layout abele-panel-layout_open">
          <div class="abele-resizable-panel">
            <SidebarPanel inset><span>Synthetic sidebar panel</span></SidebarPanel
            ><PanelResizeHandle
              label="Sample divider"
              :min="100"
              :max="400"
              :current="200"
              :narrow="false"
              :active="false"
            />
          </div>
        </div>
        <FloatingButton icon="plus" label="Synthetic quick action" />
      </template>
      <p v-if="feedback" role="status" class="setting-item-description">{{ feedback }}</p>
    </div>
    <template #footer>
      <SheetHeaderActions
        :actions="pageActions"
        overflow-label="Browse catalogue"
        @action="navigate" />
      <Button
        v-if="page === 'comment'"
        text="Save"
        tooltip="Save synthetic comment"
        accent
        @click="announce('Saved synthetic draft')" /><Button
        text="Close"
        tooltip="Close catalogue"
        @click="emit('close')"
    /></template>
  </Modal>
</template>
<script setup lang="ts">
import { ref } from 'vue'
import dayjs from 'dayjs'
import { CATALOGUE_PAGES, type CataloguePage } from './designCatalogue'
import type { KitColor } from '@/constants/colors'
import type { EChartsType } from '@/bases/echarts'
import Modal from '@/components/obsidian/Modal.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import ListRow from '@/components/obsidian/ListRow.vue'
import ListSectionHeader from '@/components/obsidian/ListSectionHeader.vue'
import SheetHeaderActions from '@/components/obsidian/SheetHeaderActions.vue'
import MetaLine from '@/components/obsidian/MetaLine.vue'
import PathLabel from '@/components/obsidian/PathLabel.vue'
import RelativeTime from '@/components/obsidian/RelativeTime.vue'
import Disclosure from '@/components/obsidian/Disclosure.vue'
import EventList from '@/components/obsidian/EventList.vue'
import Quote from '@/components/obsidian/Quote.vue'
import SwatchPicker from '@/components/obsidian/SwatchPicker.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import Image from '@/components/obsidian/Image.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Button from '@/components/obsidian/Button.vue'
import Input from '@/components/obsidian/Input.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import Checkbox from '@/components/obsidian/Checkbox.vue'
import Search from '@/components/obsidian/Search.vue'
import Slider from '@/components/obsidian/Slider.vue'
import Section from '@/components/obsidian/Section.vue'
import Setting from '@/components/obsidian/Setting.vue'
import NotePicker from '@/components/obsidian/NotePicker.vue'
import Tabs from '@/components/obsidian/Tabs.vue'
import Breadcrumbs from '@/components/obsidian/Breadcrumbs.vue'
import TreeItem from '@/components/obsidian/TreeItem.vue'
import FoldHeading from '@/components/obsidian/FoldHeading.vue'
import DateDivider from '@/components/obsidian/DateDivider.vue'
import PeriodSelector from '@/components/obsidian/PeriodSelector.vue'
import Card from '@/components/obsidian/Card.vue'
import CardGrid from '@/components/obsidian/CardGrid.vue'
import Badge from '@/components/obsidian/Badge.vue'
import Avatar from '@/components/obsidian/Avatar.vue'
import Markdown from '@/components/obsidian/Markdown.vue'
import Table from '@/components/obsidian/Table.vue'
import Waveform from '@/components/obsidian/Waveform.vue'
import QrCode from '@/components/obsidian/QrCode.vue'
import Chart from '@/components/obsidian/Chart.vue'
import SidebarPanel from '@/components/obsidian/SidebarPanel.vue'
import PanelResizeHandle from '@/components/obsidian/PanelResizeHandle.vue'
import FloatingButton from '@/components/obsidian/FloatingButton.vue'
import IconPicker from '@/components/obsidian/IconPicker.vue'
withDefaults(defineProps<{ page: CataloguePage; variant?: 'inline' | 'stacked' | 'disclosed' }>(), {
  variant: 'disclosed',
})
const emit = defineEmits<{ close: []; navigate: [page: CataloguePage] }>()
const pageActions = CATALOGUE_PAGES.map((page) => ({ id: page, label: page, icon: 'layout-list' }))
const navigate = (page: string) => emit('navigate', page as CataloguePage)
const references: Record<string, string> = {
  rows: 'Native: Search / Backlinks',
  artifact: 'Native: Search attachment inventory',
  states: 'Native: Search empty / Backlinks',
  details: 'Native: Backlinks excerpt / Explorer collapse',
  swatches: 'Native: Setting colour controls',
  images: 'Native: Search attachments',
  events: 'Native: Grouped search results',
  'comment-thread': 'Native: Backlinks excerpt / search results',
  waiting: 'Native: Backlinks row with detail',
  controls: 'Native: Settings rows',
  navigation: 'Native: Explorer / Tabs',
  previews: 'Native: Rich document previews',
  specialized: 'Native: Tables / resizable panes',
  'icon-picker': 'Native: Suggestion choices',
}
const sampleMarkdown = 'A **synthetic** reading excerpt.\n\n> Quoted sample.'
const titles = [
  'sample.md',
  'A long synthetic document name that wraps without losing its meaningful extension.md',
  'missing-sample.md',
]
const paths = [
  'Work/sample.md',
  'Archive/Long directory segment/sample.md',
  'Unavailable/missing-sample.md',
]
const now = new Date('2026-04-05T12:00:00Z')
const events = [
  {
    id: 'a',
    title: 'Attached note',
    actor: 'Sample helper',
    source: 'Synthetic discussion',
    time: '2026-04-05T10:15:00Z',
    jump: true,
    detail: 'Retained source details for the synthetic attachment.',
  },
  { id: 'b', title: 'Unavailable source', state: 'missing' as const },
  {
    id: 'c',
    title: 'Saving attachment',
    state: 'pending' as const,
    source: 'Synthetic discussion',
  },
  {
    id: 'd',
    title: 'Could not save',
    state: 'error' as const,
    source: 'Synthetic discussion',
    retryable: true,
    message: 'Connection unavailable. Existing content retained.',
  },
]
const sampleImage =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="white"/><rect x="4" y="4" width="56" height="40" fill="none" stroke="currentColor"/><path d="M8 36L24 18L40 28L56 10" fill="none" stroke="currentColor"/></svg>'
  )
const longQuote =
  'A synthetic passage that remains selectable and wraps fully when expanded. '.repeat(6)
const selected = ref(0),
  history = ref([false, false, false]),
  expanded = ref(true),
  color = ref<KitColor>('yellow'),
  underline = ref(false),
  draft = ref(''),
  feedback = ref(''),
  query = ref(''),
  choice = ref('one'),
  enabled = ref(true),
  position = ref(35),
  notes = ref<string[]>([]),
  tab = ref('notes'),
  start = ref(dayjs('2026-04-01')),
  end = ref(dayjs('2026-04-30'))
const announce = (value: string) => {
  feedback.value = value
}
const selectRow = (index: number, title: string) => {
  selected.value = index
  announce(title)
}
const renderChart = (chart: EChartsType) =>
  chart.setOption({
    xAxis: { type: 'category', data: ['One', 'Two', 'Three'] },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: [1, 3, 2] }],
  })
</script>
<style>
.abele-design-catalogue {
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: var(--size-4-2);
}
.abele-design-catalogue__icons {
  display: flex;
  align-items: center;
  gap: var(--size-4-2);
}
.abele-design-catalogue__chart {
  height: calc(var(--size-4-16) * 3);
}
.abele-design-catalogue__panel {
  height: calc(var(--size-4-16) * 2);
  position: relative;
}
.abele-design-catalogue__panel > .abele-resizable-panel {
  position: relative;
  height: 100%;
}
.abele-design-catalogue .abele-floating-button {
  position: static;
  align-self: flex-end;
}
.abele-design-catalogue .abele-qr {
  max-width: calc(var(--size-4-16) * 2);
}
body.is-phone
  .abele-design-catalogue
  :is(button, summary, input:not([type='range']), select, .checkbox-container) {
  min-height: var(--abele-touch-min);
}
</style>
