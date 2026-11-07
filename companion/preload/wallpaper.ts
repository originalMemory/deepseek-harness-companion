/** Decorative wallpaper rendering in the isolated preload; no main-world API is exposed. */
import { ipcRenderer } from 'electron'

/** Listen for shell-owned wallpaper updates until this document unloads. */
export function installWallpaperPresentation(): void {
  let layer: HTMLDivElement | undefined
  let style: HTMLStyleElement | undefined
  let front: HTMLImageElement | undefined
  let generation = 0
  let disposed = false
  const clear = (): void => {
    layer?.remove()
    style?.remove()
    layer = undefined
    style = undefined
    front = undefined
    document.documentElement.removeAttribute('data-companion-wallpaper')
  }
  const loadImage = async (source: string): Promise<HTMLImageElement> => {
    const image = document.createElement('img')
    image.alt = ''
    image.setAttribute('aria-hidden', 'true')
    image.decoding = 'async'
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Wallpaper image could not be loaded'))
      image.src = source
    }).finally(() => { image.onload = null; image.onerror = null })
    return image
  }
  const update = async (_event: Electron.IpcRendererEvent, value: { image: string; transitionMs: number; dim: number; whiten: number; blur: number } | null): Promise<void> => {
    const current = ++generation
    if (value === null) { clear(); return }
    let image: HTMLImageElement
    try { image = await loadImage(value.image) } catch (error) {
      console.warn('Companion: wallpaper loading failed', error)
      if (current === generation) ipcRenderer.send('companion:wallpaper-failed')
      return
    }
    if (current !== generation) return
    if (layer === undefined) {
      style = document.createElement('style')
      style.textContent = `
        html[data-companion-wallpaper],html[data-companion-wallpaper] body,html[data-companion-wallpaper] #root { background:transparent!important; }
        html[data-companion-wallpaper] #root :is(
          :has(> [data-shell-overlay]),
          :has(> [data-shell-overlay]) > :has([data-conversation-content]),
          :has(> [data-phase]:has(> [data-conversation-content])),
          [data-phase]:has(> [data-conversation-content])
        ) { background:transparent!important; }
        html[data-companion-wallpaper][data-dsh-skin][data-windows-titlebar] #root :has(> [data-shell-overlay]) {
          /* Preserve skin tint. An opaque frame would hide the wallpaper. */
          background-color:rgb(from var(--dsw-specific-sidebar-fill, transparent) r g b / calc(alpha * sign(1 - alpha)))!important;
        }
        html[data-companion-wallpaper]:not([data-dsh-skin]) #root :is(
          :has(> [data-shell-overlay]) > :not([data-shell-overlay]):not([data-shell-bottom]),
          :has(> [data-window-drag])
        ) { background:transparent!important; }
        html[data-companion-wallpaper] body { background-image:none!important; }
        html[data-companion-wallpaper] [data-dsh-skin-layer="background"] > :is(img,video) { visibility:hidden!important; }
        [data-companion-wallpaper-layer] { position:fixed;inset:0;z-index:-3;overflow:hidden;pointer-events:none; }
        [data-companion-wallpaper-layer] img { position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity ease; }
        [data-companion-wallpaper-layer]::after { content:'';position:absolute;inset:0;background:rgb(255 255 255 / var(--companion-wallpaper-whiten)); }
      `
      document.head.append(style)
      layer = document.createElement('div')
      layer.setAttribute('data-companion-wallpaper-layer', '')
      layer.setAttribute('aria-hidden', 'true')
      document.body.append(layer)
      document.documentElement.setAttribute('data-companion-wallpaper', '')
    }
    layer.style.setProperty('--companion-wallpaper-whiten', String(value.whiten / 100))
    image.style.opacity = '0'
    image.style.transitionDuration = `${value.transitionMs}ms`
    image.style.filter = `blur(${value.blur}px) brightness(${1 - value.dim / 100})`
    image.style.transform = value.blur > 0 ? 'scale(1.06)' : ''
    const previous = front
    layer.replaceChildren(...(previous === undefined ? [] : [previous]), image)
    front = image
    // Establish the zero-opacity frame before starting the crossfade.
    image.getBoundingClientRect()
    image.style.opacity = '1'
    if (previous !== undefined) {
      previous.style.transitionDuration = `${value.transitionMs}ms`
      previous.style.opacity = '0'
      image.addEventListener('transitionend', () => previous.remove(), { once: true })
      if (value.transitionMs === 0) previous.remove()
    }
  }
  const listener = (event: Electron.IpcRendererEvent, value: Parameters<typeof update>[1]): void => { void update(event, value) }
  const check = (_event: Electron.IpcRendererEvent, id: number, source: string): void => {
    void loadImage(source).then(() => { if (!disposed) ipcRenderer.send('companion:wallpaper-checked', id, true) },
      () => { if (!disposed) ipcRenderer.send('companion:wallpaper-checked', id, false) })
  }
  ipcRenderer.on('companion:wallpaper-check', check)
  const ready = (): void => {
    ipcRenderer.on('companion:wallpaper', listener)
    ipcRenderer.send('companion:wallpaper-ready')
  }
  if (document.readyState === 'loading') window.addEventListener('DOMContentLoaded', ready, { once: true })
  else ready()
  window.addEventListener('pagehide', () => {
    disposed = true
    generation++
    window.removeEventListener('DOMContentLoaded', ready)
    ipcRenderer.removeListener('companion:wallpaper', listener)
    ipcRenderer.removeListener('companion:wallpaper-check', check)
    clear()
  }, { once: true })
}
