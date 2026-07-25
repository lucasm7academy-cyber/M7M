/**
 * MoviePy YouTube Shortcuts — Inline Script (roda no contexto da página)
 * Carregado via <script src> para bypassar CSP do YouTube.
 * Comunica com o content script via window.postMessage.
 */
(function () {
  "use strict";
  if (window.__mp_inline_loaded) return;
  window.__mp_inline_loaded = true;

  function getTime() {
    var video = document.querySelector("video");
    return video ? video.currentTime : null;
  }

  // Notifica a extensão quando o YouTube navega via SPA
  function notifyNavigation() {
    window.postMessage({
      source: "MOVIEPY",
      type: "YOUTUBE_NAVIGATED",
      url: window.location.href,
      title: document.title
    }, "*");
  }

  window.addEventListener("yt-navigate-finish", notifyNavigation);
  window.addEventListener("spfdone", notifyNavigation);

  // Fallback para SPA Navigation (monitora mudanças de URL)
  var lastUrl = location.href;
  setInterval(function () {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      notifyNavigation();
    }
  }, 800);

  window.addEventListener("keydown", function (e) {
    var active = document.activeElement;
    if (active && (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.isContentEditable)) {
      return;
    }

    var key = e.key.toLowerCase();

    if (key === "z") {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      var t = getTime();
      if (t !== null) {
        window.postMessage({ source: "MOVIEPY", type: "TRIM_START", time: t }, "*");
      }
    } else if (key === "x") {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      var t = getTime();
      if (t !== null) {
        window.postMessage({ source: "MOVIEPY", type: "TRIM_END", time: t }, "*");
      }
      window.postMessage({ source: "MOVIEPY", type: "SHOW_OVERLAY" }, "*");
    }
  }, true);
})();

