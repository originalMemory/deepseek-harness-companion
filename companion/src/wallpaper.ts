/** Window-owned local wallpaper rotation and local settings dialog; no renderer filesystem API. */
import { readFile, writeFile, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { app, dialog, ipcMain, type BrowserWindow } from 'electron'
import { openWallpaperDialog } from './wallpaper-dialog.ts'
import { COMPANION_NAME } from './identity.ts'
import { wallpaperDefaults, readWallpaperSettings, type WallpaperSettings } from './wallpaper-settings.ts'
import { nextWallpaper, scanWallpapers, wallpaperData } from './wallpaper-files.ts'

/** Install local wallpaper rotation until the remote window closes.
 * @param window - Owning remote window.
 * @param origin - Only this remote origin receives presentation updates.
 * @returns Action opening the local wallpaper settings dialog.
 */
export function installWallpaper(window: BrowserWindow, origin: string): () => void {
  const contents = window.webContents
  const path = join(app.getPath('userData'), 'wallpaper.json')
  let config = { ...wallpaperDefaults }
  let images: string[] = []
  let current = ''
  let presentation: { image: string; transitionMs: number; dim: number; blur: number } | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let pending = Promise.resolve()
  let settingsWindow: BrowserWindow | undefined
  let checkId = 0
  let checking: { id: number; finish: (success: boolean) => void } | undefined
  const trusted = (event: Electron.IpcMainEvent): boolean => !disposed && event.sender === contents
    && event.senderFrame === contents.mainFrame && event.senderFrame !== null && new URL(event.senderFrame.url).origin === origin
  const checkImage = (image: string): Promise<void> => new Promise((resolve, reject) => {
    if (disposed || new URL(contents.getURL()).origin !== origin) { reject(new Error('请等待服务器页面加载完成后重试。')); return }
    const id = ++checkId
    const timeout = setTimeout(() => checking?.finish(false), 10_000)
    checking = { id, finish: success => {
      clearTimeout(timeout)
      checking = undefined
      if (success) resolve()
      else reject(new Error('图片无法加载，原配置已保留。请检查图片或网页连接后重试。'))
    } }
    try { contents.send('companion:wallpaper-check', id, image) } catch (_error) { checking?.finish(false) }
  })
  const checked = (event: Electron.IpcMainEvent, id: unknown, success: unknown): void => {
    const request = checking
    if (trusted(event) && request !== undefined && request.id === id && typeof success === 'boolean') request.finish(success)
  }
  ipcMain.on('companion:wallpaper-checked', checked)
  const send = (): void => {
    if (disposed) return
    const url = contents.getURL()
    if (!url.startsWith('http:') && !url.startsWith('https:')) return
    if (new URL(url).origin === origin) contents.send('companion:wallpaper', presentation)
  }
  const schedule = (): void => {
    clearTimeout(timer)
    if (!disposed && config.enabled && images.length > 0) timer = setTimeout(() => run(() => advance()), config.intervalMin * 60_000)
  }
  const advance = async (change = true): Promise<void> => {
    if (disposed) return
    if (!config.enabled || images.length === 0) { presentation = null; send(); schedule(); return }
    const previous = images.indexOf(current)
    const index = !change && previous >= 0 ? previous : nextWallpaper(images.length, previous, config.order)
    const selected = images[index]!
    const image = await wallpaperData(config.dir, selected)
    await checkImage(image)
    if (disposed) return
    current = selected
    presentation = { image, transitionMs: config.transitionMs, dim: config.dim, blur: config.blur }
    send()
    schedule()
  }
  const prepare = async (next: WallpaperSettings, change: boolean): Promise<{ files: string[]; selected: string; visual: typeof presentation }> => {
    const files = !next.enabled || next.dir === '' ? [] : await scanWallpapers(next.dir, next.recursive)
    if (next.enabled && files.length === 0) throw new Error('此目录中没有支持的图片。')
    const previous = files.indexOf(current)
    const index = !change && previous >= 0 ? previous : nextWallpaper(files.length, previous, next.order)
    const selected = files[index] ?? ''
    const visual = selected === '' ? null : { image: await wallpaperData(next.dir, selected), transitionMs: next.transitionMs, dim: next.dim, blur: next.blur }
    return { files, selected, visual }
  }
  const run = (action: () => Promise<void>): Promise<boolean> => {
    let succeeded = false
    pending = pending.then(async () => { if (!disposed) { await action(); succeeded = true } }).catch((error: unknown) => {
      if (disposed) return
      dialog.showErrorBox(COMPANION_NAME, `无法加载或保存背景轮播，请更换图片目录或检查目录权限。\n${error instanceof Error ? error.message : String(error)}`)
    })
    return pending.then(() => succeeded)
  }
  const update = (patch: Partial<WallpaperSettings>, change: boolean): Promise<boolean> => run(async () => {
    const next = readWallpaperSettings({ ...config, ...patch })
    const candidate = await prepare(next, change)
    if (candidate.visual !== null) await checkImage(candidate.visual.image)
    if (disposed) return
    await writeFile(`${path}.tmp`, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
    await rename(`${path}.tmp`, path)
    if (disposed) return
    config = next
    images = candidate.files
    current = candidate.selected
    presentation = candidate.visual
    send()
    schedule()
  })
  run(async () => {
    let raw: string
    try { raw = await readFile(path, 'utf8') } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    const next = readWallpaperSettings(JSON.parse(raw))
    const candidate = await prepare(next, false)
    if (disposed) return
    config = next
    images = candidate.files
    current = candidate.selected
    presentation = candidate.visual
    send()
    schedule()
  })
  const decodingFailed = (event: Electron.IpcMainEvent): void => {
    if (!trusted(event)) return
    clearTimeout(timer)
    dialog.showErrorBox(COMPANION_NAME, '无法加载或保存背景轮播，请更换图片目录或检查目录权限。')
  }
  ipcMain.on('companion:wallpaper-failed', decodingFailed)
  contents.on('did-finish-load', send)
  window.once('closed', () => {
    disposed = true
    checking?.finish(false)
    ipcMain.removeListener('companion:wallpaper-checked', checked)
    if (settingsWindow !== undefined && !settingsWindow.isDestroyed()) settingsWindow.destroy()
    clearTimeout(timer)
    contents.removeListener('did-finish-load', send)
    ipcMain.removeListener('companion:wallpaper-failed', decodingFailed)
    presentation = null
    images = []
  })
  return () => {
    void run(async () => {
      if (settingsWindow !== undefined && !settingsWindow.isDestroyed()) { settingsWindow.show(); settingsWindow.focus(); return }
      settingsWindow = openWallpaperDialog(window, config, update)
      settingsWindow.once('closed', () => { settingsWindow = undefined })
    })
  }
}
