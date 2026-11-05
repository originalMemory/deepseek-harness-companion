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
  const update = async (_event: Electron.IpcRendererEvent, value: { image: string; transitionMs: number; dim: number; blur: number } | null): Promise<void> => {
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
        html[data-companion-wallpaper] body { background-image:none!important; }
        [data-companion-wallpaper-layer] { position:fixed;inset:0;z-index:-2;overflow:hidden;pointer-events:none; }
        [data-companion-wallpaper-layer] img { position:absolute;inset:0;width:100%;height:100%;object-fit:cover;transition:opacity ease; }
      `
      document.head.append(style)
      layer = document.createElement('div')
      layer.setAttribute('data-companion-wallpaper-layer', '')
      layer.setAttribute('aria-hidden', 'true')
      document.body.append(layer)
      document.documentElement.setAttribute('data-companion-wallpaper', '')
    }
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
  ipcRenderer.on('companion:wallpaper', listener)
  window.addEventListener('pagehide', () => {
    disposed = true
    generation++
    ipcRenderer.removeListener('companion:wallpaper', listener)
    ipcRenderer.removeListener('companion:wallpaper-check', check)
    clear()
  }, { once: true })
}
