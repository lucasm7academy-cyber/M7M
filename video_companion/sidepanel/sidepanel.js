/**
 * M7 Video Companion — Sidepanel Logic
 */

// ── Configuration State ──
let API_URL = "http://localhost:8090";
let activeVideoIdx = null;
let activeVideoData = null;
let currentTabVideoUrl = "";
let currentTabVideoTitle = "";

// ── Drag & Resize Tarja State ──
let dragMode = null; // 'move' or 'resize'
let dragStartX = 0;
let dragStartY = 0;
let dragOrigTarja = null;

// ── Constants for UI Preview ──
const CORES_HEX = {
  Branco: '#FFFFFF', Amarelo: '#FFD400', Preto: '#000000',
  Vermelho: '#FF3B30', Verde: '#27E36B', Azul: '#3B82F6', Rosa: '#FF2D95',
};

const STATUS_EMOJI = {
  editando:       '📝',
  na_fila:        '⏳',
  baixando:       '📥',
  convertendo:    '🔄',
  exportando:     '💾',
  legendando:     '💬',
  narrando:       '🎙️',
  processando:    '⚙️',
  enviando_drive: '☁️',
  concluido:      '✅',
  erro:           '❌',
  erro_upload:    '⚠️',
};

// ── DOM Elements ──
const connDot = document.getElementById("connDot");
const connMsg = document.getElementById("connMsg");
const toggleSettings = document.getElementById("toggleSettings");
const settingsPanel = document.getElementById("settingsPanel");
const apiUrlInput = document.getElementById("apiUrlInput");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");

const driveFolderSelect = document.getElementById("driveFolderSelect");

const activeMediaSection = document.getElementById("activeMediaSection");
const noVideoMsg = document.getElementById("noVideoMsg");
const videoDetails = document.getElementById("videoDetails");
const mediaThumb = document.getElementById("mediaThumb");
const mediaSource = document.getElementById("mediaSource");
const mediaTitleDisplay = document.getElementById("mediaTitleDisplay");

const itemUrlInput = document.getElementById("itemUrlInput");
const btnAddVideo = document.getElementById("btnAddVideo");

const btnRefreshQueue = document.getElementById("btnRefreshQueue");
const noVideosInQueueMsg = document.getElementById("noVideosInQueueMsg");
const videoQueueList = document.getElementById("videoQueueList");
const btnProcessQueue = document.getElementById("btnProcessQueue");

// Selected Video Configuration Panel
const selectedVideoConfig = document.getElementById("selectedVideoConfig");
const videoTitleInput = document.getElementById("videoTitleInput");
const trimInicioSlider = document.getElementById("trimInicioSlider");
const trimFimSlider = document.getElementById("trimFimSlider");
const trimTrackFill = document.getElementById("trimTrackFill");
const trimValDisplay = document.getElementById("trimValDisplay");
const overlaySelect = document.getElementById("overlaySelect");
const colorSelect = document.getElementById("colorSelect");
const fontSelect = document.getElementById("fontSelect");
const filterSelect = document.getElementById("filterSelect");
const voiceSelect = document.getElementById("voiceSelect");
const musicSelect = document.getElementById("musicSelect");
const narrarTituloCheckbox = document.getElementById("narrarTituloCheckbox");
const videoYInput = document.getElementById("videoYInput");
const videoYVal = document.getElementById("videoYVal");
const titleYInput = document.getElementById("titleYInput");
const titleYVal = document.getElementById("titleYVal");
const legendCheckbox = document.getElementById("legendCheckbox");
const legendStyleSelect = document.getElementById("legendStyleSelect");
const legendStyleField = document.getElementById("legendStyleField");

// Hook Configs
const hookAtivoCheckbox = document.getElementById("hookAtivoCheckbox");
const hookFieldsContainer = document.getElementById("hookFieldsContainer");
const hookTextoInput = document.getElementById("hookTextoInput");
const hookTipoSelect = document.getElementById("hookTipoSelect");
const hookSomEntradaSelect = document.getElementById("hookSomEntradaSelect");
const hookSomSaidaSelect = document.getElementById("hookSomSaidaSelect");

// Tarja Configs
const tarjaAtivaCheckbox = document.getElementById("tarjaAtivaCheckbox");
const tarjaFieldsContainer = document.getElementById("tarjaFieldsContainer");
const tarjaTextoInput = document.getElementById("tarjaTextoInput");
const tarjaXInput = document.getElementById("tarjaXInput");
const tarjaYInput = document.getElementById("tarjaYInput");
const tarjaWInput = document.getElementById("tarjaWInput");
const tarjaHInput = document.getElementById("tarjaHInput");

// Custom Narration Configs
const narrationsList = document.getElementById("narrationsList");
const btnAddNarration = document.getElementById("btnAddNarration");

// Live 9:16 Preview Box
const livePreviewArea = document.getElementById("livePreviewArea");
const livePreviewContainer = document.getElementById("livePreviewContainer");
const livePreviewFallback = document.getElementById("livePreviewFallback");
const livePreviewBlurBg = document.getElementById("livePreviewBlurBg");
const livePreviewFrame = document.getElementById("livePreviewFrame");
const livePreviewOverlay = document.getElementById("livePreviewOverlay");
const livePreviewTitle = document.getElementById("livePreviewTitle");
const livePreviewTarja = document.getElementById("livePreviewTarja");
const livePreviewTarjaText = document.getElementById("livePreviewTarjaText");
const livePreviewTarjaResize = document.getElementById("livePreviewTarjaResize");
const previewLoadingBadge = document.getElementById("previewLoadingBadge");
const btnOpenTab = document.getElementById("btnOpenTab");

// ── Initialize ──
document.addEventListener("DOMContentLoaded", () => {
  // Load saved API URL
  chrome.storage.local.get(["apiUrl", "lastVideoIdx"], (result) => {
    if (result.apiUrl) {
      API_URL = result.apiUrl;
      apiUrlInput.value = API_URL;
    }
    if (result.lastVideoIdx !== undefined) {
      activeVideoIdx = result.lastVideoIdx;
    }
    checkApiConnection().then((ok) => {
      if (ok) {
        refreshAllData();
      }
    });
  });

  setupEventListeners();
  updateActiveTabInfo();
});

// Refresh all components when online
function refreshAllData() {
  loadDriveFolders();
  loadOverlays();
  loadOptions();
  loadVoices();
  loadMusic();
  loadQueue();
}

// ── Setup Listeners ──
function setupEventListeners() {
  // Open in full tab
  if (btnOpenTab) {
    btnOpenTab.addEventListener("click", () => {
      chrome.tabs.create({ url: chrome.runtime.getURL("sidepanel/sidepanel.html") });
    });
  }

  // Toggle Settings Panel
  toggleSettings.addEventListener("click", () => {
    settingsPanel.classList.toggle("collapsed");
  });

  // Save Settings
  saveSettingsBtn.addEventListener("click", () => {
    const value = apiUrlInput.value.trim().replace(/\/$/, "");
    if (value) {
      API_URL = value;
      chrome.storage.local.set({ apiUrl: API_URL }, () => {
        settingsPanel.classList.add("collapsed");
        showStatusMessage("Configurações salvas!", "success");
        checkApiConnection().then((ok) => {
          if (ok) refreshAllData();
        });
      });
    }
  });

  // Save selected Drive folder
  if (driveFolderSelect) {
    driveFolderSelect.addEventListener("change", async (e) => {
      const folderId = e.target.value;
      if (!folderId) return;
      try {
        const res = await fetch(`${API_URL}/api/pastas/selecionada`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: folderId })
        });
        if (res.ok) {
          showStatusMessage("Pasta de destino salva!", "success");
        }
      } catch (err) {
        console.error(err);
        showStatusMessage("Erro ao salvar pasta", "error");
      }
    });
  }

  // Grabber: Add Video to Queue
  btnAddVideo.addEventListener("click", addVideoToQueue);

  // Refresh Queue List
  btnRefreshQueue.addEventListener("click", refreshAllData);

  // Process whole single videos queue
  btnProcessQueue.addEventListener("click", processVideosQueue);

  // Add custom narration block
  btnAddNarration.addEventListener("click", addNewNarrationBlock);

  // Configuration Fields Inputs (PATCH updates in real time)
  
  // Real-time title update
  videoTitleInput.addEventListener("input", (e) => {
    const val = e.target.value;
    if (activeVideoData) {
      activeVideoData.title = val;
      updateLivePreview();
      // Update list card title
      const cardTitle = document.querySelector(`.position-card[data-idx="${activeVideoIdx}"] .position-title`);
      if (cardTitle) cardTitle.textContent = val || "Vídeo sem título";
    }
  });
  videoTitleInput.addEventListener("change", () => saveVideoPatch({ title: videoTitleInput.value }));

  // Trim range sliders input/change handlers
  trimInicioSlider.addEventListener("input", updateTrimSliderVisuals);
  trimFimSlider.addEventListener("input", updateTrimSliderVisuals);
  
  const saveTrimPatch = () => {
    saveVideoPatch({
      trim_inicio_s: parseFloat(trimInicioSlider.value),
      trim_fim_s: parseFloat(trimFimSlider.value)
    });
  };
  trimInicioSlider.addEventListener("change", saveTrimPatch);
  trimFimSlider.addEventListener("change", saveTrimPatch);

  overlaySelect.addEventListener("change", () => {
    const val = overlaySelect.value || null;
    if (activeVideoData) activeVideoData.overlay = val;
    updateLivePreview();
    saveVideoPatch({ overlay: val });
  });

  colorSelect.addEventListener("change", () => {
    const val = colorSelect.value || "Branco";
    if (activeVideoData) activeVideoData.cor_titulo = val;
    updateLivePreview();
    saveVideoPatch({ cor_titulo: val });
  });

  fontSelect.addEventListener("change", () => {
    const val = fontSelect.value || "Padrão";
    if (activeVideoData) activeVideoData.font = val;
    updateLivePreview();
    saveVideoPatch({ font: val });
  });

  filterSelect.addEventListener("change", () => {
    saveVideoPatch({ filtro: filterSelect.value });
  });

  voiceSelect.addEventListener("change", () => {
    saveVideoPatch({ voice: voiceSelect.value });
  });

  musicSelect.addEventListener("change", () => {
    saveVideoPatch({ musica_fundo: musicSelect.value });
  });

  narrarTituloCheckbox.addEventListener("change", () => {
    saveVideoPatch({ narrar_titulo: narrarTituloCheckbox.checked });
  });

  // Video vertical offset
  videoYInput.addEventListener("input", (e) => {
    const val = e.target.value;
    videoYVal.textContent = val + "px";
    if (activeVideoData) {
      activeVideoData.video_y = parseInt(val, 10);
      updateLivePreviewPlacement();
    }
  });
  videoYInput.addEventListener("change", () => {
    saveVideoPatch({ video_y: parseInt(videoYInput.value, 10) });
  });

  // Title vertical position
  titleYInput.addEventListener("input", (e) => {
    const val = e.target.value;
    titleYVal.textContent = val + "px";
    if (activeVideoData) {
      activeVideoData.title_y = parseInt(val, 10);
      updateLivePreview();
    }
  });
  titleYInput.addEventListener("change", () => {
    saveVideoPatch({ title_y: parseInt(titleYInput.value, 10) });
  });

  // Legend checkbox
  legendCheckbox.addEventListener("change", () => {
    const active = legendCheckbox.checked;
    legendStyleField.style.display = active ? "block" : "none";
    saveVideoPatch({ gerar_legenda: active });
  });

  legendStyleSelect.addEventListener("change", () => {
    saveVideoPatch({ estilo_legenda: legendStyleSelect.value });
  });

  // Hook Configs changes
  hookAtivoCheckbox.addEventListener("change", () => {
    const active = hookAtivoCheckbox.checked;
    hookFieldsContainer.style.display = active ? "flex" : "none";
    saveVideoPatch({ hook_ativo: active });
  });

  hookTextoInput.addEventListener("change", () => {
    saveVideoPatch({ hook_texto: hookTextoInput.value.trim() });
  });

  hookTipoSelect.addEventListener("change", () => {
    saveVideoPatch({ hook_tipo: hookTipoSelect.value });
  });

  hookSomEntradaSelect.addEventListener("change", () => {
    saveVideoPatch({ hook_som_entrada: hookSomEntradaSelect.value });
  });

  hookSomSaidaSelect.addEventListener("change", () => {
    saveVideoPatch({ hook_som_saida: hookSomSaidaSelect.value });
  });

  // Tarja Configs changes
  tarjaAtivaCheckbox.addEventListener("change", () => {
    const active = tarjaAtivaCheckbox.checked;
    tarjaFieldsContainer.style.display = active ? "flex" : "none";
    if (activeVideoData) {
      if (!activeVideoData.tarja) activeVideoData.tarja = { x: 0.35, y: 0.45, w: 0.30, h: 0.07, texto: "" };
      activeVideoData.tarja.ativo = active;
    }
    updateLivePreviewTarjaDOM();
    saveTarjaPatch();
  });

  tarjaTextoInput.addEventListener("input", (e) => {
    const val = e.target.value;
    if (activeVideoData && activeVideoData.tarja) {
      activeVideoData.tarja.texto = val;
      updateLivePreviewTarjaDOM();
    }
  });
  tarjaTextoInput.addEventListener("change", saveTarjaPatch);

  // Sync inputs to preview in real-time when typed
  const syncTarjaNumeric = () => {
    if (activeVideoData && activeVideoData.tarja) {
      activeVideoData.tarja.x = parseFloat(tarjaXInput.value) || 0.35;
      activeVideoData.tarja.y = parseFloat(tarjaYInput.value) || 0.45;
      activeVideoData.tarja.w = parseFloat(tarjaWInput.value) || 0.30;
      activeVideoData.tarja.h = parseFloat(tarjaHInput.value) || 0.07;
      updateLivePreviewTarjaDOM();
    }
  };
  tarjaXInput.addEventListener("input", syncTarjaNumeric);
  tarjaYInput.addEventListener("input", syncTarjaNumeric);
  tarjaWInput.addEventListener("input", syncTarjaNumeric);
  tarjaHInput.addEventListener("input", syncTarjaNumeric);

  tarjaXInput.addEventListener("change", saveTarjaPatch);
  tarjaYInput.addEventListener("change", saveTarjaPatch);
  tarjaWInput.addEventListener("change", saveTarjaPatch);
  tarjaHInput.addEventListener("change", saveTarjaPatch);

  // Drag and Resize listeners directly on preview Tarja Box
  livePreviewTarja.addEventListener("mousedown", (e) => startDrag("move", e));
  livePreviewTarjaResize.addEventListener("mousedown", (e) => startDrag("resize", e));

  // Refresh frame placement when the live preview image finishes loading
  livePreviewFrame.addEventListener("load", () => {
    previewLoadingBadge.style.display = "none";
    livePreviewFallback.style.opacity = "0";
    livePreviewBlurBg.style.opacity = "1";
    livePreviewFrame.style.opacity = "1";
    updateLivePreviewPlacement();
  });
  livePreviewFrame.addEventListener("error", () => {
    previewLoadingBadge.style.display = "none";
    livePreviewFallback.style.opacity = "1";
    livePreviewBlurBg.style.opacity = "0";
    livePreviewFrame.style.opacity = "0";
  });

  // Tab Activation/Update Listeners to dynamically grab video URL
  chrome.tabs.onActivated.addListener(() => {
    setTimeout(updateActiveTabInfo, 150);
  });
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.status === "complete" || changeInfo.title || changeInfo.url) {
      updateActiveTabInfo();
    }
  });
}

// ── Interactive Tarja Drag / Resize Logic ──
function startDrag(mode, e) {
  e.preventDefault();
  e.stopPropagation();

  if (!activeVideoData || !activeVideoData.tarja || !activeVideoData.tarja.ativo) return;

  dragMode = mode;
  dragStartX = e.clientX;
  dragStartY = e.clientY;

  const t = activeVideoData.tarja;
  dragOrigTarja = {
    x: t.x !== undefined ? t.x : 0.35,
    y: t.y !== undefined ? t.y : 0.45,
    w: t.w !== undefined ? t.w : 0.30,
    h: t.h !== undefined ? t.h : 0.07,
    texto: t.texto || ""
  };

  window.addEventListener("mousemove", onDragMove);
  window.addEventListener("mouseup", onDragUp);
}

function onDragMove(e) {
  if (!dragMode || !dragOrigTarja) return;
  const rect = livePreviewContainer.getBoundingClientRect();
  if (!rect || rect.width === 0 || rect.height === 0) return;

  const dx = (e.clientX - dragStartX) / rect.width;
  const dy = (e.clientY - dragStartY) / rect.height;

  let x = dragOrigTarja.x;
  let y = dragOrigTarja.y;
  let w = dragOrigTarja.w;
  let h = dragOrigTarja.h;

  if (dragMode === "move") {
    x = Math.max(0, Math.min(1 - w, dragOrigTarja.x + dx));
    y = Math.max(0, Math.min(1 - h, dragOrigTarja.y + dy));
  } else if (dragMode === "resize") {
    w = Math.max(0.05, Math.min(1 - x, dragOrigTarja.w + dx));
    h = Math.max(0.02, Math.min(1 - y, dragOrigTarja.h + dy));
  }

  if (!activeVideoData.tarja) activeVideoData.tarja = {};
  activeVideoData.tarja.x = x;
  activeVideoData.tarja.y = y;
  activeVideoData.tarja.w = w;
  activeVideoData.tarja.h = h;

  updateLivePreviewTarjaDOM();

  // Sync back to numeric inputs (fixed decimal points)
  tarjaXInput.value = x.toFixed(2);
  tarjaYInput.value = y.toFixed(2);
  tarjaWInput.value = w.toFixed(2);
  tarjaHInput.value = h.toFixed(2);
}

function onDragUp() {
  window.removeEventListener("mousemove", onDragMove);
  window.removeEventListener("mouseup", onDragUp);

  dragMode = null;
  dragOrigTarja = null;

  saveTarjaPatch();
}

// ── API Operations ──
async function checkApiConnection() {
  updateStatus("Verificando conexão...", "checking");
  try {
    const res = await fetch(`${API_URL}/api/gpu`, { method: "GET" });
    if (res.ok) {
      updateStatus("Online", "online");
      return true;
    } else {
      updateStatus("API retornou erro", "offline");
      return false;
    }
  } catch (e) {
    updateStatus("Offline (inicie o app na porta 8090)", "offline");
    return false;
  }
}

function updateStatus(message, state) {
  connMsg.textContent = message;
  connDot.className = "conn-dot";
  if (state === "online") {
    connDot.classList.add("online");
    connMsg.style.color = "var(--green)";
  } else if (state === "checking") {
    connMsg.style.color = "var(--text-muted)";
  } else {
    connMsg.style.color = "var(--red)";
  }
}

async function loadDriveFolders() {
  if (!driveFolderSelect) return;
  try {
    const res = await fetch(`${API_URL}/api/pastas`);
    if (res.ok) {
      const data = await res.json();
      driveFolderSelect.innerHTML = "";
      if (!data.pastas || data.pastas.length === 0) {
        driveFolderSelect.innerHTML = '<option value="">Nenhuma pasta cadastrada</option>';
        return;
      }
      data.pastas.forEach((p) => {
        const isSelected = data.selecionada && data.selecionada.id === p.id ? "selected" : "";
        driveFolderSelect.innerHTML += `<option value="${p.id}" ${isSelected}>📁 ${p.nome}</option>`;
      });
    }
  } catch (e) {
    console.error("Erro ao carregar pastas do Drive:", e);
  }
}

async function loadOverlays() {
  try {
    const res = await fetch(`${API_URL}/api/overlays`);
    if (res.ok) {
      const overlays = await res.json();
      overlaySelect.innerHTML = '<option value="">Nenhum / Sem máscara</option>';
      overlays.forEach((o) => {
        overlaySelect.innerHTML += `<option value="${o.id}">Overlay ${o.id}</option>`;
      });
    }
  } catch (e) {
    console.error("Erro ao carregar overlays:", e);
  }
}

async function loadOptions() {
  try {
    const res = await fetch(`${API_URL}/api/options`);
    if (res.ok) {
      const opts = await res.json();
      
      // Fonts
      fontSelect.innerHTML = "";
      opts.fonts.forEach((f) => {
        fontSelect.innerHTML += `<option value="${f}">${f}</option>`;
      });

      // Colors (dictionary key parsing)
      colorSelect.innerHTML = "";
      if (opts.cores) {
        Object.keys(opts.cores).forEach((c) => {
          colorSelect.innerHTML += `<option value="${c}">${c}</option>`;
        });
      }

      // Filters
      filterSelect.innerHTML = "";
      opts.filtros.forEach((f) => {
        filterSelect.innerHTML += `<option value="${f}">${f}</option>`;
      });

      // Hook Types (list of strings)
      hookTipoSelect.innerHTML = "";
      if (opts.hook_tipos) {
        opts.hook_tipos.forEach((t) => {
          const label = t === "textao" ? "Textão" : t === "corte_seco" ? "Corte Seco" : t.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase());
          hookTipoSelect.innerHTML += `<option value="${t}">${label}</option>`;
        });
      }

      // Hook Sounds (list of strings)
      hookSomEntradaSelect.innerHTML = "";
      hookSomSaidaSelect.innerHTML = "";
      if (opts.hook_som_opcoes) {
        opts.hook_som_opcoes.forEach((s) => {
          const label = s === "none" ? "Nenhum" : s.replace("_", " ").replace(/\b\w/g, c => c.toUpperCase());
          const opt = `<option value="${s}">${label}</option>`;
          hookSomEntradaSelect.innerHTML += opt;
          hookSomSaidaSelect.innerHTML += opt;
        });
      }
    }
  } catch (e) {
    console.error("Erro ao carregar opções básicas:", e);
  }
}

async function loadVoices() {
  try {
    const res = await fetch(`${API_URL}/api/narration-voices`);
    if (res.ok) {
      const voices = await res.json();
      voiceSelect.innerHTML = '<option value="padrao">Padrão (Piper)</option>';
      voices.forEach((v) => {
        voiceSelect.innerHTML += `<option value="${v.id}">${v.label || v.nome}</option>`; // Fixed: using label instead of nome
      });
    }
  } catch (e) {
    console.error("Erro ao carregar vozes:", e);
  }
}

async function loadMusic() {
  try {
    const res = await fetch(`${API_URL}/api/music`);
    if (res.ok) {
      const music = await res.json();
      musicSelect.innerHTML = '<option value="none">Nenhuma</option>';
      music.forEach((m) => {
        musicSelect.innerHTML += `<option value="${m.id}">${m.label || m.nome}</option>`; // Fixed: using label instead of nome
      });
    }
  } catch (e) {
    console.error("Erro ao carregar músicas:", e);
  }
}

async function loadQueue() {
  try {
    const res = await fetch(`${API_URL}/api/videos`);
    if (!res.ok) throw new Error();
    const videos = await res.json();

    if (videos.length === 0) {
      noVideosInQueueMsg.style.display = "block";
      videoQueueList.style.display = "none";
      btnProcessQueue.style.display = "none";
      hideVideoConfigPanel();
      return;
    }

    noVideosInQueueMsg.style.display = "none";
    videoQueueList.style.display = "flex";
    btnProcessQueue.style.display = "block";
    renderQueueItems(videos);

    // If an index was active, load it
    if (activeVideoIdx !== null && activeVideoIdx >= 0 && activeVideoIdx < videos.length) {
      loadVideoDetails(activeVideoIdx, videos[activeVideoIdx]);
    } else {
      activeVideoIdx = null;
      hideVideoConfigPanel();
    }
  } catch (e) {
    console.error("Erro ao carregar fila de vídeos:", e);
    videoQueueList.innerHTML = '<div class="alert-box alert-warn">Erro ao conectar à fila</div>';
    btnProcessQueue.style.display = "none";
  }
}

function renderQueueItems(videos) {
  videoQueueList.innerHTML = "";
  videos.forEach((video, idx) => {
    const isEditing = idx === activeVideoIdx;
    const status = video.status || "editando";
    const emoji = STATUS_EMOJI[status] || '📝';
    const isQueued = status !== "editando";

    const card = document.createElement("div");
    card.className = "position-card";
    card.setAttribute("data-idx", idx);
    card.style.cursor = "pointer";

    if (isEditing) {
      card.style.borderColor = "var(--cyan)";
      card.style.background = "var(--cyan-soft)";
    }

    card.innerHTML = `
      <div class="position-badge">${emoji}</div>
      <div class="position-info">
        <div class="position-title" style="font-weight: 700;">
          ${video.title || "Vídeo sem título"}
        </div>
        <div class="position-meta">
          <span class="position-meta-item">⏱️ ${(video.duration || 0).toFixed(0)}s</span>
          <span class="position-meta-item">↕️ ${video.video_y || 0}px</span>
          <span class="position-meta-item">Status: ${status.replace("_", " ")}</span>
        </div>
      </div>
      <div class="position-actions" style="gap: 6px; display: flex;">
        <button type="button" class="btn btn-secondary btn-action-queue" data-idx="${idx}">
          ${isQueued ? "Pausar" : "Fila"}
        </button>
        <button type="button" class="btn-icon-only btn-delete-video" data-idx="${idx}" title="Remover" style="padding: 4px 6px;">🗑️</button>
      </div>
    `;

    // Queue button click
    const queueBtn = card.querySelector(".btn-action-queue");
    queueBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      updateStatus("Processando...", "checking");
      try {
        const url = isQueued 
          ? `${API_URL}/api/videos/${idx}/queue` 
          : `${API_URL}/api/videos/${idx}/queue`;
        const method = isQueued ? "DELETE" : "POST";
        const res = await fetch(url, { method });
        if (res.ok) {
          showStatusMessage(isQueued ? "Vídeo pausado!" : "Vídeo enfileirado!", "success");
          loadQueue();
        }
      } catch (err) {
        console.error(err);
      }
    });

    // Delete button click
    const deleteBtn = card.querySelector(".btn-delete-video");
    deleteBtn.addEventListener("click", async (e) => {
      e.stopPropagation();
      if (!confirm("Remover este vídeo da fila permanentemente?")) return;
      updateStatus("Removendo...", "checking");
      try {
        const res = await fetch(`${API_URL}/api/videos/${idx}`, { method: "DELETE" });
        if (res.ok) {
          showStatusMessage("Vídeo removido da fila!", "success");
          if (activeVideoIdx === idx) {
            activeVideoIdx = null;
            chrome.storage.local.remove("lastVideoIdx");
          } else if (activeVideoIdx > idx) {
            activeVideoIdx--;
            chrome.storage.local.set({ lastVideoIdx: activeVideoIdx });
          }
          loadQueue();
        }
      } catch (err) {
        console.error(err);
      }
    });

    // Card click: Select video to edit
    card.addEventListener("click", () => {
      activeVideoIdx = idx;
      chrome.storage.local.set({ lastVideoIdx: idx });
      loadQueue();
    });

    videoQueueList.appendChild(card);
  });
}

function loadVideoDetails(idx, video) {
  activeVideoData = video;
  selectedVideoConfig.style.display = "block";

  // Prefill fields
  videoTitleInput.value = video.title || "";

  // Initialize trim slider bounds and values
  const duration = video.duration || 12.0;
  trimInicioSlider.max = duration;
  trimFimSlider.max = duration;
  
  trimInicioSlider.value = video.trim_inicio_s !== undefined ? video.trim_inicio_s : 0.0;
  trimFimSlider.value = video.trim_fim_s !== undefined ? video.trim_fim_s : duration;
  updateTrimSliderVisuals();

  overlaySelect.value = video.overlay || "";
  colorSelect.value = video.cor_titulo || "Branco";
  fontSelect.value = video.font || "Padrão";
  filterSelect.value = video.filtro || "Nenhum";
  voiceSelect.value = video.voice || "padrao";
  musicSelect.value = video.musica_fundo || "none";
  narrarTituloCheckbox.checked = !!video.narrar_titulo;
  
  videoYInput.value = video.video_y || 0;
  videoYVal.textContent = (video.video_y || 0) + "px";
  titleYInput.value = video.title_y || 220;
  titleYVal.textContent = (video.title_y || 220) + "px";

  // Legend checkbox
  const hasLegend = !!video.gerar_legenda;
  legendCheckbox.checked = hasLegend;
  legendStyleField.style.display = hasLegend ? "block" : "none";
  legendStyleSelect.value = video.estilo_legenda || "AMARELO_CLASSICO";

  // Hook Configs
  const hasHook = !!video.hook_ativo;
  hookAtivoCheckbox.checked = hasHook;
  hookFieldsContainer.style.display = hasHook ? "flex" : "none";
  hookTextoInput.value = video.hook_texto || "";
  hookTipoSelect.value = video.hook_tipo || "BOX_PRETA";
  hookSomEntradaSelect.value = video.hook_som_entrada || "none";
  hookSomSaidaSelect.value = video.hook_som_saida || "none";

  // Tarja Configs
  const hasTarja = !!video.tarja?.ativo;
  tarjaAtivaCheckbox.checked = hasTarja;
  tarjaFieldsContainer.style.display = hasTarja ? "flex" : "none";
  tarjaTextoInput.value = video.tarja?.texto || "";
  tarjaXInput.value = video.tarja?.x !== undefined ? video.tarja.x.toFixed(2) : "0.35";
  tarjaYInput.value = video.tarja?.y !== undefined ? video.tarja.y.toFixed(2) : "0.45";
  tarjaWInput.value = video.tarja?.w !== undefined ? video.tarja.w.toFixed(2) : "0.30";
  tarjaHInput.value = video.tarja?.h !== undefined ? video.tarja.h.toFixed(2) : "0.07";

  // Load custom narrations list
  renderNarrations();

  // Load preview
  triggerLivePreviewLoading(video.url);
}

function hideVideoConfigPanel() {
  selectedVideoConfig.style.display = "none";
  activeVideoData = null;
  livePreviewArea.style.display = "none";
}

async function addVideoToQueue() {
  const url = itemUrlInput.value.trim();
  
  if (!url) {
    showStatusMessage("Nenhum vídeo detectado!", "error");
    return;
  }

  // Use YouTube grabbed title as default title
  const title = currentTabVideoTitle || null;

  updateStatus("Adicionando...", "checking");
  try {
    const res = await fetch(`${API_URL}/api/videos`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        url: url,
        title: title
      })
    });
    if (res.ok) {
      showStatusMessage("Vídeo adicionado com sucesso!", "success");
      
      const resData = await res.json();
      activeVideoIdx = resData.idx;
      chrome.storage.local.set({ lastVideoIdx: activeVideoIdx });
      
      await loadQueue();
    } else {
      throw new Error();
    }
  } catch (e) {
    console.error(e);
    showStatusMessage("Erro ao adicionar vídeo", "error");
    checkApiConnection();
  }
}

async function saveVideoPatch(patch) {
  if (activeVideoIdx === null) return;
  try {
    const res = await fetch(`${API_URL}/api/videos/${activeVideoIdx}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch)
    });
    if (res.ok) {
      const data = await res.json();
      activeVideoData = data;
    }
  } catch (e) {
    console.error("Erro ao salvar patch:", e);
  }
}

function saveTarjaPatch() {
  const patch = {
    tarja: {
      ativo: tarjaAtivaCheckbox.checked,
      texto: tarjaTextoInput.value.trim(),
      x: parseFloat(tarjaXInput.value) || 0.35,
      y: parseFloat(tarjaYInput.value) || 0.45,
      w: parseFloat(tarjaWInput.value) || 0.30,
      h: parseFloat(tarjaHInput.value) || 0.07
    }
  };
  saveVideoPatch(patch);
}

async function processVideosQueue() {
  updateStatus("Iniciando render...", "checking");
  try {
    const res = await fetch(`${API_URL}/api/process`, { method: "POST" });
    if (res.ok) {
      showStatusMessage("Renderizador iniciado!", "success");
      loadQueue();
    } else {
      throw new Error();
    }
  } catch (e) {
    console.error("Erro ao iniciar processador:", e);
    showStatusMessage("Erro ao iniciar render", "error");
  }
}

// ── Tab Management & YouTube Scraper ──
async function updateActiveTabInfo() {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  if (!tab || !tab.url) {
    showNoVideoDetected();
    return;
  }

  const url = tab.url;
  const title = tab.title;

  const isYouTube = url.includes("youtube.com/watch") || url.includes("youtube.com/shorts") || url.includes("youtu.be/");
  const isInstagram = url.includes("instagram.com/reel/") || url.includes("instagram.com/p/");

  if (isYouTube || isInstagram) {
    if (currentTabVideoUrl === url) return;
    currentTabVideoUrl = url;
    
    let cleanedTitle = title.replace(/ - YouTube$/, "").replace(/^\(\d+\)\s+/, "");
    currentTabVideoTitle = cleanedTitle;

    itemUrlInput.value = url;

    const videoId = extractVideoId(url);
    if (isYouTube && videoId) {
      mediaThumb.src = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
      mediaSource.textContent = "YouTube";
    } else {
      mediaThumb.src = "https://www.instagram.com/static/images/ico/favicon.ico/36b30c7e5c16.ico";
      mediaSource.textContent = "Instagram";
    }
    mediaTitleDisplay.textContent = cleanedTitle;

    noVideoMsg.style.display = "none";
    videoDetails.style.display = "flex";
  } else {
    if (!itemUrlInput.value) {
      showNoVideoDetected();
    }
  }
}

function showNoVideoDetected() {
  currentTabVideoUrl = "";
  currentTabVideoTitle = "";
  noVideoMsg.style.display = "block";
  videoDetails.style.display = "none";
}

function extractVideoId(url) {
  if (!url) return null;
  if (url.includes("shorts/")) {
    return url.split("shorts/")[1].split("?")[0].split("&")[0];
  }
  if (url.includes("v=")) {
    return url.split("v=")[1].split("&")[0];
  }
  if (url.includes("youtu.be/")) {
    return url.split("youtu.be/")[1].split("?")[0];
  }
  if (url.includes("/reel/")) {
    return url.split("/reel/")[1].split("/")[0].split("?")[0].split("&")[0];
  }
  if (url.includes("/p/")) {
    return url.split("/p/")[1].split("/")[0].split("?")[0].split("&")[0];
  }
  return null;
}

// ── Real-time 9:16 Live Preview ──
function triggerLivePreviewLoading(url) {
  livePreviewArea.style.display = "flex";
  previewLoadingBadge.style.display = "inline";
  livePreviewFrame.style.opacity = "0";
  livePreviewFallback.style.opacity = "1";

  // Set fallback YouTube thumbnail
  const videoId = extractVideoId(url);
  if (videoId) {
    livePreviewFallback.src = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
    livePreviewFallback.style.display = "block";
  } else {
    livePreviewFallback.style.display = "none";
  }

  // Load high-quality frame from backend
  const frameUrl = `${API_URL}/api/frame?url=${encodeURIComponent(url)}&v=${Date.now()}`;
  livePreviewFrame.src = frameUrl;
  livePreviewBlurBg.src = frameUrl;
  livePreviewBlurBg.style.display = "block";
  
  updateLivePreview();
}

function updateLivePreview() {
  if (!activeVideoData) return;

  // 1. Overlay
  if (activeVideoData.overlay) {
    livePreviewOverlay.src = `${API_URL}/api/overlay/${activeVideoData.overlay}`;
    livePreviewOverlay.style.display = "block";
  } else {
    livePreviewOverlay.style.display = "none";
    livePreviewOverlay.src = "";
  }

  // 2. Title rendering
  const title = (activeVideoData.title || "").trim();
  if (livePreviewTitle) {
    livePreviewTitle.textContent = title || "Sem título...";
    const titleY = activeVideoData.title_y || 220;
    livePreviewTitle.style.top = `${(titleY / 19.2)}%`;
    
    const corLabel = activeVideoData.cor_titulo || "Branco";
    livePreviewTitle.style.color = CORES_HEX[corLabel] || "#FFFFFF";
    
    const fontLabel = activeVideoData.font || "Padrão";
    const fontFamily = fontLabel === "Manuscrita" ? "Caveat" : fontLabel === "Estilo 1" ? "Times New Roman" : fontLabel === "Estilo 2" ? "Arial" : "sans-serif";
    livePreviewTitle.style.fontFamily = fontFamily;
  }

  // 3. Tarja Rendering
  updateLivePreviewTarjaDOM();
}

function updateLivePreviewTarjaDOM() {
  if (!activeVideoData || !activeVideoData.tarja || !activeVideoData.tarja.ativo || !livePreviewTarja) {
    if (livePreviewTarja) livePreviewTarja.style.display = "none";
    return;
  }

  const t = activeVideoData.tarja;
  livePreviewTarja.style.left = `${(t.x || 0.35) * 100}%`;
  livePreviewTarja.style.top = `${(t.y || 0.45) * 100}%`;
  livePreviewTarja.style.width = `${(t.w || 0.30) * 100}%`;
  livePreviewTarja.style.height = `${(t.h || 0.07) * 100}%`;
  livePreviewTarja.style.display = "flex";

  if (livePreviewTarjaText) {
    livePreviewTarjaText.textContent = t.texto || "";
    // Dynamically scale text size based on container width
    const textW = (t.w || 0.30) * 304;
    livePreviewTarjaText.style.fontSize = `clamp(6px, ${textW / 12}px, 12px)`;
  }
}

function updateLivePreviewPlacement() {
  if (!livePreviewFrame || !livePreviewFrame.naturalWidth || !activeVideoData) return;
  const videoY = activeVideoData.video_y || 0;
  
  const imgW = livePreviewFrame.naturalWidth;
  const imgH = livePreviewFrame.naturalHeight;

  const _W = 1080, _H = 1920, _VSCALE = 0.937, _HSCALE = 1.65;
  const isHorizontal = imgW > imgH;
  let dispW, dispH;
  
  if (!isHorizontal) {
    dispH = _VSCALE * _H;
    dispW = dispH * (imgW / imgH);
  } else {
    dispW = _HSCALE * _W;
    dispH = dispW * (imgH / imgW);
  }
  
  const wPct = (dispW / _W) * 100;
  const hPct = (dispH / _H) * 100;
  const yOff = (videoY / _H) * 100;

  livePreviewFrame.style.position = 'absolute';
  livePreviewFrame.style.left = '50%';
  livePreviewFrame.style.top = `calc(50% + ${yOff}%)`;
  livePreviewFrame.style.width = `${wPct}%`;
  livePreviewFrame.style.height = `${hPct}%`;
  livePreviewFrame.style.transform = 'translate(-50%, -50%)';
}

// ── Helper UI Status ──
let statusTimeout;
function showStatusMessage(text, type = "success") {
  clearTimeout(statusTimeout);
  const originalMsg = connMsg.textContent;
  const originalClass = connDot.className;
  const originalColor = connMsg.style.color;

  connMsg.textContent = text;
  connMsg.style.color = type === "success" ? "var(--green)" : "var(--red)";
  connDot.className = `conn-dot ${type === "success" ? "online" : ""}`;

  statusTimeout = setTimeout(() => {
    connMsg.textContent = originalMsg;
    connMsg.style.color = originalColor;
    connDot.className = originalClass;
  }, 3000);
}

// ── Trim Range Sliders Visuals ──
function updateTrimSliderVisuals() {
  if (!activeVideoData) return;
  const maxVal = parseFloat(trimInicioSlider.max) || 12.0;
  let val1 = parseFloat(trimInicioSlider.value);
  let val2 = parseFloat(trimFimSlider.value);

  // Prevent handles from overlapping
  if (val1 >= val2) {
    val1 = val2 - 0.1;
    trimInicioSlider.value = val1;
  }

  const pct1 = (val1 / maxVal) * 100;
  const pct2 = (val2 / maxVal) * 100;

  trimTrackFill.style.left = `${pct1}%`;
  trimTrackFill.style.width = `${pct2 - pct1}%`;
  trimValDisplay.textContent = `${val1.toFixed(1)}s - ${val2.toFixed(1)}s`;

  activeVideoData.trim_inicio_s = val1;
  activeVideoData.trim_fim_s = val2;
}

// ── Custom Narration Management ──
function renderNarrations() {
  narrationsList.innerHTML = "";
  if (!activeVideoData || !activeVideoData.narrations) return;

  const narrations = activeVideoData.narrations;
  const durationMax = activeVideoData.duration || 60.0;

  if (narrations.length === 0) {
    narrationsList.innerHTML = `<div class="alert-box alert-info" style="font-size: 10.5px; padding: 6px; text-align: center;">Nenhuma narração personalizada adicionada.</div>`;
    return;
  }

  narrations.forEach((n, idx) => {
    const block = document.createElement("div");
    block.className = "narration-block";
    block.setAttribute("data-id", n.id);

    block.innerHTML = `
      <div class="narration-block-header">
        <span class="narration-block-num">Bloco #${idx + 1}</span>
        <button type="button" class="btn-icon-only btn-delete-narration" data-id="${n.id}" title="Remover" style="padding: 2px 4px; font-size: 10px;">🗑️</button>
      </div>
      
      <div class="field" style="margin-top: 2px;">
        <textarea class="narration-text select-field" style="height: 48px; resize: vertical; padding: 6px; font-size: 11px; font-family: sans-serif;" placeholder="Texto para falar...">${n.text || ""}</textarea>
      </div>
      
      <div class="field" style="margin-top: 2px;">
        <div style="display: flex; justify-content: space-between; align-items: center;">
          <span style="font-size: 9px; color: var(--text-muted);">Tempo de Início</span>
          <span class="narration-start-val font-mono" style="font-size: 10px; color: var(--cyan); font-weight: 700;">${(n.start_sec || 0).toFixed(1)}s</span>
        </div>
        <input type="range" class="narration-start-slider slider" min="0" max="${durationMax}" step="0.5" value="${n.start_sec || 0}" />
      </div>
      
      <div style="display: flex; gap: 12px; align-items: center; margin-top: 2px;">
        <label class="checkbox-container" style="font-size: 10px; color: var(--text-muted); cursor: pointer; user-select: none; display: flex; align-items: center; gap: 4px;">
          <input type="checkbox" class="narration-freeze-chk" ${n.freeze ? "checked" : ""} />
          <span>Congelar Vídeo (Freeze)</span>
        </label>
        <label class="checkbox-container" style="font-size: 10px; color: var(--text-muted); cursor: pointer; user-select: none; display: flex; align-items: center; gap: 4px;">
          <input type="checkbox" class="narration-legenda-chk" ${n.legenda ? "checked" : ""} />
          <span>Gerar Legenda</span>
        </label>
      </div>
    `;

    // Bind slider updates in real-time
    const slider = block.querySelector(".narration-start-slider");
    const valDisplay = block.querySelector(".narration-start-val");
    slider.addEventListener("input", (e) => {
      const val = parseFloat(e.target.value);
      valDisplay.textContent = val.toFixed(1) + "s";
      n.start_sec = val;
    });
    slider.addEventListener("change", () => {
      saveVideoPatch({ narrations: activeVideoData.narrations });
    });

    // Textarea changes
    const textarea = block.querySelector(".narration-text");
    textarea.addEventListener("input", (e) => {
      n.text = e.target.value;
    });
    textarea.addEventListener("change", () => {
      saveVideoPatch({ narrations: activeVideoData.narrations });
    });

    // Checkboxes
    const freezeChk = block.querySelector(".narration-freeze-chk");
    freezeChk.addEventListener("change", () => {
      n.freeze = freezeChk.checked;
      saveVideoPatch({ narrations: activeVideoData.narrations });
    });

    const legendaChk = block.querySelector(".narration-legenda-chk");
    legendaChk.addEventListener("change", () => {
      n.legenda = legendaChk.checked;
      saveVideoPatch({ narrations: activeVideoData.narrations });
    });

    // Delete block button
    const deleteBtn = block.querySelector(".btn-delete-narration");
    deleteBtn.addEventListener("click", () => {
      activeVideoData.narrations = activeVideoData.narrations.filter(x => x.id !== n.id);
      renderNarrations();
      saveVideoPatch({ narrations: activeVideoData.narrations });
    });

    narrationsList.appendChild(block);
  });
}

function addNewNarrationBlock() {
  if (!activeVideoData) return;
  if (!activeVideoData.narrations) activeVideoData.narrations = [];

  const narrations = activeVideoData.narrations;
  let nextSec = 0;
  if (narrations.length > 0) {
    const last = narrations[narrations.length - 1];
    const durMax = activeVideoData.duration || 60.0;
    nextSec = Math.min(last.start_sec + 5.0, durMax);
  }

  const newBlock = {
    id: crypto.randomUUID(),
    text: "",
    start_sec: nextSec,
    freeze: false,
    legenda: false
  };

  activeVideoData.narrations.push(newBlock);
  renderNarrations();
  saveVideoPatch({ narrations: activeVideoData.narrations });
}
