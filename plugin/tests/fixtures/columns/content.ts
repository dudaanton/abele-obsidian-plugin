/** Invented, portable content samples; each is rendered in its own two-column note. */
export const COLUMN_CONTENT = [
  { name: 'lists', body: '- First sample\n  - Nested sample\n- Second sample', selector: 'ul ul' },
  {
    name: 'tables',
    body: '| WideUnbrokenSampleHeadingAlpha | WideUnbrokenSampleHeadingBeta | WideUnbrokenSampleHeadingGamma |\n| --- | --- | --- |\n| One | Two | Three |',
    selector: '.abele-column-table table',
  },
  {
    name: 'code',
    body: '```js\nconst sample = "' + 'sample-'.repeat(70) + '"\n```',
    selector: 'pre code',
  },
  {
    name: 'math',
    body: 'Inline $x^2$ and display:\n\n$$\nx^2 + y^2 = 1\n$$',
    selector: '.math-block',
  },
  {
    name: 'attachments',
    body: '![[sample-image.svg]]\n\n![[sample-embed]]',
    selector: '.markdown-embed-content',
  },
  {
    name: 'tasks',
    body: '- [ ] First sample task\n- [ ] Second sample task',
    selector: 'input.task-list-item-checkbox',
  },
  {
    name: 'gallery',
    body: '::abele-gallery{layout=grid,height=160}::\n![[sample-image.svg]]\n![[sample-image.svg|Second sample]]',
    selector: '.abele-gallery-widget-container img',
  },
  {
    name: 'diagrams',
    body: '```mermaid\nflowchart LR\n A[Sample start] --> B[Sample middle] --> C[Sample finish]\n```',
    selector: '.abele-mermaid svg',
  },
  {
    name: 'maps',
    body: '```abele-map\ncenter: [0, 0]\nzoom: 2\nheight: 220\ninteractive: false\n```',
    selector: '.abele-map canvas',
  },
  {
    name: 'charts',
    body: '```abele-chart\ntype: bar\nheight: 220\nxLabels: [One, Two, Three]\nseries:\n  - name: Sample\n    data: [2, 4, 3]\n```',
    selector: '.abele-chart-container canvas',
  },
] as const

export function columnContentNote(body: string): string {
  return (
    'Before the sample.\n\n> [!abele-columns|ratio=2:1 mobile=stack]\n> > [!abele-column] Sample content\n' +
    body
      .split('\n')
      .map((line) => '> >' + (line ? ' ' + line : ''))
      .join('\n') +
    '\n>\n> > [!abele-column] Companion\n> > A companion paragraph.\n\nAfter the sample.\n'
  )
}
