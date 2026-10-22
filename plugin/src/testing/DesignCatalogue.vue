<template>
  <ConfirmModal
    v-if="page === 'confirm'"
    title="Delete sample-note.md?"
    message="Delete this note and its comments. This cannot be undone."
    @close="emit('close')"
    @confirm="announce('Note deleted')"
  />
  <PromptModal
    v-else-if="page === 'prompt'"
    title="New script"
    value="sample-script"
    @close="emit('close')"
    @answer="announce"
  />
  <ChoiceModal
    v-else-if="page === 'choice'"
    title="Remove this discussion from the book?"
    quote="Sample words that were marked in a sample chapter"
    message="The words stop being marked. Their chat can stay as an ordinary chat in the history, or go with the mark."
    :choices="[
      { value: 'keep', text: 'Keep the chat', cta: true },
      { value: 'delete', text: 'Delete the chat too', warning: true },
      { value: null, text: 'Cancel' },
    ]"
    @close="emit('close')"
    @answer="announce"
  />
  <IconPicker
    v-else-if="page === 'icon-picker'"
    current="folder"
    @choose="announce"
    @close="emit('close')"
  />
  <Modal
    v-else
    :title="titles[page]"
    :close-in-footer="page === 'comment'"
    :size="longPages.has(page) ? 'tall' : undefined"
    @close="emit('close')"
  >
    <div class="abele-design-catalogue" :data-catalogue-page="page">
      <template v-if="page === 'index'"
        ><ListRow
          v-for="entry in entries"
          :key="entry.id"
          :title="entry.label"
          icon="layout-list"
          interactive
          @open="emit('navigate', entry.id)"
      /></template>
      <div v-else-if="page === 'notices'" class="abele-design-catalogue__notices">
        <div class="notice">
          <NoticeActions
            text="Abele updated to 1.1.0. See what's new since 1.0.0."
            :actions="[
              {
                text: 'What\'s new',
                tooltip: 'Open changes since the previous version',
                accent: true,
                run: () => announce('What\'s new'),
              },
              {
                text: 'Dismiss',
                tooltip: 'Dismiss this update notice',
                run: () => announce('Dismiss'),
              },
            ]"
          />
        </div>
      </div>
      <div v-else-if="page === 'suggestions'" class="suggestion-container">
        <div
          v-for="(row, index) in suggestionRows"
          :key="row.title"
          class="suggestion-item mod-complex"
          :class="{ 'is-selected': index === 0 }"
        >
          <SuggestionRow v-bind="row" />
        </div>
      </div>
      <template v-else-if="page === 'rows' || page === 'artifact'">
        <SheetHeaderActions
          :context="{ id: 'attach', label: 'Attach…', icon: 'plus' }"
          :actions="[{ id: 'refresh', label: 'Refresh', icon: 'refresh-cw' }]"
          @action="announce"
        />
        <ListSectionHeader v-if="page === 'artifact'" text="Notes" :count="3" />
        <ListRow
          v-for="(note, index) in page === 'rows' ? notes : notes.slice(0, 3)"
          :key="note.title"
          v-model:expanded="note.expanded"
          :title="note.title"
          icon="file-text"
          preserve-extension
          interactive
          :selected="selected === index"
          :disabled="note.missing"
          disabled-reason="File missing"
          :state="note.missing ? 'missing' : 'ready'"
          :message="note.missing ? 'File missing. Saved sources are still available.' : undefined"
          :facts="[
            { key: 'where', value: note.parent },
            { key: 'sources', value: note.sources },
          ]"
          details-label="Sources"
          :details-count="note.sources"
          @open="select(note.title, index)"
        >
          <template #actions
            ><SheetHeaderActions
              :actions="noteActions(note)"
              overflow-label="More file actions"
              @action="fileAction($event, note)"
          /></template>
          <template v-if="note.missing" #recovery
            ><Button
              text="Relink"
              tooltip="Choose a replacement file"
              @click="note.missing = false"
          /></template>
          <template #detail
            ><PathLabel :path="`${note.parent}/${note.title}`" mode="full" /><EventList
              :events="noteEvents(note)"
              :now="now"
              @jump="announce"
          /></template>
        </ListRow>
        <template v-if="page === 'artifact'"
          ><ListSectionHeader text="Images" :count="1" /><ListRow
            title="sample-diagram.png"
            icon="file-image"
            :facts="[{ key: 'where', value: 'Media' }]"
            :expanded="preview"
            details-label="Preview"
            @update:expanded="preview = $event"
            ><template #actions
              ><SheetHeaderActions
                :actions="[
                  { id: 'preview', label: 'View image', icon: 'image' },
                  { id: 'unlink', label: 'Unlink image', icon: 'unlink' },
                ]"
                overflow-label="Image actions"
                @action="preview = true" /></template
            ><template #detail
              ><Image
                :src="sampleImage"
                alt="Sample diagram"
                variant="thumbnail"
                preview
                @click="preview = true" /></template></ListRow
          ><ListSectionHeader text="Scripts" :count="0" /><EmptyState text="No scripts attached"
        /></template>
      </template>
      <template v-else-if="page === 'images'">
        <ListRow
          title="sample-diagram.png"
          :facts="[{ key: 'where', value: 'Media' }]"
          :expanded="preview"
          details-label="Full image"
          @update:expanded="preview = $event"
          ><template #leading
            ><Image
              :src="sampleImage"
              alt="Sample diagram"
              variant="thumbnail"
              preview
              @click="preview = true" /></template
          ><template #detail
            ><Image :src="sampleImage" alt="Sample diagram" fit="contain" /></template
        ></ListRow>
        <ListRow
          title="missing.png"
          :state="missingImage ? 'missing' : 'ready'"
          :message="missingImage ? 'Image missing' : undefined"
          :facts="[{ key: 'where', value: 'Media' }]"
          ><template #leading
            ><Image
              :src="missingImage ? 'Missing/image.png' : sampleImage"
              alt="Missing image"
              variant="thumbnail" /></template
          ><template #recovery
            ><Icon
              icon="link"
              text-right="Relink"
              tooltip="Choose a replacement image"
              @click="missingImage = false" /></template
        ></ListRow>
        <ListRow
          title="broken.png"
          :state="brokenImage ? 'error' : 'ready'"
          :message="brokenImage ? 'Preview could not load' : undefined"
          :facts="[{ key: 'where', value: 'Media' }]"
          ><template #leading
            ><Image
              :src="brokenImage ? 'data:image/png;base64,broken' : sampleImage"
              alt="Unreadable image"
              variant="thumbnail" /></template
          ><template #recovery
            ><Icon
              icon="refresh-cw"
              text-right="Retry"
              tooltip="Retry loading preview"
              @click="brokenImage = false" /></template
        ></ListRow>
        <ListRow title="loading.png" state="loading" message="Loading image…"
          ><template #leading
            ><Image src="" pending alt="Loading image" variant="thumbnail" /></template
        ></ListRow>
      </template>
      <template v-else-if="page === 'events'"
        ><EventList :events="events" :now="now" @jump="announce" @retry="retryEvent"
      /></template>
      <template v-else-if="page === 'details'">
        <Section title="Note location"
          ><PathLabel
            path="Work/Long folder/sample.md"
            copyable
            revealable
            @copy="announce('Path copied')"
            @reveal="announce('Folder opened')"
        /></Section>
        <Section title="Shared workspace"
          ><PathLabel
            path="C:\Example workspace\sample.md"
            mode="full"
            workspace="Sample node"
            missing
        /></Section>
        <Section title="Last edit"
          ><RelativeTime value="2026-04-05T10:15:00Z" :now="now" time-zone="UTC"
        /></Section>
        <Section title="Unknown time"><RelativeTime value="bad" /></Section>
        <Section title="Saved time"
          ><RelativeTime
            value="2026-11-01T05:30:00Z"
            time-zone="America/New_York"
            mode="absolute"
            diagnostic
        /></Section>
        <Section title="Passage"><Quote :text="longQuote" source="sample.md" unresolved /></Section
        ><Section title="No passage selected"><Quote text="" /></Section>
      </template>
      <template v-else-if="page === 'states'">
        <CallNote text="The sample action was not sent." />
        <StateLine
          tone="orange"
          text="The sample operation did not finish."
          action="Retry"
          :details="[{ label: 'Code', value: 'sample_deadline', code: true }]"
          log
          @action="announce('Retry requested')"
          @log="announce('Log requested')"
          @copy="announce('Details copied')"
        />
        <Section title="Run report">
          <RunReport finished status="Import complete" :facts="[{ label: 'Notes', value: 3 }]" />
          <ShortList
            heading="Skipped"
            :items="[{ title: 'sample-note.md', meta: 'Already imported' }]"
          />
        </Section>
        <Section title="Progress">
          <Setting name="Starting"><Progress label="Sample import starting" :value="0" /></Setting>
          <Setting name="In progress"
            ><Progress label="Sample import in progress" :value="50"
          /></Setting>
          <Setting name="Complete"
            ><Progress label="Sample import complete" :value="100"
          /></Setting>
          <Setting name="Total unknown"><Progress label="Sample import total unknown" /></Setting>
        </Section>
        <Section title="Requests">
          <RequestCard waiting>
            <span>Read the sample page?</span>
            <Button
              text="Allow"
              tooltip="Allow the sample request"
              accent
              @click="announce('Sample allowed')"
            />
          </RequestCard>
          <RequestCard role="alert">
            <span>Sample connection unavailable</span>
            <Button
              text="Retry"
              tooltip="Retry the sample request"
              @click="announce('Sample retry')"
            />
          </RequestCard>
        </Section>
        <Section title="Compact states">
          <ListRow v-for="state in compactStates" :key="state.label" :title="state.label">
            <template #leading><StatusDot :tone="state.tone" :label="state.label" /></template>
          </ListRow>
        </Section>
        <Section title="No attachments"
          ><EmptyState variant="empty" text="No files attached"
        /></Section>
        <Section title="Search"
          ><EmptyState variant="no-matches" text="No files match this search"
        /></Section>
        <Section title="Loading attachments"
          ><EmptyState variant="loading" text="Loading files…"
        /></Section>
        <Section title="Connection failed"
          ><EmptyState variant="error" text="Could not load files. Check your connection."
            ><template #action
              ><Button
                text="Retry"
                tooltip="Retry loading files"
                @click="announce('Retry loading files')" /></template></EmptyState
        ></Section>
        <ListSectionHeader text="Files" :count="3" :total="10" loading />
        <ListRow
          title="sample.md"
          icon="file-text"
          state="loading"
          message="Refreshing…"
          snippet="Meeting outline and next steps."
          :facts="[{ key: 'where', value: 'Work' }]"
        />
        <ListRow
          title="draft.md"
          icon="file-text"
          state="error"
          message="Connection lost"
          snippet="A saved outline is ready to read."
          ><template #recovery
            ><Icon
              icon="refresh-cw"
              text-right="Retry"
              tooltip="Retry refreshing draft.md"
              @click="announce('Retry refreshing draft.md')" /></template
        ></ListRow>
        <ListRow title="missing.md" icon="file-text" state="missing" message="File missing"
          ><template #recovery
            ><Icon
              icon="link"
              text-right="Relink"
              tooltip="Choose a replacement note"
              @click="announce('Choose a replacement note')" /></template
        ></ListRow>
      </template>
      <template v-else-if="page === 'waiting'">
        <ListRow
          v-model:expanded="questionOpen"
          title="Sample researcher"
          icon="bot"
          :facts="[
            { key: 'model', value: 'Sample model' },
            { key: 'where', value: 'Work' },
          ]"
          state="waiting"
          details-label="Question"
          ><template #detail
            ><Quote text="Which folder should I use?" /><Button
              text="Reply"
              tooltip="Answer the pending question"
              @click="replyOpen = !replyOpen" /><Input
              v-if="replyOpen"
              v-model="reply"
              aria-label="Answer"
              placeholder="Name a folder…" /></template
        ></ListRow>
        <ListRow
          title="Sample reviewer"
          icon="bot"
          state="loading"
          message="Working…"
          snippet="Last result: two notes reviewed."
        />
        <ListRow title="Sample helper" icon="bot" state="error" message="Connection lost"
          ><template #recovery
            ><Icon
              icon="refresh-cw"
              text-right="Retry"
              tooltip="Reconnect Sample helper"
              @click="announce('Reconnecting Sample helper')" /></template
        ></ListRow>
      </template>
      <template v-else-if="page === 'comment'"
        ><Quote text="A short passage from the document." source="sample.md" /><Input
          id="catalogue-comment"
          v-model="draft"
          aria-label="Comment"
          as-text-area
          :rows="3"
          placeholder="Write a comment…" /><SwatchPicker
          v-model="color"
          v-model:underline="underline"
          label="Highlight colour"
          :colors="['grey', 'yellow', 'green', 'blue', 'pink']"
      /></template>
      <template v-else-if="page === 'comment-thread'"
        ><SheetHeaderActions
          :context="{ id: 'reply', label: 'Reply', icon: 'message-square' }"
          @action="replyOpen = true" /><Quote
          text="A selected passage from the document."
          source="sample.md" /><ListRow
          title="Sample reader"
          snippet="Keep the source with the note."
          ><template #metadata
            ><RelativeTime value="2026-04-05T10:15:00Z" :now="now" mode="absolute" /></template
          ><template #actions
            ><Icon
              icon="pencil"
              tooltip="Edit comment"
              @click="replyOpen = true" /></template></ListRow
        ><ListRow
          title="Sample reviewer"
          snippet="The draft is ready to review."
          state="loading"
          message="Saving…" /><ListRow
          title="Sample helper"
          snippet="The original passage is useful here."
          state="error"
          message="Could not save"
          ><template #recovery
            ><Icon
              icon="refresh-cw"
              text-right="Retry save"
              tooltip="Retry saving comment"
              @click="announce('Retry saving comment')" /></template></ListRow
        ><Input
          v-if="replyOpen"
          v-model="reply"
          as-text-area
          aria-label="Reply"
          placeholder="Write a reply…"
      /></template>
      <template v-else-if="page === 'swatches'"
        ><Setting name="Highlight colour"
          ><SwatchPicker
            v-model="color"
            v-model:underline="underline"
            label="Highlight colour" /></Setting
        ><Setting name="Read-only passage" desc="This document does not allow colour changes."
          ><SwatchPicker
            model-value="yellow"
            label="Read-only colour"
            :colors="['grey', 'yellow', 'green']"
            disabled
            disabled-reason="The document is read only" /></Setting
        ><Setting name="Saving highlight"
          ><SwatchPicker
            model-value="green"
            label="Saving colour"
            :colors="['grey', 'yellow', 'green']"
            busy /></Setting
        ><Section title="Note actions"
          ><div class="abele-design-catalogue__icons">
            <Icon
              icon="pencil"
              text-right="Edit"
              tooltip="Edit note"
              @click="announce('Edit note')"
            /><Icon
              icon="search"
              tooltip="Search is unavailable while indexing"
              disabled
              disabled-reason="Indexing notes"
              interactive
            /><Icon
              icon="check"
              text-right="Selected"
              tooltip="Current note"
              :active="true"
              interactive
            /></div></Section
      ></template>
      <template v-else-if="page === 'controls'">
        <p>
          <I18nText text="An inline value: ⟪value⟫."
            ><template #value><code>sample</code></template></I18nText
          >
        </p>
        <Setting name="Notebook name"
          ><Input v-model="draft" placeholder="Work notes" aria-label="Notebook name"
        /></Setting>
        <Setting name="Passphrase" desc="Used to unlock this notebook."
          ><Input model-value="example-passphrase" password aria-label="Passphrase"
        /></Setting>
        <Setting name="Search notes"><Search v-model="query" placeholder="Find a note…" /></Setting>
        <Setting name="Default folder"
          ><Dropdown
            v-model="choice"
            :options="[
              { value: 'work', display: 'Work' },
              { value: 'archive', display: 'Archive' },
            ]"
        /></Setting>
        <Setting name="Include completed tasks"
          ><Checkbox
            :is-enabled="enabled"
            aria-label="Include completed tasks"
            @toggle="enabled = !enabled"
        /></Setting>
        <Setting name="Reading position"
          ><Slider v-model="position" :min="0" :max="100" aria-label="Reading position"
        /></Setting>
        <Setting name="Related notes" desc="No related notes selected."
          ><NotePicker v-model="picked" disabled placeholder="Choose a note…"
        /></Setting>
        <CodeField
          value='{ "station": "balcony", "every": "10m" }'
          path="sample.json"
          label="Request body"
          placeholder="Body"
        />
        <div ref="selectionAnchor">
          <p data-selection-sample>Select these sample words to preview selection actions.</p>
          <SelectionBar :scope="selectionAnchor" :actions="[ASK, ADD, NOTE]" @pick="announce" />
          <Button
            text="Anchored card"
            tooltip="Preview context beside its source"
            @click="previewAnchor"
          />
          <Button
            text="Selection actions"
            tooltip="Preview actions near selected text"
            @click="previewSelection"
          />
        </div>
        <AnchoredCard
          v-if="cardAnchor"
          :anchor="cardAnchor"
          label="Sample context"
          @close="cardAnchor = null"
        >
          Sample context beside the selected passage.
        </AnchoredCard>
      </template>
      <template v-else-if="page === 'navigation'">
        <Setting name="Drawer view switch" desc="Visible only inside a phone side drawer.">
          <DrawerViewSwitch icon="list-todo" name="Sample panel" />
        </Setting>
        <Tabs
          v-model="tab"
          :tabs="[
            { id: 'notes', label: 'Notes' },
            { id: 'history', label: 'History' },
          ]"
        />
        <Breadcrumbs
          :items="[
            { id: 'root', label: 'Notebook' },
            { id: 'folder', label: 'Work' },
            { id: 'sample', label: 'sample.md' },
          ]"
          @choose="announce('Open folder')"
        />
        <Section title="Work"
          ><FoldHeading
            text="Files"
            :count="2"
            collapsible
            :collapsed="!folderOpen"
            @toggle="folderOpen = !folderOpen" />
          <div role="tree">
            <TreeItem
              text="Work"
              icon="folder"
              collapsible
              :collapsed="!folderOpen"
              @click="folderOpen = !folderOpen"
              ><TreeItem text="sample.md" icon="file-text" active /><TreeItem
                text="archive.md"
                flair="Read only"
                plain
            /></TreeItem></div
        ></Section>
        <Section title="Calendar"
          ><Calendar
            :selected-date="selectedDay"
            @date-selected="selectedDay = $event" /><DateDivider :date="selectedDayKey"
        /></Section>
        <Section title="Entries"
          ><GroupHeading label="Garden" strong>2 open</GroupHeading
          ><EntryRow
            v-for="entry in listEntries"
            :key="entry.title"
            v-model:more="entry.open"
            role="button"
            tabindex="0"
            more-label="note"
            :active="entry.active"
            @click="announce(entry.title)"
            ><template #leading><Icon icon="circle" no-hover /></template>{{ entry.title }}
            <template #codes
              ><span>{{ entry.when }}</span></template
            >
            <template #meta
              ><LabelDot v-for="label in entry.labels" :key="label.text" v-bind="label"
            /></template>
            <template #aside
              ><Icon
                icon="x"
                :label="`Remove ${entry.title}`"
                @click.stop="announce(`Removed ${entry.title}`)"
            /></template>
            <template v-if="entry.open" #detail>{{ entry.note }}</template></EntryRow
          ></Section
        >
        <Section title="Reporting period"
          ><PeriodSelector v-model:start="rangeStart" v-model:end="rangeEnd"
        /></Section>
      </template>
      <template v-else-if="page === 'previews'">
        <Section title="Document choice"
          ><CardGrid
            ><Card
              title="sample-diagram.png"
              path="Media/sample-diagram.png"
              :meta="['Ready', 'Sources 2']"
              :thumbnail="sampleImage"
              selected
              clickable
              @click="announce('Document selected')"
              ><template #actions
                ><SheetHeaderActions
                  :actions="[{ id: 'open', label: 'Open document', icon: 'file-text' }]"
                  overflow-label="Document actions"
                  @action="announce('Open document')" /></template></Card></CardGrid
        ></Section>
        <Section title="Document preview"
          ><Card
            title="Sample diagram"
            :cover="sampleImage"
            description="Notes on the three review steps."
            large
        /></Section>
        <Section title="Author"
          ><div class="abele-design-catalogue__icons">
            <Avatar name="Sample reader" /><span>Sample reader</span><Badge text="Read only" /></div
        ></Section>
        <Section title="Passage"><Markdown :text="sampleMarkdown" /></Section>
      </template>
      <template v-else-if="page === 'specialized'">
        <Section title="Review progress"
          ><Table
            :columns="[
              { key: 'name', label: 'Note' },
              { key: 'status', label: 'Status' },
            ]"
            :rows="[
              { name: 'sample.md', status: 'Reviewed' },
              { name: 'draft.md', status: 'Waiting' },
            ]"
        /></Section>
        <Section title="Recording" desc="Playback halfway through a voice note."
          ><Waveform
            :levels="[0.2, 0.4, 0.7, 0.3, 0.9, 0.4]"
            :progress="0.5"
            label="Voice note playback" /><Waveform :levels="[]" label="No recording yet"
        /></Section>
        <Section title="Minutes recorded"
          ><Chart class="abele-design-catalogue__chart" :source="[1, 3, 2]" :render="renderChart"
        /></Section>
        <Section title="Open guide" desc="Scan to open https://example.invalid/guide"
          ><QrCode text="https://example.invalid/guide" label="Open guide" /><Button
            text="Copy link"
            tooltip="Copy the guide address"
            @click="announce('Guide address copied')"
        /></Section>
        <Section title="Notes panel"
          ><div class="abele-design-catalogue__panel abele-panel-layout abele-panel-layout_open">
            <div class="abele-resizable-panel">
              <SidebarPanel inset
                ><TreeItem text="sample.md" icon="file-text" plain /><TreeItem
                  text="draft.md"
                  icon="file-text"
                  plain /></SidebarPanel
              ><PanelResizeHandle
                label="Resize notes panel"
                :min="100"
                :max="400"
                :current="200"
                :narrow="false"
                :active="false"
              />
            </div>
          </div>
          <FloatingButton icon="plus" label="New note"
        /></Section>
      </template>
      <p v-if="feedback" role="status" class="setting-item-description">{{ feedback }}</p>
    </div>
    <template v-if="page === 'comment'" #footer
      ><Button
        v-if="page === 'comment'"
        text="Save"
        tooltip="Save comment"
        accent
        @click="announce('Comment saved')" /><Button
        :text="page === 'comment' ? 'Cancel' : 'Close'"
        :tooltip="page === 'comment' ? 'Discard this comment draft' : 'Close example'"
        @click="cancel"
    /></template>
  </Modal>
</template>
<script setup lang="ts">
import { ref, computed } from 'vue'
import dayjs from 'dayjs'
import { CATALOGUE_PAGES, type CataloguePage } from './catalogueShape'
import type { KitColor } from '@/constants/colors'
import type { EChartsType } from '@/bases/echarts'
import type { KitEvent } from '@/components/obsidian/EventList.vue'
import Modal from '@/components/obsidian/Modal.vue'
import ConfirmModal from '@/components/obsidian/ConfirmModal.vue'
import PromptModal from '@/components/obsidian/PromptModal.vue'
import ChoiceModal from '@/components/obsidian/ChoiceModal.vue'
import SuggestionRow from '@/components/obsidian/SuggestionRow.vue'
import NoticeActions from '@/components/obsidian/NoticeActions.vue'
import ListRow from '@/components/obsidian/ListRow.vue'
import DrawerViewSwitch from '@/components/obsidian/DrawerViewSwitch.vue'
import ListSectionHeader from '@/components/obsidian/ListSectionHeader.vue'
import SheetHeaderActions from '@/components/obsidian/SheetHeaderActions.vue'
import PathLabel from '@/components/obsidian/PathLabel.vue'
import RelativeTime from '@/components/obsidian/RelativeTime.vue'
import EventList from '@/components/obsidian/EventList.vue'
import Quote from '@/components/obsidian/Quote.vue'
import SwatchPicker from '@/components/obsidian/SwatchPicker.vue'
import EmptyState from '@/components/obsidian/EmptyState.vue'
import Progress from '@/components/obsidian/Progress.vue'
import Image from '@/components/obsidian/Image.vue'
import Icon from '@/components/obsidian/Icon.vue'
import Button from '@/components/obsidian/Button.vue'
import Input from '@/components/obsidian/Input.vue'
import Dropdown from '@/components/obsidian/Dropdown.vue'
import Checkbox from '@/components/obsidian/Checkbox.vue'
import CodeField from '@/components/obsidian/CodeField.vue'
import Search from '@/components/obsidian/Search.vue'
import Slider from '@/components/obsidian/Slider.vue'
import Section from '@/components/obsidian/Section.vue'
import Setting from '@/components/obsidian/Setting.vue'
import I18nText from '@/components/obsidian/I18nText.vue'
import NotePicker from '@/components/obsidian/NotePicker.vue'
import Tabs from '@/components/obsidian/Tabs.vue'
import Breadcrumbs from '@/components/obsidian/Breadcrumbs.vue'
import TreeItem from '@/components/obsidian/TreeItem.vue'
import FoldHeading from '@/components/obsidian/FoldHeading.vue'
import DateDivider from '@/components/obsidian/DateDivider.vue'
import EntryRow from '@/components/obsidian/EntryRow.vue'
import GroupHeading from '@/components/obsidian/GroupHeading.vue'
import LabelDot from '@/components/obsidian/LabelDot.vue'
import PeriodSelector from '@/components/obsidian/PeriodSelector.vue'
import Calendar from '@/components/Calendar.vue'
import Card from '@/components/obsidian/Card.vue'
import RequestCard from '@/components/obsidian/RequestCard.vue'
import CardGrid from '@/components/obsidian/CardGrid.vue'
import Badge from '@/components/obsidian/Badge.vue'
import StatusDot from '@/components/obsidian/StatusDot.vue'
import CallNote from '@/components/obsidian/CallNote.vue'
const compactStates = [
  { tone: 'green', label: 'Running' },
  { tone: 'orange', label: 'Paused' },
  { tone: 'faint', label: 'Exited' },
  { tone: 'red', label: 'Connection lost' },
] as const
import Avatar from '@/components/obsidian/Avatar.vue'
import Markdown from '@/components/obsidian/Markdown.vue'
import Table from '@/components/obsidian/Table.vue'
import Waveform from '@/components/obsidian/Waveform.vue'
import QrCode from '@/components/obsidian/QrCode.vue'
import Chart from '@/components/obsidian/Chart.vue'
import SidebarPanel from '@/components/obsidian/SidebarPanel.vue'
import PanelResizeHandle from '@/components/obsidian/PanelResizeHandle.vue'
import FloatingButton from '@/components/obsidian/FloatingButton.vue'
import AnchoredCard, { type CardAnchor } from '@/components/obsidian/AnchoredCard.vue'
import RunReport from '@/components/obsidian/RunReport.vue'
import ShortList from '@/components/obsidian/ShortList.vue'
import StateLine from '@/components/obsidian/StateLine.vue'
import SelectionBar from '@/components/obsidian/SelectionBar.vue'
import { ASK, ADD, NOTE } from '@/components/obsidian/selectionActions'
import IconPicker from '@/components/obsidian/IconPicker.vue'
defineProps<{ page: CataloguePage; variant?: 'inline' | 'stacked' | 'disclosed' }>()
const emit = defineEmits<{ close: []; navigate: [page: CataloguePage] }>()
const titles: Record<CataloguePage, string> = {
  index: 'Examples',
  rows: 'Notes',
  artifact: 'Attachments',
  images: 'Images',
  events: 'Activity',
  details: 'Locations and time',
  states: 'Files and connection',
  waiting: 'Agents',
  comment: 'New comment',
  'comment-thread': 'Comments',
  swatches: 'Highlight colours',
  controls: 'Notebook options',
  navigation: 'Browse notes',
  previews: 'Document previews',
  specialized: 'Recordings and links',
  'icon-picker': 'Choose an icon',
  confirm: 'Delete note',
  prompt: 'New script',
  choice: 'Remove discussion',
  suggestions: 'Picker rows',
  notices: 'Notices with buttons',
}
const suggestionRows = [
  {
    icon: 'git-branch',
    title: 'sample-branch',
    note: 'shown now · default',
    aux: [{ kbd: 'Branch' }],
  },
  { icon: 'tag', title: 'v1.0.0', aux: [{ kbd: 'Tag' }] },
  { title: 'Sample note', note: 'Projects/Samples', aux: [{ flair: '10:30' }] },
  { swatch: 'var(--color-yellow)', title: 'yellow' },
]
const entries = CATALOGUE_PAGES.filter((id) => id !== 'index').map((id) => ({
  id,
  label: titles[id],
}))
const longPages = new Set<CataloguePage>([
  'index',
  'states',
  'details',
  'navigation',
  'previews',
  'specialized',
])
const notes = ref([
  { title: 'sample.md', parent: 'Work', sources: 2, missing: false, expanded: false },
  {
    title: 'A long sample document name that keeps its extension.md',
    parent: 'Archive',
    sources: 1,
    missing: false,
    expanded: false,
  },
  { title: 'missing-sample.md', parent: 'Work', sources: 1, missing: true, expanded: false },
  { title: 'review.md', parent: 'Work', sources: 2, missing: false, expanded: false },
  { title: 'outline.md', parent: 'Archive', sources: 1, missing: false, expanded: false },
])
type Note = (typeof notes.value)[number]
const noteActions = (note: Note) => [
  {
    id: 'reveal',
    label: 'Reveal in file explorer',
    icon: 'folder',
    disabled: note.missing,
    reason: 'File missing',
  },
  ...(note.missing ? [{ id: 'relink', label: 'Relink', icon: 'link' }] : []),
  { id: 'copy', label: 'Copy full path', icon: 'copy' },
  { id: 'unlink', label: 'Unlink note', icon: 'unlink' },
]
const fileAction = (action: string, note: Note) => {
  if (action === 'relink') note.missing = false
  announce(
    action === 'relink'
      ? 'Replacement linked'
      : (noteActions(note).find((a) => a.id === action)?.label ?? action)
  )
}
const now = new Date('2026-04-05T12:00:00Z')
const noteEvents = (note: Note): KitEvent[] => [
  {
    id: `${note.title}-source`,
    title: 'Attached from discussion',
    actor: 'Sample reader',
    source: 'Review discussion',
    time: '2026-04-05T10:15:00Z',
    jump: true,
  },
  ...(note.sources > 1
    ? [
        {
          id: `${note.title}-source2`,
          title: 'Attached from note',
          source: 'outline.md',
          time: '2026-04-04T09:00:00Z',
          jump: true,
        },
      ]
    : []),
]
const events = ref<KitEvent[]>([
  {
    id: 'a',
    title: 'sample.md',
    actor: 'Sample reader',
    source: 'Review discussion',
    time: '2026-04-05T10:15:00Z',
    jump: true,
    detail: 'Attached during the review.',
    detailLabel: 'Source',
  },
  {
    id: 'b',
    title: 'outline.md',
    state: 'missing',
    message: 'Source unavailable',
    time: '2026-04-04T09:00:00Z',
  },
  { id: 'c', title: 'draft.md', state: 'pending', source: 'Review discussion' },
  {
    id: 'd',
    title: 'review.md',
    state: 'error',
    retryable: true,
    retryLabel: 'Retry save',
    message: 'Could not save. Your draft is still here.',
  },
])
const retryEvent = (id: string) => {
  const event = events.value.find((e) => e.id === id)
  if (event) {
    event.state = 'ready'
    event.message = 'Saved'
    event.time = now.toISOString()
  }
}
const sampleImage =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="48"><rect width="64" height="48" fill="white"/><rect x="4" y="4" width="56" height="40" fill="none" stroke="currentColor"/><path d="M8 36L24 18L40 28L56 10" fill="none" stroke="currentColor"/></svg>'
  )
const sampleMarkdown = 'A **sample** reading passage.\n\n> Keep the context beside the note.'
const longQuote = 'The source explains the decision and records the next step. '.repeat(8)
const selectionAnchor = ref<HTMLElement>()
const cardAnchor = ref<CardAnchor | null>(null)
function previewAnchor() {
  if (!selectionAnchor.value) return
  const { left, top, bottom } = selectionAnchor.value.getBoundingClientRect()
  cardAnchor.value = { left, top, bottom }
}
function previewSelection() {
  const sample = selectionAnchor.value?.querySelector('[data-selection-sample]')
  if (!sample) return
  const range = document.createRange()
  range.selectNodeContents(sample)
  const selection = window.getSelection()
  selection?.removeAllRanges()
  selection?.addRange(range)
  document.dispatchEvent(new Event('selectionchange'))
}
const selected = ref(0),
  questionOpen = ref(true),
  preview = ref(false),
  missingImage = ref(true),
  brokenImage = ref(true),
  color = ref<KitColor>('yellow'),
  underline = ref(false),
  draft = ref(''),
  feedback = ref(''),
  replyOpen = ref(false),
  reply = ref(''),
  query = ref(''),
  choice = ref('work'),
  enabled = ref(true),
  position = ref(35),
  picked = ref<string[]>([]),
  tab = ref('notes'),
  folderOpen = ref(true),
  selectedDay = ref(dayjs('2026-04-05')),
  rangeStart = ref(dayjs('2026-04-01')),
  rangeEnd = ref(dayjs('2026-04-30'))
const selectedDayKey = computed(() => selectedDay.value.format('YYYY-MM-DD')) // calendar storage key, not display
// List entries as the panes draw them: a name, its codes, a quiet line of labels, a way out.
const listEntries = ref([
  {
    title: 'Water the sample beds',
    when: '09:30',
    labels: [{ text: 'garden', color: 'green' }],
    note: 'Both beds by the shed.',
    open: false,
    active: true,
  },
  {
    title: 'Order sample seeds with a name long enough to wrap in a narrow pane',
    when: '12.04',
    labels: [{ text: 'errands', color: 'orange' }, { text: 'someday' }],
    note: 'Ask about the late varieties.',
    open: true,
    active: false,
  },
])
const announce = (value: string) => {
  feedback.value = value
}
const select = (title: string, index: number) => {
  selected.value = index
  announce(title)
}
const cancel = () => {
  draft.value = ''
  emit('close')
}
const renderChart = (chart: EChartsType) =>
  chart.setOption({
    xAxis: { type: 'category', data: ['Mon', 'Tue', 'Wed'] },
    yAxis: { type: 'value', name: 'Minutes' },
    series: [{ type: 'bar', data: [1, 3, 2] }],
  })
</script>
<style>
/* A notice shown on its own: Obsidian's gap between stacked notices has nothing to separate here. */
.abele-design-catalogue__notices > .notice {
  margin: 0;
}
.abele-design-catalogue {
  min-width: 0;
  padding-block: var(--size-4-1);
}
/* Sections stand far enough apart that a heading is plainly nearer its own line than the block
   above, a tall phone control under it included (design rule 7). */
.abele-design-catalogue > .abele-section {
  margin-top: var(--size-4-6);
}
.abele-design-catalogue > .abele-section:first-child {
  margin-top: 0;
}
.abele-design-catalogue .abele-list-row__detail > .setting-item-description {
  margin: var(--size-4-1) 0;
}
.abele-design-catalogue__icons {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--size-4-2);
}
.abele-design-catalogue__chart {
  height: calc(var(--size-4-16) * 3);
}
.abele-design-catalogue__panel {
  height: calc(var(--size-4-16) * 4);
  position: relative;
}
.abele-design-catalogue__panel > .abele-resizable-panel {
  position: relative;
  height: 100%;
}
.abele-design-catalogue .abele-floating-button {
  position: static;
}
.abele-design-catalogue .abele-qr {
  max-width: calc(var(--size-4-16) * 2);
}
.abele-design-catalogue > .abele-quote,
.abele-design-catalogue > .abele-swatch-picker,
.abele-design-catalogue > .abele-obsidian-input {
  margin-block: var(--size-4-2);
}
body.is-phone .abele-design-catalogue :is(button, summary, input:not([type='range']), select) {
  min-height: var(--abele-touch-min);
}
</style>
