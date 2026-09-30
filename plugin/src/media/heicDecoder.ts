import workerSource from 'virtual:heic-worker'

/** Desktop fallback, instantiated only after the platform's own image decoder fails. */
export async function decodeHeic(blob: Blob): Promise<Blob> {
  const url = URL.createObjectURL(new Blob([workerSource], { type: 'application/javascript' }))
  let worker: Worker | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    worker = new Worker(url)
    return await new Promise<Blob>((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('HEIC conversion timed out')), 120_000)
      worker!.onmessage = (event: MessageEvent<{ png?: Blob; error?: string }>) => {
        if (event.data.png) resolve(event.data.png)
        else reject(new Error(event.data.error || 'HEIC conversion failed'))
      }
      worker!.onerror = (event) => reject(new Error(event.message || 'HEIC decoder failed'))
      worker!.postMessage(blob)
    })
  } finally {
    if (timer) clearTimeout(timer)
    worker?.terminate()
    URL.revokeObjectURL(url)
  }
}
