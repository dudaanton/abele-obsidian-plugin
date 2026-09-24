/**
 * Go to definition's patterns, language by language: each must find the line that declares the
 * name and pass over the lines that only use it. It is a heuristic, so the negative cases are the
 * ones that matter — a call must never be offered as the definition.
 */
import { describe, it, expect } from 'vitest'
import {
  definitionPattern,
  findDefinitions,
  languageOf,
  type Lang,
} from '@/github/search/definitions'
import { searchText } from '@/github/search/textSearch'

const declares = (lang: Lang, name: string, line: string) =>
  searchText(line, definitionPattern(lang, name)).length > 0

const cases: Record<Lang, { yes: string[]; no: string[] }> = {
  ts: {
    yes: [
      'export function render(a: string) {',
      'async function render() {',
      'export default function render() {}',
      'function* render() {',
      'export class render {',
      'export abstract class render<T> extends Base {',
      'interface render {',
      'export type render = string',
      'export const enum render {',
      'const render = () => 1',
      'export let render: Fn = make()',
      '  render(): string {',
      '  private async render(x: number): Promise<void> {',
      '  static render<T>(x: T) {',
      '  render = (x: number) => x',
      '  render: async (x) => {',
    ],
    no: [
      '    return render(this.name)',
      'render(x)',
      'const x = render()',
      "import { render } from './render'",
      'if (render) {',
      '  render(() => {',
      '// render the thing',
    ],
  },
  python: {
    yes: [
      'def render(self):',
      '    async def render(x):',
      'class render(Base):',
      'render = make()',
    ],
    no: ['    return render(x)', '    render = 1', 'if render == 2:', 'x = render'],
  },
  go: {
    yes: [
      'func render(w *Widget) string {',
      'func (w *Widget) render() string {',
      'func render[T any](x T) {',
      'type render struct {',
      'var render = 1',
      'const render = "x"',
    ],
    no: ['\treturn render(w)', 'x := render()', '\tw.render()'],
  },
  java: {
    yes: [
      'public class render {',
      '  public static String render(Widget w) {',
      '  private final List<String> render(int x) throws IOException {',
      '  void render() {',
      'public enum render {',
      '  private static final int render = 3;',
    ],
    no: ['    return render(w);', '    render(w);', '    x = render(w);', '    new render();'],
  },
  kotlin: {
    yes: [
      'fun render(w: Widget): String {',
      'fun <T> T.render() = 1',
      'class render(val x: Int)',
      'val render = 1',
      'object render {',
    ],
    no: ['    return render(w)', 'render(w)'],
  },
  csharp: {
    yes: [
      'public class render {',
      '  public async Task<string> render(int x)',
      'public record render(int X);',
      'public struct render {',
    ],
    no: ['    return render(x);', '    await render(x);'],
  },
  swift: {
    yes: [
      'func render(_ w: Widget) -> String {',
      'struct render {',
      'protocol render {',
      'let render = 1',
      'enum render {',
    ],
    no: ['    return render(w)', 'render(w)'],
  },
  rust: {
    yes: [
      'pub fn render(w: &Widget) -> String {',
      'fn render<T>(x: T) {',
      'pub struct render {',
      'trait render {',
      'const render: u32 = 1;',
      'macro_rules! render {',
    ],
    no: ['    render(w);', '    let x = render(w);', '    w.render()'],
  },
  ruby: {
    yes: [
      'def render',
      '  def self.render(x)',
      'class render < Base',
      'module render',
      '  attr_reader :render',
    ],
    no: ['    render(x)', '    x.render'],
  },
  php: {
    yes: [
      'function render($w) {',
      '  public function render(): string {',
      'class render {',
      '  const render = 1;',
    ],
    no: ['    return render($w);', '    $this->render();'],
  },
  c: {
    yes: [
      'static int render(struct widget *w) {',
      'char *render(void)',
      'void Widget::render() const {',
      '#define render(x) ((x) + 1)',
      'struct render {',
      'typedef struct widget render;',
      'class render : public Base {',
    ],
    no: ['    return render(w);', '    render(w);', '    if (render(w)) {', '    x = render(w);'],
  },
  other: {
    yes: ['function render', 'def render'],
    no: ['render()'],
  },
}

describe('declaration patterns', () => {
  for (const [lang, { yes, no }] of Object.entries(cases) as [
    Lang,
    { yes: string[]; no: string[] },
  ][]) {
    describe(lang, () => {
      for (const line of yes)
        it(`finds: ${line}`, () => expect(declares(lang, 'render', line)).toBe(true))
      for (const line of no)
        it(`passes over: ${line}`, () => expect(declares(lang, 'render', line)).toBe(false))
    })
  }

  it('does not take a longer name that starts with the one asked for', () => {
    expect(declares('ts', 'render', 'function renderAll() {')).toBe(false)
    expect(declares('go', 'render', 'func renderAll() {')).toBe(false)
  })

  it("names the declaration's own line, not the blank line before it", () => {
    const cases = [
      ['a.ts', 'x\n\n  function render() {'],
      ['a.py', 'x\n\n    def render(self):'],
      ['a.rb', 'x\n\n  def render'],
      ['a.go', 'x\n\ntype render struct {'],
    ]
    for (const [path, text] of cases) {
      expect(findDefinitions([{ path, text }], 'render').map((h) => h.line)).toEqual([3])
    }
  })

  it('never reads a call spread over lines as a declaration', () => {
    // The shape that fooled it in pinia's type tests: the call's `(` and a method's `) {` below.
    const text = "render('', {\n  actions: {\n    a() {\n    },\n  },\n})"
    expect(findDefinitions([{ path: 'a.spec.ts', text }], 'render')).toEqual([])
    const java = 'x = render(a,\n  b);\n  foo(\n  ) {'
    expect(findDefinitions([{ path: 'A.java', text: java }], 'render')).toEqual([])
  })

  it('takes a name with a dollar sign', () => {
    expect(declares('ts', '$el', 'const $el = document.body')).toBe(true)
  })
})

describe('languages', () => {
  it('is told by the extension', () => {
    expect(languageOf('src/a.tsx')).toBe('ts')
    expect(languageOf('a/b.py')).toBe('python')
    expect(languageOf('x.hpp')).toBe('c')
    expect(languageOf('Makefile')).toBe('other')
  })
})

describe('finding definitions across files', () => {
  const files = [
    { path: 'lib/other/render.ts', text: 'export function render() {}' },
    { path: 'src/ui/widget.ts', text: 'export class Widget {\n  render() {\n  }\n}\nrender()' },
    { path: 'src/ui/panel.ts', text: 'export const render = () => 1' },
    { path: 'tools/render.py', text: 'def render():\n    pass' },
    { path: 'src/ui/nothing.ts', text: 'render()' },
  ]

  it('puts the same file first, then its folder, then its language, then the rest', () => {
    const hits = findDefinitions(files, 'render', 'src/ui/widget.ts')
    expect(hits.map((h) => `${h.path}:${h.line}`)).toEqual([
      'src/ui/widget.ts:2',
      'src/ui/panel.ts:1',
      'lib/other/render.ts:1',
      'tools/render.py:1',
    ])
  })

  it('finds nothing for something that is not a name', () => {
    expect(findDefinitions(files, '+=', 'a.ts')).toEqual([])
  })
})
