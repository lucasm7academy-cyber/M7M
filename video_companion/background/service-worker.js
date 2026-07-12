/**
 * Service Worker — M7 Video Companion
 */

chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((error) => console.error(error));
