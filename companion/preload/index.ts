/** Isolated caption UI; exposes no Node or Harness Host API to remote documents. */
import { ipcRenderer } from 'electron'
import { installWallpaperPresentation } from './wallpaper.ts'
import { syncWindowFullscreen } from '../../apps/desktop/src/preload-platform.ts'
import { syncWindowsAppearance } from '../../apps/desktop/src/preload-windows.ts'
import { DRAG_MARK, INTERACTIVE_SELECTOR, RECALL_MARK } from '../../packages/client/web/src/window-drag/regions.ts'
import { installWindowDragRecall } from '../../packages/client/web/src/window-drag/recall.ts'

const conversationDragRow = `header[${DRAG_MARK}] > [data-conversation-header-leading] + div`

if (process.isMainFrame && ['http:', 'https:'].includes(location.protocol)) {
  installWallpaperPresentation()
  // data-platform opts into the official native keyboard bridge, which this remote client does not expose.
  const mark = (): void => {
    document.documentElement.dataset.companionPlatform = process.platform
    if (process.platform === 'darwin' || process.platform === 'win32') {
      const style = document.createElement('style')
      style.textContent = `
        html[data-companion-platform='darwin'] ${conversationDragRow} {
          -webkit-app-region: drag;
        }
        html[data-companion-platform='darwin'] [${RECALL_MARK}],
        html[data-companion-platform] body > :not(#root):not([aria-hidden='true']),
        html[data-companion-platform] :is(${INTERACTIVE_SELECTOR}) { -webkit-app-region: no-drag; }
      `
      document.head.append(style)
    }
    if (process.platform === 'darwin') {
      const stop = installWindowDragRecall({ document, platform: process.platform, rowSelector: conversationDragRow })
      window.addEventListener('pagehide', stop, { once: true })
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
