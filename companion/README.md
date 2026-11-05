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
- [Desktop pet](#desktop-pet)
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

On first use, paste the official full `?token=…` sign-in URL from the server logs, or an existing pairing link. Companion stores only the origin and keeps its own persistent Cookie, separate from Chrome or other browsers. Later starts open the clean remembered origin; a server restart does not require another sign-in while the Cookie remains valid. Main-page HTTP 401 offers **Enter sign-in link…**; HTTP 403 explains trusted-host and proxy checks instead of treating it as an expired login. Network failures still offer retry, changing server, or quit. Use **Application → Change server…** on Windows or **DeepSeek Harness Companion → Change server…** on macOS to enter a fresh login URL. LAN IP and Lucky domain need separate initial logins; redirects remain restricted to the selected origin.

Check and package the unsigned Windows portable application:

```sh
pnpm --dir companion test
pnpm --dir companion build
pnpm --dir companion check
pnpm --dir companion package:win
```

The portable executable is written under `companion/dist/`. Packaging uses the existing desktop icon without modifying it. `pnpm --dir companion package:mac` builds a macOS ZIP with a local signature and no Apple notarization. `COMPANION_MAC_SIGNING_IDENTITY` in the shell or Git-ignored `companion/.env.local` selects an existing keychain identity; without either setting, packaging uses ad-hoc signing. See [.env.local.example](.env.local.example), and use `security find-identity -v -p codesigning` to list available names. An unavailable configured identity stops the command before quitting Companion.

To quit, rebuild, update and reopen Companion on the current machine, run this command from the repository root:

```sh
pnpm update:companion
```

`pnpm --dir companion update` runs the same command without the parent workspace launcher; `pnpm update:desktop` is an alias for Companion. macOS requests Quit, waits for the installed Companion process to exit, builds and verifies its signed ZIP/application, stages a complete copy beside `/Applications/DeepSeek Harness Companion.app`, replaces it, and opens that exact path. Write permission to `/Applications` is required. A failed replacement restores the previous application; a failed restoration retains and reports the backup path. Windows terminates only Companion's local process trees, rebuilds its x64 portable executable, and launches the new copy under `companion/dist/`; it does not update a copy stored elsewhere. Remote server tasks continue. A build or signature failure leaves the previous application files in place and does not relaunch the client. Windows update execution still requires native qualification.

After building, `node companion/scripts/check-login.mjs` exercises real Electron main-frame 401/403 recovery, retrying a 403 page, token-to-Cookie redirect and Cookie reuse through fresh windows in an isolated fixture. It does not contact your server or share your browser profile.

<a id="window-and-shortcut"></a>

## Window and shortcut

Windows uses the official integrated caption and Application/Edit menu. macOS retains embedded traffic lights and the application menu. The page keeps its Web layout and theme without injected titlebar spacing. On macOS, only the conversation title row is draggable (normally 10–40px below the viewport top); the conversation view tabs are outside that row. Windows uses the existing caption row. Interactive controls and overlays are excluded, while decorative `aria-hidden="true"` background layers do not subtract drag regions. Companion uses the same title-row selector for drag styling and the Web drag watcher, so changes inside a stationary header still refresh macOS drag regions. The sandboxed preload imports the official Windows appearance, caption-menu and fullscreen implementations directly. It leaves `data-platform` unset: that attribute selects the official native keyboard bridge, whereas Companion uses Web shortcuts and preferences. The server must provide the corresponding Windows Web UI styles. Caption IPC accepts only the selected origin's main frame and provides no filesystem or Harness Host access. Right-click a draggable caption region for the shell menu. Other page areas retain their Web context menus; interactive controls and overlays remain excluded from drag regions.

`Ctrl+Shift+E` hides a focused visible window, or restores and focuses it otherwise. Raising it keeps the current conversation and draft, and focuses the visible editable chat composer when present; other pages remain on their current page. No dedicated conversation is created. An unavailable global shortcut is reported; check whether nanobot or another application already uses it. Tray activation and a second launch also focus the current composer.

Normal window position and size are saved to `window-state.json` when the remote window hides or closes and restored on its next launch. Maximized and fullscreen dimensions do not replace the normal bounds. Restored bounds are fitted to the current display work area. The first-use server-address form does not change these preferences; storage failures are reported and invalid saved data uses the default layout.

After building, `node companion/scripts/check-window.mjs` checks the shipped remote-window entry with a temporary profile and local fixture pages: Web shortcut detection, authentication-page recovery, clipboard permissions, caption menu and composer focus.

<a id="wallpaper"></a>

## Wallpaper

Right-click a draggable caption region, choose **背景轮播…** beside **Change server…**, then select an image folder in the dedicated Chinese settings dialog. The dialog provides enable/disable, subfolders, random/filename order, interval, dimming, blur and fade duration. **保存并应用** saves and applies changes; **下一张** and **重新扫描** also save and apply the current settings. Wallpaper is disabled initially; choosing a folder and saving enables random rotation every 30 minutes without consecutive repeats. Preferences live in Companion's `wallpaper.json` and apply across server changes. The dialog remembers its position and size independently in `wallpaper-window-state.json`, including when the application quits with the dialog open; restored bounds are fitted to the current display work area.

This feature follows the image scanning and presentation of [dsh-wallpaper-rotator](https://github.com/originalMemory/dsh-wallpaper-rotator), running inside the shell without a server plugin or server polling. It accepts JPG, PNG, WebP, GIF, AVIF and BMP, with up to 5000 images and six subdirectory levels, skipping hidden files, symlinks, empty files and images larger than 48 MiB. The shell pushes only current image data to the selected origin's isolated preload, exposing no directory-reading API; page scripts can read wallpapers displayed in the DOM, so select only images you intend to show to that page. Saving validates the directory and image loading in the current page before replacing preferences; failure preserves the previous preferences and background and produces a native error. Preference saving and image display have separate feedback. Disabling removes the layer and background styles and stops the timer.

Automatic rotation keeps the current background when an image cannot be read, loaded or validated within the time limit, then tries another image after the configured interval. Sequential rotation advances past the failed image; random rotation avoids immediately selecting that failed image again when another candidate exists. A page image-load failure also leaves rotation scheduled. Closing the window or disabling wallpaper still stops the timer.

After building, run `node companion/scripts/check-wallpaper.mjs` to verify folder selection, image compositing, next image, reload restoration, disabling restores the original background, and saved preferences in a real Electron window. This check uses temporary preferences and a local page; the server's content security policy must allow `data:` images, and opaque panels in custom skins can obscure wallpaper.

<a id="desktop-pet"></a>

## Desktop pet

Enable **Show desktop pet** in the application menu, caption context menu or tray. It is off initially and remembers your choice across restarts. The selected server needs the Companion plugin's `/api/dsh-companion/avatar/pet` v1 page and an enabled, configured avatar. Complete pairing in the main GUI first; the pet starts after the existing observer establishes session status and reuses `persist:companion`. It creates no chat identity, history, credentials or additional Gateway connection.

The transparent, frameless pet stays on top without taking focus when it appears. Transparent areas pass mouse input through; click the character to interact or drag it to move. The application and caption menus provide **Reset desktop pet position**, which moves it to the bottom-right of the main GUI's display; that is also its first-use position. Its layout is fitted to display work areas and saved independently in `pet-window-state.json`; its switch lives in `pet-settings.json`. Saved layout follows the character's visible bounds, so a temporary bubble does not shift its restored position. Turning it off destroys the pet and restores the GUI avatar. A ready pet replaces the GUI avatar locally, including after GUI reload, without changing the server's shared avatar setting. Server changes destroy the previous pet before connecting another one.

Scroll over the character to change its size from 50% to 150%, or use **Smaller character**, **Larger character** and **Reset character size** in the application or caption menu. Only the model stage changes size: bubble text and width stay independent, and scrolling inside a bubble still scrolls its text. The local scale is saved in `pet-settings.json`, with 100% for older settings. Short displays can reduce the effective size to retain notification space. The native window samples the visible contour once when the model is ready and once after scaling, cropping transparent canvas margins with 12 CSS pixels of reference padding rounded to native pixels. Animation plays inside this fixed viewport without resizing or repositioning the window or stage; mouse hit testing remains live. Reloading the model or changing the effective display/zoom size establishes a new reference. A bubble wider than the character retains its own space. Scaling preserves the reference contour's bottom center where the display work area allows it.

In desktop mode, background completion reminders use a plain-text, 12-second head bubble instead of a system notification. A new reminder replaces the current bubble; hiding clears it. Clicking it restores the retained main window and current conversation; precise session navigation is not provided. Closing or timing out a bubble does not clear unread status. A hidden, loading or failed pet keeps unread replies without falling back to system notifications or replaying old reminders. An unavailable pet restores the GUI avatar and reports recovery instructions; turn the switch off and on after fixing login, plugin or model settings. There is no automatic speech or AI rewrite. Turning desktop mode off restores native notifications.

After building, `node companion/scripts/check-pet.mjs` checks the shipped remote entry, isolated preload, early host marker, shared-session permission dispatch, completion routing and cleanup with temporary local fixtures. It does not qualify real Live2D rendering, OS transparent-pixel input, mixed DPI or multi-monitor behavior; those require Windows/macOS device verification.

<a id="notifications"></a>

## Notifications

Companion observes the page's existing Gateway WebSocket in the shell; observation needs no NAS plugin, server edit, or extra authenticated connection. When the window is in the background, an observed reply end can display a native system notification, or a [desktop pet](#desktop-pet) bubble when that mode is selected. Like nanobot, focused windows are quiet, clicking a notification restores and focuses the window, and a successful reply can include a plain-text preview bounded to 240 UTF-8 bytes.

Durable `turn/end` events distinguish success, failure and cancellation; known cancellation is quiet. For other background sessions, the live control stream can reveal that a turn ended without revealing its reason, so the reminder says the turn ended rather than claiming success. Active detailed streams take precedence over this fallback. Historical snapshots and connection loss alone never trigger a reminder. Deduplication retains up to 256 inactive sessions in each remote window; running sessions are retained separately from that limit. A terminated observation stream invalidates running state that no surviving live stream covers. Only supported same-origin `/api/remote.mux` and `/remote/api/remote.mux` channels are observed; changing their wire format requires updating Companion. Opening Developer Tools pauses observation; close the tools and reload the remote page to restore its stream subscriptions. Observation or native-notification failures are reported; ordinary browsing remains available.

<a id="tray-and-running-status"></a>

## Tray and running status

Windows reuses the official desktop's whale ICO and its Open/Quit tray interaction. macOS uses a template image derived from the same official whale in the menu bar. Whenever observed turns are running, the Windows blue dot and macOS dot blink every 800 ms, regardless of whether the remote window is focused or in the background. Both dots are overlaid inside the existing icon dimensions; macOS uses matching standard and Retina template images, so blinking and unread markers do not widen the menu-bar item. An observed background completion retains an unread dot until the remote window becomes visible and focused again, independently of native notification availability. Hovering displays the running count and unread status. An unavailable baseline or connection is labeled as waiting for session status, rather than idle. The official desktop currently has a Windows tray but no macOS menu-bar icon or running-state image change; these extensions belong to Companion.

Closing a remote window hides it to the tray and keeps observation and notifications active. The tray opens the retained window; its Quit entry and the application menu exit the client. Changing server replaces the window, and closing the initial address form cancels startup. If the tray cannot be created or stops accepting updates, the window stays accessible and close-to-quit remains available. Tray disposal waits until application quit commits, so a page that prevents unloading keeps its tray. Server tasks continue after the client exits.

Committed tray assets are generated from the official source by `node --import tsx/esm companion/scripts/render-tray-assets.mjs`, using the parent repository's installed development dependencies. The standalone client does not need those dependencies to build or run.

<a id="identity-and-storage"></a>

## Identity and storage

The product and executable are named **DeepSeek Harness Companion**; the application and Windows taskbar ID is `com.deepseek.harness.companion`. Preferences and Chromium storage live in Electron's `appData/DeepSeek Harness Companion`, including `remote-url.txt` and the `persist:companion` device-cookie partition. That directory is assigned before the single-instance lock, so the official local client can run alongside it; launching Companion again focuses its own window. Companion does not register `dsh://`, install the `dsh` command, or use the official update feed.

Only the server origin is written to `remote-url.txt`; pairing paths, query parameters and fragments are excluded. Enter pairing links only in the client that should receive the device cookie. Closing Companion leaves tasks running on the server.

<a id="maintenance-and-limits"></a>

## Maintenance and limits

Companion sources, configuration, dependencies, tests and expected output live under `companion/`, with an independent lockfile; the root package adds update command aliases. Merging upstream desktop changes normally touches different files, although an upstream directory with the same name can conflict. Review Electron dependency upgrades and changes to server pairing or Web authentication separately. Official native desktop features do not automatically appear in Companion; server Web UI changes arrive from the server.

Companion allows sanitized clipboard writes only from the selected-origin main frame; clipboard reads and other native permissions are denied. It has no local filesystem bridge, local onboarding, or automatic updater. English and Chinese shell copy are included. The caption preload is bundled from the fork's source during builds, so upstream caption changes must be checked after merging. The portable Windows package is unsigned; macOS uses ad-hoc signing or a configured local keychain identity, without notarization. Linux packaging is not configured.

<a id="dev-note"></a>

## Dev Note

None.
