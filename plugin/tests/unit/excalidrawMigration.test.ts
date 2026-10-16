import { describe, expect, it } from 'vitest'
import { decompressFromBase64 } from '@/canvas/excalidraw/lzString'
import { isExcalidrawName, isExcalidrawNote, parseExcalidraw } from '@/canvas/excalidraw/source'
import { canvasColor, convertExcalidraw, migratedFrom } from '@/canvas/excalidraw/convert'
import {
  baseName,
  migrateAll,
  migrateOne,
  reportText,
  type ExcalidrawVault,
} from '@/canvas/excalidraw/migrate'
import { parseCanvas } from '@/canvas/core/model'
import { linesOf } from '@/canvas/core/primitives'
import { inkOf } from '@/canvas/core/ink'

/** LZ-String's `compressToBase64`, only to make fixtures the way the Excalidraw plugin does. */
function compressToBase64(input: string): string {
  const KEY = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/='
  const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)
  const dict: Record<string, number> = {}
  const toCreate: Record<string, true> = {}
  const out: string[] = []
  let w = ''
  let enlargeIn = 2
  let dictSize = 3
  let numBits = 2
  let val = 0
  let pos = 0
  const bit = (b: number) => {
    val = (val << 1) | b
    if (pos === 5) {
      pos = 0
      out.push(KEY.charAt(val))
      val = 0
    } else pos++
  }
  const bits = (n: number, v: number) => {
    for (let i = 0; i < n; i++) {
      bit(v & 1)
      v >>= 1
    }
  }
  const grow = () => {
    if (--enlargeIn === 0) {
      enlargeIn = 2 ** numBits
      numBits++
    }
  }
  const emit = () => {
    if (has(toCreate, w)) {
      const code = w.charCodeAt(0)
      if (code < 256) {
        bits(numBits, 0)
        bits(8, code)
      } else {
        bits(numBits, 1)
        bits(16, code)
      }
      grow()
      delete toCreate[w]
    } else bits(numBits, dict[w])
    grow()
  }
  for (let i = 0; i < input.length; i++) {
    const c = input.charAt(i)
    if (!has(dict, c)) {
      dict[c] = dictSize++
      toCreate[c] = true
    }
    if (has(dict, w + c)) w = w + c
    else {
      emit()
      dict[w + c] = dictSize++
      w = c
    }
  }
  if (w !== '') emit()
  bits(numBits, 2)
  for (;;) {
    val <<= 1
    if (pos === 5) {
      out.push(KEY.charAt(val))
      break
    }
    pos++
  }
  const res = out.join('')
  return res + ['', '===', '==', '='][res.length % 4]
}

const base = {
  angle: 0,
  strokeColor: '#1e1e1e',
  backgroundColor: 'transparent',
  fillStyle: 'solid',
  strokeWidth: 2,
  strokeStyle: 'solid',
  roughness: 0,
  opacity: 100,
  groupIds: [],
  frameId: null,
  roundness: null,
  isDeleted: false,
  locked: false,
  link: null,
}
const el = (props: Record<string, unknown>) => ({ ...base, width: 100, height: 60, ...props })

/** An invented scene with one of every kind of element the migrator knows about. */
function sampleElements() {
  return [
    el({
      id: 'frame-a',
      type: 'frame',
      x: -50,
      y: -50,
      width: 900,
      height: 700,
      name: 'Sample frame',
    }),
    el({
      id: 'box-a',
      type: 'rectangle',
      x: 0,
      y: 0,
      strokeColor: '#e03131',
      backgroundColor: '#ffc9c9',
      strokeStyle: 'dashed',
      roughness: 1,
      roundness: { type: 3 },
      boundElements: [{ id: 'box-a-text', type: 'text' }],
    }),
    el({
      id: 'box-a-text',
      type: 'text',
      x: 10,
      y: 20,
      text: 'Alpha box',
      originalText: 'Alpha box',
      fontSize: 20,
      fontFamily: 5,
      containerId: 'box-a',
    }),
    el({ id: 'oval-b', type: 'ellipse', x: 300, y: 0, groupIds: ['g1'] }),
    el({
      id: 'oval-b-text',
      type: 'text',
      x: 310,
      y: 20,
      text: 'Beta',
      fontFamily: 2,
      containerId: 'oval-b',
    }),
    el({ id: 'rhombus-c', type: 'diamond', x: 0, y: 200, angle: 0.5, locked: true }),
    el({
      id: 'arrow-ab',
      type: 'arrow',
      x: 100,
      y: 30,
      points: [
        [0, 0],
        [100, -20],
        [200, 0],
      ],
      startBinding: { elementId: 'box-a-text', focus: 0, gap: 4 },
      endBinding: { elementId: 'oval-b', focus: 0, gap: 4 },
      startArrowhead: null,
      endArrowhead: 'arrow',
      strokeStyle: 'dotted',
    }),
    el({
      id: 'arrow-ab-label',
      type: 'text',
      x: 150,
      y: 10,
      text: 'leads to',
      fontFamily: 2,
      containerId: 'arrow-ab',
    }),
    el({
      id: 'loose-arrow',
      type: 'arrow',
      x: 500,
      y: 300,
      points: [
        [0, 0],
        [50, 0],
        [50, 80],
      ],
      roundness: { type: 2 },
      startBinding: { elementId: 'box-a', focus: 0, gap: 1 },
      endBinding: null,
      startArrowhead: 'dot',
      endArrowhead: 'triangle',
    }),
    el({
      id: 'plain-line',
      type: 'line',
      x: 600,
      y: 100,
      points: [
        [0, 0],
        [0, 0],
        [120, 40],
      ],
      strokeColor: '#2f9e44',
    }),
    el({
      id: 'pencil-a',
      type: 'freedraw',
      x: 50,
      y: 400,
      points: [
        [0, 0],
        [10, 5],
        [20, 4],
      ],
      pressures: [0.2, 0.6, 0.9],
      simulatePressure: false,
      strokeColor: '#1971c2',
    }),
    el({
      id: 'highlight-a',
      type: 'freedraw',
      x: 50,
      y: 450,
      opacity: 40,
      points: [
        [0, 0],
        [40, 0],
      ],
      pressures: [],
      simulatePressure: true,
      strokeColor: '#ffd43b',
    }),
    el({
      id: 'loose-text',
      type: 'text',
      x: 400,
      y: 400,
      width: 120,
      height: 25,
      text: 'Loose words',
      fontSize: 48,
      fontFamily: 2,
      strokeColor: '#9c36b5',
      link: 'https://example.invalid/sample',
    }),
    el({ id: 'pic-file', type: 'image', x: 600, y: 300, fileId: 'fid-file' }),
    el({ id: 'pic-tex', type: 'image', x: 600, y: 400, fileId: 'fid-tex' }),
    el({ id: 'pic-nested', type: 'image', x: 600, y: 500, fileId: 'fid-nested' }),
    el({ id: 'pic-gone', type: 'image', x: 600, y: 600, fileId: 'fid-gone' }),
    el({ id: 'embed-note', type: 'embeddable', x: 200, y: 500, link: '[[Sample note#Part]]' }),
    el({
      id: 'embed-web',
      type: 'embeddable',
      x: 200,
      y: 600,
      link: 'https://example.invalid/page',
    }),
    el({ id: 'web-thing', type: 'iframe', x: 0, y: 600 }),
    el({ id: 'gone-box', type: 'rectangle', x: 0, y: 0, isDeleted: true }),
  ]
}

const sceneJson = (elements: unknown[], files: Record<string, unknown> = {}) =>
  JSON.stringify({ type: 'excalidraw', version: 2, source: 'test', elements, appState: {}, files })

function noteText(json: string, compressed = true): string {
  const block = compressed ? compressToBase64(json).replace(/(.{64})/g, '$1\n\n') : json
  return [
    '---',
    'excalidraw-plugin: parsed',
    'tags: [excalidraw]',
    '---',
    '==⚠  Switch to EXCALIDRAW VIEW in the MORE OPTIONS menu of this document. ⚠==',
    '',
    '# Excalidraw Data',
    '## Text Elements',
    'Alpha box ^box-a-text',
    '',
    'Beta [[Sample note]] ^oval-b-text',
    '',
    '## Embedded Files',
    'fid-file: [[sample-image.png]]',
    'fid-tex: $$x^2 + y^2$$',
    'fid-nested: [[Other sketch.excalidraw]]',
    'fid-gone: [[missing-image.png]]',
    '',
    '%%',
    '## Drawing',
    '```' + (compressed ? 'compressed-json' : 'json'),
    block,
    '```',
    '%%',
    '',
  ].join('\n')
}

const VAULT_FILES = ['sample-image.png', 'Other sketch.excalidraw.md', 'Sample note.md']
const resolve = (link: string) =>
  VAULT_FILES.find((f) => f === link || f.replace(/\.md$/, '') === link) ?? null

describe('lz-string decompression', () => {
  it('reads back what the plugin compressed, wrapped over lines, unicode included', () => {
    const text = sceneJson(sampleElements()) + ' Ünïcødé ✓ 日本'
    const packed = compressToBase64(text).replace(/(.{40})/g, '$1\n')
    expect(decompressFromBase64(packed)).toBe(text)
  })
  it('refuses what is not a stream', () => {
    expect(decompressFromBase64('')).toBeNull()
    expect(decompressFromBase64('not base64 at all!')).toBeNull()
  })
})

describe('reading an Excalidraw file', () => {
  it('knows a drawing by its name or its frontmatter', () => {
    expect(isExcalidrawName('A/Plan.excalidraw.md')).toBe(true)
    expect(isExcalidrawName('Plan.excalidraw')).toBe(true)
    expect(isExcalidrawName('Plan.md')).toBe(false)
    expect(isExcalidrawNote(noteText('{}'))).toBe(true)
    expect(isExcalidrawNote('---\ntags: [x]\n---\nplain')).toBe(false)
  })
  it('reads a compressed note, its texts and embedded files, and drops deleted elements', () => {
    const scene = parseExcalidraw(noteText(sceneJson(sampleElements())), 'Sketch.excalidraw.md')
    expect(scene.elements.find((e) => e.id === 'gone-box')).toBeUndefined()
    expect(scene.elements.length).toBe(sampleElements().length - 1)
    expect(scene.texts.get('oval-b-text')).toBe('Beta [[Sample note]]')
    expect(scene.embedded.get('fid-tex')).toBe('$$x^2 + y^2$$')
  })
  it('reads a plain json note and a plain .excalidraw file alike', () => {
    const json = sceneJson(sampleElements())
    expect(parseExcalidraw(noteText(json, false), 'S.md').elements.length).toBe(
      parseExcalidraw(json, 'S.excalidraw').elements.length
    )
  })
  it('reads element links kept in the markdown note', () => {
    const json = sceneJson([el({ id: 'linked-box', type: 'rectangle', x: 0, y: 0 })])
    const note = noteText(json, false).replace(
      '## Embedded Files',
      '## Element Links\nlinked-box: [[Sample destination]]\n\n## Embedded Files'
    )
    const result = convertExcalidraw(parseExcalidraw(note, 'Sample.excalidraw.md'), {
      source: 'Sample.excalidraw.md',
      resolve,
    })
    expect(result.graph.nodes[0].text).toBe('[[Sample destination]]')
  })
  it('says why when there is nothing to read', () => {
    expect(() => parseExcalidraw('# Just a note', 'Plain.excalidraw.md')).toThrow(/No drawing data/)
    expect(() => parseExcalidraw('{oops', 'Broken.excalidraw')).toThrow(/not valid JSON/)
  })
})

describe('converting a scene to a canvas', () => {
  const scene = parseExcalidraw(noteText(sceneJson(sampleElements())), 'Sketch.excalidraw.md')
  const result = convertExcalidraw(scene, { source: 'Sketch.excalidraw.md', resolve })
  const { graph } = result
  const node = (id: string) => graph.nodes.find((n) => n.id === id)!
  const lost = (what: RegExp) => result.losses.find((l) => what.test(l.what))?.count ?? 0

  it('is a valid canvas that remembers its drawing', () => {
    expect(() => parseCanvas(graph)).not.toThrow()
    expect(migratedFrom(graph)).toBe('Sketch.excalidraw.md')
  })
  it('makes shapes shaped cards with their text, colour and border', () => {
    expect(node('box-a')).toMatchObject({
      type: 'text',
      text: 'Alpha box',
      color: '#e03131',
      x: 0,
      y: 0,
      width: 100,
      height: 60,
      styleAttributes: { shape: 'rectangle', border: 'dashed' },
    })
    // The note's own text wins over the scene's: it keeps the markdown links.
    expect(node('oval-b')).toMatchObject({
      text: 'Beta [[Sample note]]',
      styleAttributes: { shape: 'circle' },
    })
    expect(node('rhombus-c').styleAttributes).toEqual({ shape: 'diamond' })
  })
  it('puts frames first, as groups with their name', () => {
    expect(graph.nodes[0]).toMatchObject({ id: 'frame-a', type: 'group', label: 'Sample frame' })
  })
  it('makes an arrow tied at both ends a connector, through a shape’s own text too', () => {
    expect(graph.edges).toEqual([
      expect.objectContaining({
        id: 'arrow-ab',
        fromNode: 'box-a',
        toNode: 'oval-b',
        fromSide: 'right',
        toSide: 'left',
        fromEnd: 'none',
        toEnd: 'arrow',
        label: 'leads to',
        styleAttributes: { path: 'dotted' },
      }),
    ])
  })
  it('makes other arrows and lines free straight lines, step by step', () => {
    const lines = linesOf(graph)
    const loose = lines.filter((l) => l.id.startsWith('loose-arrow'))
    expect(loose).toEqual([
      expect.objectContaining({
        from: { x: 500, y: 300 },
        to: { x: 550, y: 300 },
        fromEnd: 'arrow',
      }),
      expect.objectContaining({ from: { x: 550, y: 300 }, to: { x: 550, y: 380 }, toEnd: 'arrow' }),
    ])
    // A step of no length is left out.
    expect(lines.filter((l) => l.id.startsWith('plain-line'))).toEqual([
      expect.objectContaining({
        from: { x: 600, y: 100 },
        to: { x: 720, y: 140 },
        color: '#2f9e44',
      }),
    ])
  })
  it('makes pencil strokes ink with their pressure, a see-through one marker', () => {
    const ink = inkOf(graph)
    expect(ink.find((s) => s.id === 'pencil-a')).toMatchObject({
      tool: 'pen',
      color: '#1971c2',
      points: [50, 400, 0.2, 60, 405, 0.6, 70, 404, 0.9],
    })
    expect(ink.find((s) => s.id === 'highlight-a')).toMatchObject({
      tool: 'marker',
      points: [50, 450, 0.5, 90, 450, 0.5],
    })
  })
  it('makes free text a borderless card with its link', () => {
    expect(node('loose-text')).toMatchObject({
      type: 'text',
      text: 'Loose words\n\n[https://example.invalid/sample](https://example.invalid/sample)',
      styleAttributes: { border: 'invisible' },
      x: 384,
      y: 384,
      width: 152,
      height: 57,
    })
  })
  it('makes pictures, formulas, nested drawings and embeds cards', () => {
    expect(node('pic-file')).toMatchObject({ type: 'file', file: 'sample-image.png' })
    expect(node('pic-tex')).toMatchObject({ type: 'text', text: '$$\nx^2 + y^2\n$$' })
    expect(node('pic-nested')).toMatchObject({ type: 'file', file: 'Other sketch.excalidraw.md' })
    expect(graph.nodes.find((n) => n.id === 'pic-gone')).toBeUndefined()
    expect(node('embed-note')).toMatchObject({
      type: 'file',
      file: 'Sample note.md',
      subpath: '#Part',
    })
    expect(node('embed-web')).toMatchObject({ type: 'link', url: 'https://example.invalid/page' })
  })
  it('counts what did not come across, by kind', () => {
    expect(lost(/^Fill colour/)).toBe(1)
    expect(lost(/^Rounded corners/)).toBe(1)
    expect(lost(/^Hand-drawn look/)).toBe(1)
    expect(lost(/^Handwritten font/)).toBe(1)
    expect(lost(/^Text size/)).toBe(1)
    expect(lost(/^Text colour/)).toBe(1)
    expect(lost(/^Rotation/)).toBe(1)
    expect(lost(/^Locked/)).toBe(1)
    expect(lost(/^Grouping/)).toBe(1)
    expect(lost(/^Arrow route/)).toBe(1)
    expect(lost(/^Arrowhead style/)).toBe(1)
    expect(lost(/^Curves/)).toBe(1)
    expect(lost(/^LaTeX/)).toBe(1)
    expect(lost(/^Drawing inside the drawing/)).toBe(1)
    expect(lost(/^Picture whose file is missing/)).toBe(1)
    expect(lost(/^Web elements/)).toBe(1)
    expect(lost(/^Transparency/)).toBe(0)
    expect(result.counts).toEqual({ cards: 10, connectors: 1, lines: 3, strokes: 2 })
  })
  it('turns a rotated line about its middle', () => {
    const turned = convertExcalidraw(
      {
        elements: [
          el({
            id: 'turned',
            type: 'line',
            x: 0,
            y: 0,
            angle: Math.PI / 2,
            points: [
              [0, 0],
              [100, 0],
            ],
          }) as never,
        ],
        files: {},
        embedded: new Map(),
        texts: new Map(),
      },
      { source: 'x.excalidraw', resolve }
    )
    expect(linesOf(turned.graph)[0]).toMatchObject({
      from: { x: 50, y: -50 },
      to: { x: 50, y: 50 },
    })
    expect(turned.losses.find((l) => l.what === 'Rotation')).toBeUndefined()
  })
  it('reads colours the way the canvas keeps them', () => {
    expect(canvasColor('#ABC')).toBe('#aabbcc')
    expect(canvasColor('#1e1e1e')).toBeUndefined()
    expect(canvasColor('transparent')).toBeUndefined()
    expect(canvasColor('#11223344')).toBe('#112233')
  })
})

/** A vault in memory, as the migrator sees one. */
function memoryVault(files: Record<string, string>) {
  const binary = new Map<string, ArrayBuffer>()
  const vault: ExcalidrawVault & { files: Record<string, string>; binary: typeof binary } = {
    files,
    binary,
    rewriteReferences: async () => ({ rewritten: 0, files: [] }),
    drawings: async () => Object.keys(files).filter(isExcalidrawName).sort(),
    read: async (path) => {
      if (!(path in files)) throw new Error(`No file ${path}`)
      return files[path]
    },
    exists: (path) => path in files || binary.has(path),
    createText: async (path, text) => {
      if (vault.exists(path)) throw new Error('exists')
      files[path] = text
    },
    createBinary: async (path, data) => {
      if (vault.exists(path)) throw new Error('exists')
      binary.set(path, data)
      return async () => {
        if (binary.get(path) === data) binary.delete(path)
      }
    },
    resolve: (link) => resolve(link),
    migrated: async () =>
      new Map(
        Object.entries(files).flatMap(([path, text]) => {
          if (!path.endsWith('.canvas')) return []
          const from = migratedFrom(JSON.parse(text))
          return from ? [[from, path] as [string, string]] : []
        })
      ),
  }
  return vault
}

describe('migrating drawings', () => {
  it('rewrites references only after publishing and reports their count', async () => {
    const vault = memoryVault({ 'Sample.excalidraw': sceneJson([]) })
    vault.rewriteReferences = async (source, target) => {
      expect(source).toBe('Sample.excalidraw')
      expect(vault.files[target]).toBeDefined()
      return { rewritten: 3, files: [{ path: 'Sample note.md', count: 3 }] }
    }
    expect(await migrateOne(vault, 'Sample.excalidraw')).toMatchObject({
      status: 'migrated',
      references: { rewritten: 3, files: [{ path: 'Sample note.md', count: 3 }] },
    })
  })
  it('keeps the published canvas and pictures if a reference update fails', async () => {
    const vault = memoryVault({ 'Sample.excalidraw': pictureDrawing() })
    vault.rewriteReferences = async () => {
      throw new Error('Sample reference failure')
    }
    const report = await migrateOne(vault, 'Sample.excalidraw')
    expect(report).toMatchObject({
      status: 'migrated',
      references: {
        rewritten: 0,
        files: [{ path: 'Sample.excalidraw', count: 0, error: 'Error: Sample reference failure' }],
      },
    })
    expect(vault.files['Sample.canvas']).toBeDefined()
    expect(vault.binary.size).toBe(2)
  })
  const pictureDrawing = () =>
    sceneJson(
      ['firstpic', 'secondpic'].map((fileId) =>
        el({
          id: fileId,
          type: 'image',
          x: 0,
          y: 0,
          fileId,
        })
      ),
      Object.fromEntries(
        ['firstpic', 'secondpic'].map((id) => [
          id,
          {
            mimeType: 'image/png',
            dataURL: 'data:image/png;base64,AAAA',
          },
        ])
      )
    )

  it('removes only its extracted pictures when the canvas write fails', async () => {
    const source = pictureDrawing()
    const vault = memoryVault({ 'Sample.excalidraw': source, 'Sample.canvas': '{}' })
    const existing = new Uint8Array([9]).buffer
    vault.binary.set('Sample firstpic.png', existing)
    vault.createText = async () => {
      throw new Error('Sample canvas write failure')
    }
    const report = await migrateOne(vault, 'Sample.excalidraw')
    expect(report).toMatchObject({ status: 'failed', reason: 'Sample canvas write failure' })
    expect([...vault.binary]).toEqual([['Sample firstpic.png', existing]])
    expect(vault.files).toEqual({ 'Sample.excalidraw': source, 'Sample.canvas': '{}' })
  })

  it('cleans earlier pictures without deleting a file whose creation failed', async () => {
    const vault = memoryVault({ 'Sample.excalidraw': pictureDrawing() })
    const create = vault.createBinary
    const raced = new Uint8Array([7]).buffer
    vault.createBinary = async (path, data) => {
      if (path.endsWith('secondpi.png')) {
        vault.binary.set(path, raced)
        throw new Error('exists')
      }
      return create(path, data)
    }
    expect((await migrateOne(vault, 'Sample.excalidraw')).status).toBe('failed')
    expect([...vault.binary]).toEqual([['Sample secondpi.png', raced]])
  })
  it('names the canvas after the drawing, beside it', () => {
    expect(baseName('Sketches/Plan.excalidraw.md')).toEqual({ dir: 'Sketches/', base: 'Plan' })
    expect(baseName('Plan.excalidraw')).toEqual({ dir: '', base: 'Plan' })
    expect(baseName('Notes/Board.md')).toEqual({ dir: 'Notes/', base: 'Board' })
  })
  it('makes a new canvas beside one drawing, never touching it, and a second only when asked', async () => {
    const original = noteText(sceneJson(sampleElements()))
    const vault = memoryVault({
      'Sketches/Plan.excalidraw.md': original,
      'Sketches/Plan.canvas': '{}',
    })
    const first = await migrateOne(vault, 'Sketches/Plan.excalidraw.md')
    expect(first).toMatchObject({ status: 'migrated', target: 'Sketches/Plan 2.canvas' })
    expect(vault.files['Sketches/Plan.excalidraw.md']).toBe(original)
    expect(vault.files['Sketches/Plan.canvas']).toBe('{}')
    expect(first.losses.length).toBeGreaterThan(0)
    const again = await migrateOne(vault, 'Sketches/Plan.excalidraw.md')
    expect(again).toMatchObject({ status: 'skipped', target: 'Sketches/Plan 2.canvas' })
    const forced = await migrateOne(vault, 'Sketches/Plan.excalidraw.md', { force: true })
    expect(forced).toMatchObject({ status: 'migrated', target: 'Sketches/Plan 3.canvas' })
  })
  it('writes a picture kept inside a plain drawing beside the canvas', async () => {
    const png = 'data:image/png;base64,' + btoa('fake-png-bytes')
    const json = sceneJson(
      [el({ id: 'inside-pic', type: 'image', x: 0, y: 0, fileId: 'abcdef123456' })],
      { abcdef123456: { mimeType: 'image/png', dataURL: png } }
    )
    const vault = memoryVault({ 'Board.excalidraw': json })
    const report = await migrateOne(vault, 'Board.excalidraw')
    expect(report.status).toBe('migrated')
    expect(new TextDecoder().decode(vault.binary.get('Board abcdef12.png'))).toBe('fake-png-bytes')
    expect(JSON.parse(vault.files['Board.canvas']).nodes[0]).toMatchObject({
      type: 'file',
      file: 'Board abcdef12.png',
    })
  })
  it('keeps a picture id that names folders out of the picture’s path', async () => {
    const json = sceneJson(
      [el({ id: 'odd-pic', type: 'image', x: 0, y: 0, fileId: '../../up/../x' })],
      { '../../up/../x': { mimeType: 'image/png', dataURL: 'data:image/png;base64,AAAA' } }
    )
    const vault = memoryVault({ 'Art/Board.excalidraw': json })
    await migrateOne(vault, 'Art/Board.excalidraw')
    expect([...vault.binary.keys()]).toEqual(['Art/Board upx.png'])
  })
  it('goes through the whole vault and reports each drawing', async () => {
    const vault = memoryVault({
      'One.excalidraw.md': noteText(sceneJson(sampleElements())),
      'Two.excalidraw': sceneJson([el({ id: 'only-box', type: 'rectangle', x: 0, y: 0 })]),
      'Broken.excalidraw.md': '---\nexcalidraw-plugin: parsed\n---\nno drawing here',
      'Plain note.md': 'nothing to see',
    })
    await migrateOne(vault, 'Two.excalidraw')
    const progress: number[] = []
    const report = await migrateAll(vault, { onProgress: (done) => progress.push(done) })
    expect(report).toMatchObject({ migrated: 1, skipped: 1, failed: 1 })
    expect(report.files.map((f) => [f.source, f.status])).toEqual([
      ['Broken.excalidraw.md', 'failed'],
      ['One.excalidraw.md', 'migrated'],
      ['Two.excalidraw', 'skipped'],
    ])
    expect(progress).toEqual([0, 1, 2, 3])
    const text = reportText(report)
    expect(text).toMatch(/^1 migrated, 1 skipped, 1 failed\./)
    expect(text).toContain('Broken.excalidraw.md: failed — No drawing data found in the file')
    expect(text).toContain('One.excalidraw.md → One.canvas. Not carried over:')
  })
})
