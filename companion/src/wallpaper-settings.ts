/** Persisted local wallpaper preferences shared with the isolated renderer. */
export interface WallpaperSettings {
  enabled: boolean
  dir: string
  recursive: boolean
  order: 'random' | 'sequence'
  intervalMin: number
  transitionMs: number
  dim: number
  blur: number
}

/** New installations leave wallpaper disabled until a directory is chosen. */
export const wallpaperDefaults: WallpaperSettings = {
  enabled: false, dir: '', recursive: false, order: 'random', intervalMin: 30, transitionMs: 900, dim: 0, blur: 0,
}

/** Validate preferences loaded from disk, rejecting malformed or unsupported values.
 * @param value - Parsed local JSON.
 * @returns Complete preferences.
 */
export function readWallpaperSettings(value: unknown): WallpaperSettings {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('Invalid wallpaper settings')
  const result = { ...wallpaperDefaults, ...value }
  if (typeof result.enabled !== 'boolean' || typeof result.dir !== 'string' || typeof result.recursive !== 'boolean'
    || !['random', 'sequence'].includes(result.order)) throw new Error('Invalid wallpaper settings')
  for (const [key, min, max] of [['intervalMin', 1, 1440], ['transitionMs', 0, 5000], ['dim', 0, 90], ['blur', 0, 40]] as const) {
    if (!Number.isInteger(result[key]) || result[key] < min || result[key] > max) throw new Error('Invalid wallpaper settings')
  }
  return { enabled: result.enabled, dir: result.dir, recursive: result.recursive, order: result.order,
    intervalMin: result.intervalMin, transitionMs: result.transitionMs, dim: result.dim, blur: result.blur }
}
