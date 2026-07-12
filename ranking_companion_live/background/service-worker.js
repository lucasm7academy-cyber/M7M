/**
 * MoviePy Ranking Companion — Background Service Worker
 *
 * Responsibilities:
 *   1. Open the side panel when the extension icon is clicked.
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});
