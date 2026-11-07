import base from '../../vitest.config'

// Replace the normal include list; merging arrays would run unrelated suites too.
export default {
  ...base,
  test: {
    ...base.test,
    include: ['tests/harness/scale*.test.ts', 'tests/scale/**/*.test.ts'],
  },
}
