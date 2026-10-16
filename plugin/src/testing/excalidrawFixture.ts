/** An invented Excalidraw migration, for the dialog's pictures: names are visibly made up. */
import type { MigrationReport } from '@/canvas/excalidraw/migrate'

export const excalidrawDrawings = [
  'Sketches/Sample plan.excalidraw.md',
  'Sketches/Example flow.excalidraw.md',
  'Sketches/Demo board.excalidraw',
  'Archive/Old sample.excalidraw.md',
  'Archive/Broken sample.excalidraw.md',
]

export const excalidrawReport = (): MigrationReport => ({
  migrated: 3,
  skipped: 1,
  failed: 1,
  files: [
    {
      source: 'Sketches/Sample plan.excalidraw.md',
      status: 'migrated',
      target: 'Sketches/Sample plan.canvas',
      losses: [
        { what: 'Hand-drawn look', count: 14 },
        { what: 'Fill colour', count: 6 },
        { what: 'Handwritten font', count: 9 },
        { what: 'Grouping (items stay apart)', count: 3 },
      ],
    },
    {
      source: 'Sketches/Example flow.excalidraw.md',
      status: 'migrated',
      target: 'Sketches/Example flow.canvas',
      losses: [
        { what: 'Hand-drawn look', count: 8 },
        { what: 'Arrow route (the canvas draws its own)', count: 4 },
        { what: 'LaTeX formula (now a formula in a card)', count: 1 },
      ],
    },
    {
      source: 'Sketches/Demo board.excalidraw',
      status: 'migrated',
      target: 'Sketches/Demo board.canvas',
      losses: [],
    },
    {
      source: 'Archive/Old sample.excalidraw.md',
      status: 'skipped',
      target: 'Archive/Old sample.canvas',
      losses: [],
      reason: 'A canvas was already made from it',
    },
    {
      source: 'Archive/Broken sample.excalidraw.md',
      status: 'failed',
      losses: [],
      reason: 'No drawing data found in the file',
    },
  ],
})
