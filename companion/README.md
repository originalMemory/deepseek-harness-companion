---
description: "Independent Electron client that opens a remote DeepSeek Harness server alongside the official desktop application."
---

# DeepSeek Harness Companion

English | [中文](README.zh.md)

## Summary

Companion opens a remote DeepSeek Harness Web GUI without starting a local Host. It is an independent client in this fork; the official desktop application's source and update configuration remain unchanged.

## Table of Contents

- [Run](#run)
- [Window and shortcut](#window-and-shortcut)
- [Wallpaper](#wallpaper)
- [Notifications](#notifications)
- [Tray and running status](#tray-and-running-status)
- [Identity and storage](#identity-and-storage)
- [Maintenance and limits](#maintenance-and-limits)
- [Dev Note](#dev-note)

<a id="run"></a>

## Run

From the repository root, install only this client's dependencies and start it:

```sh
pnpm --dir companion install
pnpm --dir companion start
```

On first use, enter your server address or pairing link and complete pairing inside Companion. Later starts open the remembered server directly. Use **Application → Change server…** on Windows or **DeepSeek Harness Companion → Change server…** on macOS to enter another address or a fresh pairing link. Connection failures offer retry, changing server, or quit. The window stays on the selected origin; use that origin's pairing link when the server also advertises other LAN or public origins.

Check and package the unsigned Windows portable application:

```sh
pnpm --dir companion test
pnpm --dir companion build
pnpm --dir companion check
pnpm --dir companion package:win
```

The portable executable is written under `companion/dist/`. Packaging uses the existing desktop icon without modifying it. `pnpm --dir companion package:mac` configures a macOS ZIP build with ad-hoc signing; it requires qualification on macOS.

<a id="window-and-shortcut"></a>

## Window and shortcut

Windows uses the official integrated caption and Application/Edit menu. macOS retains embedded traffic lights and the application menu. The page keeps its Web layout and theme without injected titlebar spacing. On macOS, only the conversation title row is draggable (normally 10–40px below the viewport top); the conversation view tabs are outside that row. Windows uses the existing caption row. Interactive controls and overlays are excluded, while decorative `aria-hidden="true"` background layers do not subtract drag regions. Companion uses the same title-row selector for drag styling and the Web drag watcher, so changes inside a stationary header still refresh macOS drag regions. The sandboxed preload imports the official Windows appearance, caption-menu and fullscreen implementations directly. It leaves `data-platform` unset: that attribute selects the official native keyboard bridge, whereas Companion uses Web shortcuts and preferences. The server must provide the corresponding Windows Web UI styles. Caption IPC accepts only the selected origin's main frame and provides no filesystem or Harness Host access. Right-click anywhere in the page for Change server or Quit, including authentication and boot-error pages.

`Ctrl+Shift+E` hides a focused visible window, or restores and focuses it otherwise. Raising it keeps the current conversation and draft, and focuses the visible editable chat composer when present; other pages remain on their current page. No dedicated conversation is created. An unavailable global shortcut is reported; check whether nanobot or another application already uses it. Tray activation and a second launch also focus the current composer.

Normal window position and size are saved to `window-state.json` when the remote window hides or closes and restored on its next launch. Maximized and fullscreen dimensions do not replace the normal bounds. Restored bounds are fitted to the current display work area. The first-use server-address form does not change these preferences; storage failures are reported and invalid saved data uses the default layout.

After building, `node companion/scripts/check-window.mjs` checks the shipped remote-window entry with a temporary profile and local fixture pages: Web shortcut detection, authentication-page recovery, clipboard permissions, caption menu and composer focus.

<a id="wallpaper"></a>

## Wallpaper

Right-click the page, choose **背景轮播…** beside **Change server…**, then select an image folder in the dedicated Chinese settings dialog. The dialog provides enable/disable, subfolders, random/filename order, interval, dimming, blur and fade duration. **保存并应用** saves and applies changes; **下一张** and **重新扫描** also save and apply the current settings. Wallpaper is disabled initially; choosing a folder and saving enables random rotation every 30 minutes without consecutive repeats. Preferences live in Companion's `wallpaper.json` and apply across server changes.

This feature follows the image scanning and presentation of [dsh-wallpaper-rotator](https://github.com/originalMemory/dsh-wallpaper-rotator), running inside the shell without a server plugin or server polling. It accepts JPG, PNG, WebP, GIF, AVIF and BMP, with up to 5000 images and six subdirectory levels, skipping hidden files, symlinks, empty files and images larger than 48 MiB. The shell pushes only current image data to the selected origin's isolated preload, exposing no directory-reading API; page scripts can read wallpapers displayed in the DOM, so select only images you intend to show to that page. Saving validates the directory and image loading in the current page before replacing preferences; failure preserves the previous preferences and background and produces a native error. Preference saving and image display have separate feedback. Disabling removes the layer and background styles and stops the timer.

After building, run `node companion/scripts/check-wallpaper.mjs` to verify folder selection, image compositing, next image, reload restoration, disabling restores the original background, and saved preferences in a real Electron window. This check uses temporary preferences and a local page; the server's content security policy must allow `data:` images, and opaque panels in custom skins can obscure wallpaper.

<a id="notifications"></a>

## Notifications

Companion observes the page's existing Gateway WebSocket in the shell; no NAS plugin, server edit, or extra authenticated connection is needed. When the window is in the background, an observed reply end can display a native system notification. Like nanobot, focused windows are quiet, clicking a notification restores and focuses the window, and a successful reply can include a plain-text preview bounded to 240 UTF-8 bytes.

Durable `turn/end` events distinguish success, failure and cancellation; known cancellation is quiet. For other background sessions, the live control stream can reveal that a turn ended without revealing its reason, so the reminder says the turn ended rather than claiming success. Active detailed streams take precedence over this fallback. Historical snapshots and connection loss alone never trigger a reminder. Deduplication retains up to 256 inactive sessions in each remote window; running sessions are retained separately from that limit. A terminated observation stream invalidates running state that no surviving live stream covers. Only supported same-origin `/api/remote.mux` and `/remote/api/remote.mux` channels are observed; changing their wire format requires updating Companion. Opening Developer Tools pauses observation; close the tools and reload the remote page to restore its stream subscriptions. Observation or native-notification failures are reported; ordinary browsing remains available.

<a id="tray-and-running-status"></a>

## Tray and running status

Windows reuses the official desktop's whale ICO and its Open/Quit tray interaction. macOS uses a template image derived from the same official whale in the menu bar. While the remote window is in the background or unfocused and observed turns are running, the Windows blue dot and macOS `●` blink every 800 ms. An observed background completion retains an unread dot until the remote window becomes visible and focused again, independently of native notification availability. Hovering displays the running count and unread status. An unavailable baseline or connection is labeled as waiting for session status, rather than idle. The official desktop currently has a Windows tray but no macOS menu-bar icon or running-state image change; these extensions belong to Companion.

Closing a remote window hides it to the tray and keeps observation and notifications active. The tray opens the retained window; its Quit entry and the application menu exit the client. Changing server replaces the window, and closing the initial address form cancels startup. If the tray cannot be created or stops accepting updates, the window stays accessible and close-to-quit remains available. Tray disposal waits until application quit commits, so a page that prevents unloading keeps its tray. Server tasks continue after the client exits.

Committed tray assets are generated from the official source by `node --import tsx/esm companion/scripts/render-tray-assets.mjs`, using the parent repository's installed development dependencies. The standalone client does not need those dependencies to build or run.

<a id="identity-and-storage"></a>

## Identity and storage

The product and executable are named **DeepSeek Harness Companion**; the application and Windows taskbar ID is `com.deepseek.harness.companion`. Preferences and Chromium storage live in Electron's `appData/DeepSeek Harness Companion`, including `remote-url.txt` and the `persist:companion` device-cookie partition. That directory is assigned before the single-instance lock, so the official local client can run alongside it; launching Companion again focuses its own window. Companion does not register `dsh://`, install the `dsh` command, or use the official update feed.

Only the server origin is written to `remote-url.txt`; pairing paths, query parameters and fragments are excluded. Enter pairing links only in the client that should receive the device cookie. Closing Companion leaves tasks running on the server.

<a id="maintenance-and-limits"></a>

## Maintenance and limits

All fork-specific code, configuration, dependencies, tests and expected output live under `companion/`, with an independent lockfile. Merging upstream desktop changes normally touches different files, although an upstream directory with the same name can conflict. Review Electron dependency upgrades and changes to server pairing or Web authentication separately. Official native desktop features do not automatically appear in Companion; server Web UI changes arrive from the server.

Companion allows sanitized clipboard writes only from the selected-origin main frame; clipboard reads and other native permissions are denied. It has no local filesystem bridge, local onboarding, or automatic updater. English and Chinese shell copy are included. The caption preload is bundled from the fork's source during builds, so upstream caption changes must be checked after merging. The portable Windows package is unsigned; macOS uses ad-hoc signing and requires native qualification. Linux packaging is not configured.

<a id="dev-note"></a>

## Dev Note

None.
