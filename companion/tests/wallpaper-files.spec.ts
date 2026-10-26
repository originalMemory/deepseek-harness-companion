import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, onTestFinished } from 'vitest'
import { nextWallpaper, scanWallpapers, wallpaperData } from '../src/wallpaper-files.ts'
import { readWallpaperSettings, wallpaperDefaults } from '../src/wallpaper-settings.ts'

it('scans supported regular files with optional recursion and rejects escaped images', async () => {
  const root = await mkdtemp(join(tmpdir(), 'companion-wallpapers-'))
  onTestFinished(() => rm(root, { recursive: true, force: true }))
  const folder = join(root, 'images')
  await mkdir(join(folder, 'sub'), { recursive: true })
  await writeFile(join(folder, 'b.png'), 'image')
  await writeFile(join(folder, '.hidden.jpg'), 'image')
  await writeFile(join(folder, 'empty.jpg'), '')
  await writeFile(join(folder, 'script.svg'), '<svg/>')
  await writeFile(join(folder, 'sub', 'a.jpg'), 'image')
  await writeFile(join(root, 'outside.png'), 'secret')
  await symlink(join(root, 'outside.png'), join(folder, 'link.png'))
  expect(await scanWallpapers(folder, false)).toEqual([join(folder, 'b.png')])
  expect(await scanWallpapers(folder, true)).toEqual([join(folder, 'b.png'), join(folder, 'sub', 'a.jpg')])
  expect(await wallpaperData(folder, join(folder, 'b.png'))).toBe('data:image/png;base64,aW1hZ2U=')
  await expect(wallpaperData(folder, join(folder, 'link.png'))).rejects.toThrow('outside')
  await expect(wallpaperData(folder, join(root, 'outside.png'))).rejects.toThrow('outside')
  await expect(wallpaperData(folder, join(folder, 'empty.jpg'))).rejects.toThrow('size')
  await expect(wallpaperData(folder, join(folder, 'script.svg'))).rejects.toThrow()
  await expect(scanWallpapers(join(root, 'missing'), false)).rejects.toThrow()
})

it('advances sequence and never randomly repeats the current image', () => {
  expect(nextWallpaper(0, -1, 'random')).toBe(-1)
  expect(nextWallpaper(1, 0, 'random')).toBe(0)
  expect(nextWallpaper(3, 2, 'sequence')).toBe(0)
  for (let n = 0; n < 100; n++) expect(nextWallpaper(5, 2, 'random')).not.toBe(2)
})

it('validates local preferences and drops unrelated persisted properties', () => {
  expect(readWallpaperSettings({ ...wallpaperDefaults, unrelated: true })).toEqual(wallpaperDefaults)
  for (const patch of [{ intervalMin: 0 }, { intervalMin: '30' }, { dir: 5 }, { order: 'x' }, { dim: 91 }, { blur: NaN }, { enabled: 1 }]) {
    expect(() => readWallpaperSettings({ ...wallpaperDefaults, ...patch })).toThrow()
  }
})
