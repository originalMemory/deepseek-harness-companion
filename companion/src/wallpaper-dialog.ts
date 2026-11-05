/** Trusted local wallpaper form with native folder selection and no renderer bridge. */
import { app, BrowserWindow, dialog } from 'electron'
import { loadWindowBounds, rememberWindowBounds } from './window-state.ts'
import { readWallpaperSettings, type WallpaperSettings } from './wallpaper-settings.ts'

const labels = { enabled: '启用背景轮播', recursive: '包含子目录', order: '轮播顺序', intervalMin: '切换间隔', dim: '暗化', blur: '模糊', transitionMs: '淡入淡出时长' }
const layoutFile = 'wallpaper-window-state.json'
const layoutMessages = {
  windowStateReadFailed: '无法读取背景轮播设置窗口的位置，将使用默认布局。请检查应用配置目录中的 wallpaper-window-state.json。',
  windowStateWriteFailed: '无法保存背景轮播设置窗口的位置，下次打开可能无法恢复。请检查应用配置目录的权限。',
}
const failed = '无法加载或保存背景轮播，请检查图片目录及权限后重试。'
const target = 'https://dsh-companion.invalid/wallpaper'
const escape = (text: string): string => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;')

/** Open a local settings form independent of the server's module loader.
 * @param parent - Remote window owning this dialog.
 * @param initial - Current persisted preferences.
 * @param apply - Save and apply preferences, optionally advancing the image.
 * @returns Owned settings window, destroyed when its parent closes.
 */
export function openWallpaperDialog(
  parent: BrowserWindow, initial: WallpaperSettings,
  apply: (value: WallpaperSettings, next: boolean) => Promise<boolean>,
): BrowserWindow {
  const userData = app.getPath('userData')
  const bounds = loadWindowBounds(userData, layoutMessages, layoutFile)
  const window = new BrowserWindow({
    parent, width: 660, height: 750, ...bounds, minWidth: 540, minHeight: 620, show: false,
    title: '背景轮播', autoHideMenuBar: true,
    webPreferences: { partition: 'companion-wallpaper-settings', nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true },
  })
  rememberWindowBounds(window, userData, layoutMessages, layoutFile)
  window.setMenu(null)
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  let page = ''
  let busy = false
  const render = async (value: WallpaperSettings, status = ''): Promise<void> => {
    const row = (label: string, control: string): string => `<label class="row"><span>${escape(label)}</span><span class="controls">${control}</span></label>`
    const number = (name: 'intervalMin' | 'dim' | 'blur' | 'transitionMs', min: number, max: number, unit: string): string =>
      `<input aria-label="${escape(labels[name])}" type="number" name="${name}" min="${min}" max="${max}" step="1" required value="${value[name]}"><span>${unit}</span>`
    const checked = (enabled: boolean): string => enabled ? ' checked' : ''
    const html = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; form-action ${target}">
<title>${escape('背景轮播')}</title><style>
:root{color-scheme:light dark;font:14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;--text:#171717;--muted:#737373;--base:#fff;--layer:#f5f5f5;--border:#e5e5e5;--accent:#4d6bfe}
@media(prefers-color-scheme:dark){:root{--text:#ededed;--muted:#a3a3a3;--base:#212121;--layer:#2b2b2b;--border:#3d3d3d}}
*{box-sizing:border-box}body{margin:0;padding:28px 32px;color:var(--text);background:var(--base)}h1{font-size:22px;font-weight:600;margin:0 0 6px}p{margin:0;color:var(--muted);font-size:12px}
.row{display:flex;justify-content:space-between;align-items:center;gap:24px;padding:16px 0;border-bottom:.5px solid var(--border)}.controls{display:flex;align-items:center;gap:8px;flex:none;color:var(--muted)}
input,select,button{font:inherit;color:var(--text);border:.5px solid var(--border);border-radius:8px;background:var(--base);height:32px;padding:0 10px}input[type=number]{width:90px}input[type=checkbox]{width:18px;height:18px;accent-color:var(--accent)}select{max-width:210px}button{background:var(--layer);cursor:pointer;padding:0 14px}button:hover{filter:brightness(.96)}:is(input,select,button):focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.folder{display:flex;gap:8px;margin-top:12px}.folder input{flex:1;min-width:0;color:var(--muted)}.actions{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:20px}.primary{color:white;background:var(--accent);border-color:var(--accent)}.status{min-height:18px;margin-top:12px}
</style></head><body><h1>${escape('背景轮播')}</h1><p>${escape('选择本地图片目录，保存后生效；下一张和重新扫描也会保存当前设置。')}</p>
<form action="${target}" method="get"><button name="action" value="save" hidden aria-hidden="true"></button>
<div class="folder"><input aria-label="${escape('选择图片目录…')}" name="dir" readonly value="${escape(value.dir)}" placeholder="${escape('尚未选择目录')}"><button name="action" value="choose" formnovalidate>${escape('选择图片目录…')}</button></div>
${row(labels.enabled, `<input type="checkbox" name="enabled"${checked(value.enabled)}>`)}
${row(labels.recursive, `<input type="checkbox" name="recursive"${checked(value.recursive)}>`)}
${row(labels.order, `<select name="order"><option value="random"${value.order === 'random' ? ' selected' : ''}>${escape('随机顺序')}</option><option value="sequence"${value.order === 'sequence' ? ' selected' : ''}>${escape('文件名顺序')}</option></select>`)}
${row(labels.intervalMin, number('intervalMin', 1, 1440, '分钟'))}
${row(labels.dim, number('dim', 0, 90, '%'))}
${row(labels.blur, number('blur', 0, 40, 'px'))}
${row(labels.transitionMs, number('transitionMs', 0, 5000, 'ms'))}
<p class="status" role="status">${escape(status)}</p><div class="actions"><button name="action" value="next">${escape('下一张')}</button><button name="action" value="rescan">${escape('重新扫描')}</button><button class="primary" name="action" value="save">${escape('保存并应用')}</button></div>
</form></body></html>`
    page = `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    await window.loadURL(page)
  }
  window.webContents.on('will-navigate', (event, url) => {
    event.preventDefault()
    if (busy || window.webContents.getURL() !== page) return
    const request = new URL(url)
    if (request.origin + request.pathname !== target) return
    const params = request.searchParams
    const action = params.get('action')
    if (!['choose', 'save', 'next', 'rescan'].includes(action ?? '')) return
    busy = true
    void (async () => {
      const value = readWallpaperSettings({
        dir: params.get('dir'), enabled: params.has('enabled'), recursive: params.has('recursive'), order: params.get('order'),
        intervalMin: Number(params.get('intervalMin')), dim: Number(params.get('dim')), blur: Number(params.get('blur')), transitionMs: Number(params.get('transitionMs')),
      })
      if (action === 'choose') {
        const choice = await dialog.showOpenDialog(window, { title: '选择图片目录…', properties: ['openDirectory'] })
        if (!choice.canceled && choice.filePaths[0] !== undefined) { value.dir = choice.filePaths[0]; value.enabled = true }
        if (!window.isDestroyed()) await render(value)
      } else {
        const saved = await apply(value, action === 'next')
        if (!window.isDestroyed()) await render(value, saved ? '配置已保存。图片加载失败时会另行提示。' : '未能完成，请检查错误提示后重试。')
      }
    })().catch((error: unknown) => {
      if (!window.isDestroyed()) dialog.showErrorBox('背景轮播', `${failed}\n${error instanceof Error ? error.message : String(error)}`)
    }).finally(() => { busy = false })
  })
  window.once('ready-to-show', () => { if (!window.isDestroyed()) window.show() })
  void render(initial).catch(() => {
    if (!window.isDestroyed()) { dialog.showErrorBox('背景轮播', failed); window.destroy() }
  })
  return window
}
