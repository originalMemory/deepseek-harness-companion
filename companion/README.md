---
description: "Independent Electron client that opens a remote DeepSeek Harness server alongside the official desktop application."
---

# DeepSeek Harness Companion

English | [中文](README.zh.md)

## Summary

Companion opens a remote DeepSeek Harness Web GUI without starting a local Host. It is an independent client in this fork; the official desktop application's source and update configuration remain unchanged.

## Table of Contents

- [Run](#run)
- [Notifications](#notifications)
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

On first use, enter your server address or pairing link and complete pairing inside Companion. Later starts open the remembered server directly. Use **DeepSeek Harness Companion → Change server…** to enter another address or a fresh pairing link. Connection failures offer retry, changing server, or quit. The window stays on the selected origin; use that origin's pairing link when the server also advertises other LAN or public origins.

Check and package the unsigned Windows portable application:

```sh
pnpm --dir companion test
pnpm --dir companion build
pnpm --dir companion check
pnpm --dir companion package:win
```

The portable executable is written under `companion/dist/`. Packaging uses the existing desktop icon without modifying it.

<a id="notifications"></a>

## Notifications

Companion observes the page's existing Gateway WebSocket in the shell; no NAS plugin, server edit, extra authenticated connection, preload, or page-script patch is needed. When the window is in the background, an observed reply end can display a native system notification. Like nanobot, focused windows are quiet, clicking a notification restores and focuses the window, and a successful reply can include a plain-text preview bounded to 240 UTF-8 bytes. **DeepSeek Harness Companion → Test notification** displays a test even while focused.

Durable `turn/end` events distinguish success, failure and cancellation; known cancellation is quiet. For other background sessions, the live control stream can reveal that a turn ended without revealing its reason, so the reminder says the turn ended rather than claiming success. Active detailed streams take precedence over this fallback. Historical snapshots and connection loss alone never trigger a reminder. Deduplication retains the latest end per session for up to 256 sessions in each remote window. Only supported same-origin `/api/remote.mux` and `/remote/api/remote.mux` channels are observed; changing their wire format requires updating Companion. Opening Developer Tools pauses observation; close the tools and reload the remote page to restore its stream subscriptions. Observation or native-notification failures are reported; ordinary browsing remains available.

Companion currently has no tray: minimize it to keep receiving events; closing the window exits the client and stops observation while server tasks continue.

<a id="identity-and-storage"></a>

## Identity and storage

The product and executable are named **DeepSeek Harness Companion**; the application and Windows taskbar ID is `com.deepseek.harness.companion`. Preferences and Chromium storage live in Electron's `appData/DeepSeek Harness Companion`, including `remote-url.txt` and the `persist:companion` device-cookie partition. That directory is assigned before the single-instance lock, so the official local client can run alongside it; launching Companion again focuses its own window. Companion does not register `dsh://`, install the `dsh` command, or use the official update feed.

Only the server origin is written to `remote-url.txt`; pairing paths, query parameters and fragments are excluded. Enter pairing links only in the client that should receive the device cookie. Closing Companion leaves tasks running on the server.

<a id="maintenance-and-limits"></a>

## Maintenance and limits

All fork-specific code, configuration, dependencies, tests and expected output live under `companion/`, with an independent lockfile. Merging upstream desktop changes normally touches different files, although an upstream directory with the same name can conflict. Review Electron dependency upgrades and changes to server pairing or Web authentication separately. Official native desktop features do not automatically appear in Companion; server Web UI changes arrive from the server.

Companion has no desktop preload, local filesystem bridge, native permission grants, local onboarding, tray, or automatic updater. English and Chinese shell copy are included. The portable Windows package is unsigned; macOS and Linux packaging are not configured or qualified.

<a id="dev-note"></a>

## Dev Note

None.
