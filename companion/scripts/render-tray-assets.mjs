/** Derive tray assets from the official whale and Windows ICO; run with the repository's tsx ESM hook. */
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { renderTrayIconEntries, packIco } from '../../apps/desktop/scripts/render-tray-icon.ts'

const require = createRequire(new URL('../../apps/desktop/package.json', import.meta.url))
const sharp = require('sharp')
const assets = new URL('../assets/', import.meta.url)
await mkdir(assets, { recursive: true })
const source = await readFile(new URL('../../apps/desktop/resources/icon-windows.svg', import.meta.url), 'utf8')
await copyFile(new URL('../../apps/desktop/resources/tray-windows.ico', import.meta.url), new URL('tray.ico', assets))
const busy = source.replace('</svg>', '<circle cx="820" cy="820" r="160" fill="#1677ff" stroke="white" stroke-width="40"/></svg>')
await writeFile(new URL('tray-running.ico', assets), packIco(await renderTrayIconEntries(Buffer.from(busy))))
const group = source.match(/<g id="tray-glyph"[^>]*>([\s\S]*?)<\/g>/u)
if (group === null) throw new Error('Official tray glyph is missing')
const glyph = group[1].replace(/fill="url\([^)]*\)"/gu, 'fill="black"').replace(/fill-opacity="[^"]*"/gu, '')
const template = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="16" viewBox="150 260 840 630">${glyph}</svg>`
const badge = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="16" viewBox="150 260 840 630"><defs><mask id="badge-gap" maskUnits="userSpaceOnUse" x="150" y="260" width="840" height="630"><rect x="150" y="260" width="840" height="630" fill="white"/><circle cx="850" cy="745" r="120" fill="black"/></mask></defs><g mask="url(#badge-gap)">${glyph}</g><circle cx="850" cy="745" r="88" fill="black"/></svg>`
for (const [name, svg] of [['trayTemplate', template], ['trayBadgeTemplate', badge]]) {
  for (const scale of [1, 2]) {
    await sharp(Buffer.from(svg)).resize(22 * scale, 16 * scale).png()
      .toFile(fileURLToPath(new URL(`${name}${scale === 1 ? '' : '@2x'}.png`, assets)))
  }
}
