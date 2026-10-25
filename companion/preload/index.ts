/** Isolated caption UI; exposes no Node or Harness Host API to remote documents. */
import { ipcRenderer } from 'electron'
import { markDocumentPlatform, syncWindowFullscreen } from '../../apps/desktop/src/preload-platform.ts'
import { syncWindowsAppearance } from '../../apps/desktop/src/preload-windows.ts'

if (process.isMainFrame && ['http:', 'https:'].includes(location.protocol)) {
  markDocumentPlatform()
  syncWindowFullscreen()
  syncWindowsAppearance()
  ipcRenderer.on('companion:focus-composer', () => {
    const input = document.querySelector<HTMLElement>('[data-composer-input]')
    if (input !== null && input.getClientRects().length > 0 && input.isContentEditable) {
      input.focus({ preventScroll: true })
    }
  })
}
