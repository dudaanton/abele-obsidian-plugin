import type { AgentTool } from '../client'

const CHART_DOCS = `# abele-chart Codeblock Reference

Create charts in any note using a \`\`\`abele-chart\`\`\` codeblock with YAML configuration.

## Chart Types
\`line\`, \`bar\`, \`scatter\`, \`pie\`

## Basic Structure
\`\`\`yaml
type: line          # chart type (default: line)
height: 300         # pixel height (default: 300)
title: My Chart     # optional title
smooth: true        # smooth lines (default: false)
showDots: true      # show data points (default: true for data, false for formulas)
legend: false       # show legend (default: true when multiple series)
precision: 2        # decimal places in tooltip (default: 2)
xAxis: Time         # optional x-axis label
yAxis: Value        # optional y-axis label
series:
  - name: Series 1
    data: [[Jan, 10], [Feb, 20], [Mar, 15]]
\`\`\`

## Data Series
Each series can use either \`data\` (explicit points) or \`formula\` (mathematical expression).

### Explicit data
\`\`\`yaml
series:
  - name: Revenue
    data: [[Q1, 100], [Q2, 150], [Q3, 200], [Q4, 180]]
  - name: Costs
    data: [[Q1, 80], [Q2, 90], [Q3, 110], [Q4, 95]]
\`\`\`

### Numeric data (no labels)
\`\`\`yaml
xLabels: [Jan, Feb, Mar, Apr, May]
series:
  - name: Values
    data: [10, 25, 18, 30, 22]
\`\`\`

## Formulas
Use \`formula\` with mathematical expressions. Variable: \`x\`.
Define \`x\` range as \`[from, to]\` or \`[from, to, step]\`. Default step auto-generates ~200 points.

### Available functions
\`sin\`, \`cos\`, \`tan\`, \`asin\`, \`acos\`, \`atan\`,
\`sinh\`, \`cosh\`, \`tanh\`,
\`exp\`, \`log\` (natural), \`ln\` (alias for log), \`log2\`, \`log10\`,
\`sqrt\`, \`abs\`, \`ceil\`, \`floor\`, \`round\`,
\`pow\`, \`min\`, \`max\`,
\`ifElse(condition, valueIfTrue, valueIfFalse)\`

### Constants
\`PI\`, \`E\`

### Operators
- Arithmetic: \`+\`, \`-\`, \`*\`, \`/\`, \`^\` (power)
- Comparison: \`=\`, \`!=\`, \`<\`, \`>\`, \`<=\`, \`>=\` (return 1 or 0)
- Ternary: \`condition ? then : else\` (auto-converted to ifElse)

### Examples

Exponential decay:
\`\`\`yaml
type: line
x: [0, 50]
series:
  - name: S=5
    formula: exp(-x / 5)
  - name: S=10
    formula: exp(-x / 10)
\`\`\`

Trigonometric:
\`\`\`yaml
type: line
x: [-6.28, 6.28]
smooth: true
series:
  - name: sin(x)
    formula: sin(x)
  - name: cos(x)
    formula: cos(x)
\`\`\`

Quadratic:
\`\`\`yaml
type: line
x: [-5, 5, 0.1]
series:
  - name: y = x² - 3
    formula: x^2 - 3
\`\`\`

Piecewise function:
\`\`\`yaml
type: line
x: [-5, 5, 0.05]
series:
  - name: piecewise
    formula: x < 0 ? -x : x^2
\`\`\`

## Pie Charts
\`\`\`yaml
type: pie
series:
  - data: [[Groceries, 450], [Transport, 120], [Entertainment, 200], [Other, 80]]
\`\`\`

## Per-Series Type Override
\`\`\`yaml
type: line
xLabels: [Jan, Feb, Mar, Apr]
series:
  - name: Revenue
    data: [100, 150, 200, 180]
  - name: Trend
    type: bar
    data: [90, 120, 160, 170]
\`\`\`
`

export function createChartDocsTool(): AgentTool {
  return {
    name: 'chart_docs',
    label: 'Chart Docs',
    description:
      'Get the reference for creating abele-chart codeblocks. Call this before writing chart codeblocks in notes to see all available options, chart types, and formula syntax.',
    parameters: { type: 'object', properties: {} },
    execute: async () => ({
      content: [{ type: 'text', text: CHART_DOCS }],
    }),
  }
}
