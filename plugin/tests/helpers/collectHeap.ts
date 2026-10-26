import { Session } from 'node:inspector'

/** Collect actual V8 garbage without requiring a particular test-runner launch flag. */
export async function collectHeap(): Promise<void> {
  const session = new Session()
  session.connect()
  try {
    await new Promise<void>((resolve, reject) =>
      session.post('HeapProfiler.collectGarbage', (error) => (error ? reject(error) : resolve()))
    )
  } finally {
    session.disconnect()
  }
}
