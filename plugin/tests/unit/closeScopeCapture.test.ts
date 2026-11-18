import { afterEach, expect, it } from 'vitest'
import { closeScopeCapture } from '../e2e/helpers/closeScopeCapture'

afterEach(() => document.body.replaceChildren())

it('dismisses the modern header close control before settling a pending check', async () => {
  const modal = document.createElement('div')
  modal.className = 'modal abele-modal'
  const button = document.createElement('button')
  button.className = 'modal-header-button'
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  icon.classList.add('lucide-x')
  button.append(icon)
  modal.append(button)
  document.body.append(modal)
  let closedBeforeRelease = false
  const release = () => {
    closedBeforeRelease = !modal.isConnected
  }
  document.addEventListener('abele-scope-capture-release', release, { once: true })
  modal.querySelector('button')!.onclick = () => modal.remove()
  try {
    await closeScopeCapture(document, window)
    expect(closedBeforeRelease).toBe(true)
  } finally {
    document.removeEventListener('abele-scope-capture-release', release)
  }
})
