(function () {
  "use strict";

  if (window.__moviepy_cs_loaded) return;
  window.__moviepy_cs_loaded = true;

  // Envia mensagem de forma segura sem estourar "Extension context invalidated"
  function safeSendMessage(msg, callback) {
    try {
      if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id) {
        chrome.runtime.sendMessage(msg, function (res) {
          if (chrome.runtime.lastError) {
            // Ignora silenciosamente erros de desconexão
          }
          if (callback) callback(res);
        });
      }
    } catch (err) {
      console.warn("MoviePy CS: extensão desconectada ou recarregada.", err);
    }
  }

  // Garante inclusão no DOM mesmo se document.body ainda não existir
  function appendToBody(el) {
    if (document.body) {
      document.body.appendChild(el);
    } else {
      document.addEventListener("DOMContentLoaded", function () {
        if (document.body) document.body.appendChild(el);
      });
    }
  }

  // Badge no topo da tela do YouTube
  var badge = document.createElement("div");
  badge.style.cssText = "position:fixed;top:0;left:0;z-index:9999999;background:#FFD400;color:#000;padding:3px 10px;font:bold 11px monospace;border-bottom-right-radius:4px;";
  badge.textContent = "MP ✓ Z-início X-fim+título";
  appendToBody(badge);

  // Notificação Toast
  var toastTimer = null;
  var toastEl = null;
  function showToast(text) {
    if (!toastEl) {
      toastEl = document.createElement("div");
      toastEl.id = "__mp_toast";
      appendToBody(toastEl);
    }
    toastEl.textContent = text;
    toastEl.className = "show";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.className = ""; }, 2500);
  }

  // Limpa o título do vídeo do YouTube
  function cleanYTTitle(rawTitle) {
    if (!rawTitle) return "";
    return rawTitle
      .replace(/\s*-\s*YouTube$/i, "")
      .replace(/^\(\d+\)\s*/, "")
      .replace(/\[\s*Official Video\s*\]/i, "")
      .replace(/\(\s*Official Video\s*\)/i, "")
      .replace(/\(\s*Official Music Video\s*\)/i, "")
      .replace(/\[4K\]/i, "")
      .trim();
  }

  // Lista de palavras genéricas de "hype" para presetar o título do ranking.
  // Serve pra qualquer tipo de vídeo. Pode adicionar/remover à vontade.
  var RANKING_WORDS = [
    // PT / mistura
    "Goat", "Cold", "Insane", "Pedrada", "Sinistro", "Toma", "???", "OMG", "Receba",
    "Monstro", "Absurdo", "Surreal", "Épico", "Lendário", "Clássico", "Icônico",
    "Brabo", "Sensacional", "Perfeito", "Nível Deus", "Chocante", "Impossível",
    "Genial", "Obra-prima", "Bizarro", "Mitou", "Detonou", "Arrepiei", "Nostalgia",
    "Hino", "Pancada", "Nota 1000", "Fenômeno", "Craque", "Alucinante", "Espetacular",
    "Rei", "Cinema", "Fora da Curva", "Nasceu Pronto", "Brutal",
    // Inglês
    "Fire", "Hype", "Viral", "Top", "Banger", "Wow", "Clutch", "Nasty", "Filthy",
    "Legend", "Beast", "Godlike", "Unreal", "Sheesh", "Savage", "Peak", "Respect",
    "Flawless", "Smooth", "Clean", "Elite", "No Way", "Slaps", "Certified", "Heat"
  ];

  // Sorteia uma palavra aleatória, evitando repetir a última usada.
  var _lastWord = "";
  function pickRandomWord() {
    if (RANKING_WORDS.length <= 1) return RANKING_WORDS[0] || "";
    var w;
    do {
      w = RANKING_WORDS[Math.floor(Math.random() * RANKING_WORDS.length)];
    } while (w === _lastWord);
    _lastWord = w;
    return w;
  }

  // Caixinha simples de entrada de título
  var overlayEl = null;
  var overlayInput = null;

  function submitTitle() {
    // Pega exatamente o que está no input (se estiver vazio, respeita o vazio!)
    var title = overlayInput ? overlayInput.value.trim() : "";
    hideOverlay();
    var currentUrl = window.location.href;
    safeSendMessage({
      type: "SHORTCUT_TITLE_SAVE_NEXT",
      title: title,
      url: currentUrl
    });
    showToast(title ? "✅ Salvo: '" + title + "'! Avançando..." : "✅ Salvo (sem título)! Avançando...");
  }

  function createOverlay() {
    // Evita duplicar o card se já existir no DOM
    var existing = document.getElementById("__mp_title_overlay");
    if (existing) {
      overlayEl = existing;
      overlayInput = document.getElementById("__mp_title_input");
      return;
    }

    overlayEl = document.createElement("div");
    overlayEl.id = "__mp_title_overlay";
    overlayEl.innerHTML =
      '<div class="__mp_title_box">' +
      '<span style="font-weight:bold;color:#FFD400;font-size:14px;display:block;">🎬 Título do Item do Ranking:</span>' +
      '<input type="text" id="__mp_title_input" placeholder="Digite o título (ou deixe em branco)..." autocomplete="off" />' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px;font-size:11px;color:#999;">' +
      '<span>↵ Enter = Salvar | Esc = Cancelar</span>' +
      '<button id="__mp_title_btn_save" style="background:#FFD400;color:#000;border:none;padding:6px 16px;border-radius:6px;font-weight:bold;cursor:pointer;">Salvar e Avançar ➔</button>' +
      '</div>' +
      '</div>';
    appendToBody(overlayEl);
    overlayInput = document.getElementById("__mp_title_input");

    var saveBtn = document.getElementById("__mp_title_btn_save");
    if (saveBtn) {
      saveBtn.addEventListener("click", function (e) {
        e.preventDefault();
        e.stopPropagation();
        submitTitle();
      });
    }

    overlayInput.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.keyCode === 13) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        submitTitle();
      } else if (e.key === "Escape" || e.keyCode === 27) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        hideOverlay();
      }
    }, true);

    overlayEl.addEventListener("click", function (e) {
      if (e.target === overlayEl) hideOverlay();
    });
  }

  function showOverlay() {
    createOverlay();
    // Presetar com uma palavra genérica aleatória (Goat, Insane, Receba...).
    // O usuário pode dar Enter pra manter, ou digitar/apagar pra trocar.
    overlayInput.value = pickRandomWord();
    overlayEl.className = "show";
    setTimeout(function () {
      if (overlayInput) {
        overlayInput.focus();
        overlayInput.select();
      }
    }, 50);
  }

  function hideOverlay() {
    if (overlayEl) overlayEl.className = "";
    var video = document.querySelector("video");
    if (video) video.focus();
  }

  // Intercepta a tecla Enter quando a caixinha está visível na tela
  window.addEventListener("keydown", function (e) {
    if (!overlayEl || overlayEl.className !== "show") return;
    if (e.key === "Enter" || e.keyCode === 13) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      submitTitle();
    } else if (e.key === "Escape" || e.keyCode === 27) {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      hideOverlay();
    }
  }, true);

  // Comunicação entre inline.js e content.js
  window.addEventListener("message", function (event) {
    if (event.source !== window) return;
    var data = event.data;
    if (!data || data.source !== "MOVIEPY") return;

    var currentUrl = window.location.href;
    var currentTitle = cleanYTTitle(document.title);

    if (data.type === "TRIM_START") {
      safeSendMessage({
        type: "SHORTCUT_TRIM_START",
        time: data.time,
        url: currentUrl,
        title: currentTitle
      });
      showToast("⏱️ Início capturado: " + data.time.toFixed(1) + "s");
    } else if (data.type === "TRIM_END") {
      safeSendMessage({
        type: "SHORTCUT_TRIM_END",
        time: data.time,
        url: currentUrl,
        title: currentTitle
      });
      showToast("⏱️ Fim capturado: " + data.time.toFixed(1) + "s");
    } else if (data.type === "SHOW_OVERLAY") {
      showOverlay();
    } else if (data.type === "YOUTUBE_NAVIGATED") {
      safeSendMessage({
        type: "YOUTUBE_NAVIGATED",
        url: data.url || currentUrl,
        title: data.title || currentTitle
      });
    }
  });

  // Injeta inline.js no contexto da página
  try {
    if (typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.getURL) {
      var script = document.createElement("script");
      script.src = chrome.runtime.getURL("content/inline.js");
      (document.head || document.documentElement).appendChild(script);
    }
  } catch (err) {
    console.warn("MoviePy CS: erro ao injetar inline.js", err);
  }
})();
