/**
 * MoviePy Ranking Companion — Background Service Worker
 *
 * Responsibilities:
 *   1. Open the side panel when the extension icon is clicked.
 *   2. Keep background messaging channel open.
 */

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onStartup.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  sendResponse({ status: "received" });
  return true;
});
