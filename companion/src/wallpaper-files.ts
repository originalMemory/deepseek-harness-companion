/** Bounded local image selection, adapted from dsh-wallpaper-rotator's scanning rules. */
import { constants } from 'node:fs'
import { open, readdir, realpath, lstat } from 'node:fs/promises'
import { extname, join, relative, isAbsolute } from 'node:path'

const mime: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif', '.avif': 'image/avif', '.bmp': 'image/bmp' }
const maxBytes = 48 * 1024 * 1024

/** Scan regular images without following directory symlinks.
 * @param directory - User-selected local directory.
 * @param recursive - Include up to six levels of subdirectories.
 * @returns At most 5000 paths sorted by filename; an unreadable directory rejects.
 */
export async function scanWallpapers(directory: string, recursive: boolean): Promise<string[]> {
  const files: string[] = []
  const walk = async (dir: string, depth: number): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (files.length === 5000) return
      if (entry.name.startsWith('.')) continue
      const path = join(dir, entry.name)
      if (entry.isDirectory() && recursive && depth < 6) await walk(path, depth + 1)
      else if (entry.isFile() && mime[extname(path).toLowerCase()] !== undefined) {
        const info = await lstat(path)
        if (info.isFile() && info.size > 0 && info.size <= maxBytes) files.push(path)
      }
    }
  }
  await walk(directory, 0)
  return files.sort()
}

/** Read one selected image after checking containment, symlinks, size and extension again.
 * @param directory - Selected root directory.
 * @param path - A path returned by the scanner.
 * @returns Image data URL; no local filename is sent to the renderer.
 */
export async function wallpaperData(directory: string, path: string): Promise<string> {
  const root = await realpath(directory)
  const target = await realpath(path)
  const rel = relative(root, target)
  const type = mime[extname(target).toLowerCase()]
  if (rel === '' || rel === '..' || rel.startsWith('../') || rel.startsWith('..\\') || isAbsolute(rel) || type === undefined) throw new Error('Wallpaper outside directory')
  const file = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = await file.stat()
    if (!info.isFile() || info.size === 0 || info.size > maxBytes) throw new Error('Wallpaper exceeds size limit')
    const buffer = Buffer.alloc(info.size + 1)
    let length = 0
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, length)
      if (bytesRead === 0) break
      length += bytesRead
    }
    const data = buffer.subarray(0, length)
    if (data.length > maxBytes) throw new Error('Wallpaper exceeds size limit')
    return `data:${type};base64,${data.toString('base64')}`
  } finally { await file.close() }
}

/** Choose a random image without repeating, or advance in filename order.
 * @param count - Number of scanned images.
 * @param current - Previous image index, or -1.
 * @param order - Configured selection order.
 * @returns Next index, or -1 for an empty directory.
 */
export function nextWallpaper(count: number, current: number, order: 'random' | 'sequence'): number {
  if (count === 0) return -1
  if (order === 'sequence') return (current + 1) % count
  if (count === 1) return 0
  if (current < 0) return Math.floor(Math.random() * count)
  const draw = Math.floor(Math.random() * (count - 1))
  return draw >= current ? draw + 1 : draw
}
