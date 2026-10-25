/** Isolated caption UI; exposes no Node or Harness Host API to remote documents. */
import { ipcRenderer } from 'electron'
import { syncWindowFullscreen } from '../../apps/desktop/src/preload-platform.ts'
import { syncWindowsAppearance } from '../../apps/desktop/src/preload-windows.ts'

if (process.isMainFrame && ['http:', 'https:'].includes(location.protocol)) {
  // data-platform opts into the official native keyboard bridge, which this remote client does not expose.
  const mark = (): void => {
    document.documentElement.dataset.companionPlatform = process.platform
    if (process.platform === 'darwin') {
      const style = document.createElement('style')
      style.textContent = `html[data-companion-platform='darwin']:not([data-fullscreen]) body {
        padding-top: 48px; box-sizing: border-box;
      }
      html[data-companion-platform='darwin']:not([data-fullscreen]) #root { height: calc(100dvh - 48px); }
      html[data-companion-platform='darwin'] body::before {
        content: ''; position: fixed; inset: 0 0 auto; height: 48px; -webkit-app-region: drag;
      }
      html[data-companion-platform='darwin'][data-fullscreen] body::before { display: none; }`
      document.head.append(style)
    }
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', mark, { once: true })
  else mark()
  syncWindowFullscreen()
  syncWindowsAppearance()
  ipcRenderer.on('companion:focus-composer', () => {
    const input = document.querySelector<HTMLElement>('[data-composer-input]')
    if (input !== null && input.getClientRects().length > 0 && input.isContentEditable) {
      input.focus({ preventScroll: true })
    }
  })
}
