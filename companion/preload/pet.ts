/** Sandboxed pet bridge; remote documents receive no native API. */
import { ipcRenderer } from 'electron'
import { petIntent } from '../src/pet-protocol.ts'

if (process.isMainFrame && ['http:', 'https:'].includes(location.protocol)
  && location.pathname === '/api/dsh-companion/avatar/pet') {
  let width = 360, height = 520
  let left = 0, top = 92, bubbleWidth = 340, bubbleLeft = 10, bubbleMaxHeight = 320
  const style = document.createElement('style')
  style.textContent = `#companion-pet-stage{inset:auto!important;left:var(--companion-model-left,0px)!important;top:var(--companion-model-top,92px)!important;
    width:var(--companion-model-width,360px)!important;height:var(--companion-model-height,520px)!important;
    transform:none!important}
    .dsh-avatar-bubble{width:var(--companion-bubble-width,340px)!important;left:var(--companion-bubble-left,10px)!important;min-height:72px;
      max-height:var(--companion-bubble-max-height,320px)!important}`
  const layout = (): void => {
    if (document.head !== null && !style.isConnected) document.head.append(style)
    if (document.documentElement !== null) {
      document.documentElement.style.setProperty('--companion-model-width', `${width}px`)
      document.documentElement.style.setProperty('--companion-model-height', `${height}px`)
      document.documentElement.style.setProperty('--companion-model-left', `${left}px`)
      document.documentElement.style.setProperty('--companion-model-top', `${top}px`)
      document.documentElement.style.setProperty('--companion-bubble-width', `${bubbleWidth}px`)
      document.documentElement.style.setProperty('--companion-bubble-left', `${bubbleLeft}px`)
      document.documentElement.style.setProperty('--companion-bubble-max-height', `${bubbleMaxHeight}px`)
    }
  }
  const observer = new MutationObserver(() => {
    layout()
    if (style.isConnected) observer.disconnect()
  })
  observer.observe(document, { childList: true, subtree: true })
  layout()
  const control = (_event: Electron.IpcRendererEvent, message: {
    type: string; width?: number; height?: number; left?: number; top?: number; bubbleWidth?: number; bubbleLeft?: number; bubbleMaxHeight?: number
  }): void => {
    if (message.type === 'model-layout') {
      if (typeof message.width !== 'number' || !Number.isFinite(message.width) || message.width <= 0 || message.width > 540
        || typeof message.height !== 'number' || !Number.isFinite(message.height) || message.height <= 0 || message.height > 780
        || typeof message.left !== 'number' || !Number.isFinite(message.left) || Math.abs(message.left) > 10000
        || typeof message.top !== 'number' || !Number.isFinite(message.top) || Math.abs(message.top) > 10000
        || typeof message.bubbleWidth !== 'number' || !Number.isFinite(message.bubbleWidth) || message.bubbleWidth <= 0 || message.bubbleWidth > 340
        || typeof message.bubbleLeft !== 'number' || !Number.isFinite(message.bubbleLeft) || Math.abs(message.bubbleLeft) > 10000
        || typeof message.bubbleMaxHeight !== 'number' || !Number.isFinite(message.bubbleMaxHeight) || message.bubbleMaxHeight < 72 || message.bubbleMaxHeight > 320) return
      width = message.width; height = message.height; left = message.left; top = message.top
      bubbleWidth = message.bubbleWidth; bubbleLeft = message.bubbleLeft; bubbleMaxHeight = message.bubbleMaxHeight; layout()
      return
    }
    window.postMessage({ ...message, source: 'dsh-companion:electron', version: 1 }, location.origin)
  }
  const wheel = (event: WheelEvent): void => {
    if (!event.isTrusted || event.deltaY === 0 || !(event.target instanceof Element)
      || event.target.closest('#companion-pet-stage') === null) return
    event.preventDefault()
    ipcRenderer.send('companion:pet-scale', event.deltaY < 0 ? 1 : -1)
  }
  const intent = (event: Event): void => {
    if (!(event instanceof CustomEvent)) return
    const data = petIntent(event.detail)
    if (data !== undefined) ipcRenderer.send('companion:pet-intent', data)
  }
  ipcRenderer.on('companion:pet-control', control)
  window.addEventListener('dsh-companion:pet-event', intent)
  document.addEventListener('wheel', wheel, { passive: false })
  window.addEventListener('pagehide', () => {
    ipcRenderer.removeListener('companion:pet-control', control)
    window.removeEventListener('dsh-companion:pet-event', intent)
    document.removeEventListener('wheel', wheel)
    observer.disconnect()
    style.remove()
  }, { once: true })
}
