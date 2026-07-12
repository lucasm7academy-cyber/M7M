/**
 * MoviePy Ranking Companion — Sidepanel Logic
 */

// ── Configuration State ──
let API_URL = "http://localhost:8090";
let activeRankingId = "";
let activeRankingData = null;
let currentTabVideoUrl = "";
let currentTabVideoTitle = "";
let activePositionEditing = 1; // Default position being edited
let draggedCard = null; // Track currently dragged position card

// ── Constants for UI Preview ──
const CORES_HEX = {
  Branco: '#FFFFFF', Amarelo: '#FFD400', Preto: '#000000',
  Vermelho: '#FF3B30', Verde: '#27E36B', Azul: '#3B82F6', Rosa: '#FF2D95',
};

// ── DOM Elements ──
const connDot = document.getElementById("connDot");
const connMsg = document.getElementById("connMsg");
const toggleSettings = document.getElementById("toggleSettings");
const settingsPanel = document.getElementById("settingsPanel");
const apiUrlInput = document.getElementById("apiUrlInput");
const saveSettingsBtn = document.getElementById("saveSettingsBtn");

const rankingSelect = document.getElementById("rankingSelect");
const refreshRankingsBtn = document.getElementById("refreshRankingsBtn");
const btnCreateTestPreset = document.getElementById("btnCreateTestPreset");
const btnToggleCreateRanking = document.getElementById("btnToggleCreateRanking");
const createRankingPanel = document.getElementById("createRankingPanel");
const newRankingTitle = document.getElementById("newRankingTitle");
const newRankingQty = document.getElementById("newRankingQty");
const newRankingOrder = document.getElementById("newRankingOrder");
const btnSubmitCreateRanking = document.getElementById("btnSubmitCreateRanking");

const selectedRankingConfig = document.getElementById("selectedRankingConfig");
const globalTitleInput = document.getElementById("globalTitleInput");
const globalOverlaySelect = document.getElementById("globalOverlaySelect");
const globalColorSelect = document.getElementById("globalColorSelect");
const globalTitleYInput = document.getElementById("globalTitleYInput");
const globalTitleYVal = document.getElementById("globalTitleYVal");

const activeMediaSection = document.getElementById("activeMediaSection");
const noVideoMsg = document.getElementById("noVideoMsg");
const videoDetails = document.getElementById("videoDetails");
const mediaThumb = document.getElementById("mediaThumb");
const mediaSource = document.getElementById("mediaSource");
const mediaTitleDisplay = document.getElementById("mediaTitleDisplay");

const itemTitleInput = document.getElementById("itemTitleInput");
const itemUrlInput = document.getElementById("itemUrlInput");

// Double Range Slider
const trimInicioSlider = document.getElementById("trimInicioSlider");
const trimFimSlider = document.getElementById("trimFimSlider");
const trimTrackFill = document.getElementById("trimTrackFill");
const trimValDisplay = document.getElementById("trimValDisplay");

// Height Offset & Narration
const videoYInput = document.getElementById("videoYInput");
const videoYVal = document.getElementById("videoYVal");
const narrationInput = document.getElementById("narrationInput");

// Item Editor Section
const itemEditorSection = document.getElementById("itemEditorSection");
const btnCancelEdit = document.getElementById("btnCancelEdit");
const itemEditorTitle = document.getElementById("itemEditorTitle");

// Tarja Configs
const tarjaAtivaCheckbox = document.getElementById("tarjaAtivaCheckbox");
const tarjaFieldsContainer = document.getElementById("tarjaFieldsContainer");
const tarjaTextoInput = document.getElementById("tarjaTextoInput");
const tarjaXInput = document.getElementById("tarjaXInput");
const tarjaYInput = document.getElementById("tarjaYInput");
const tarjaWInput = document.getElementById("tarjaWInput");
const tarjaHInput = document.getElementById("tarjaHInput");

const noRankingSelectedMsg = document.getElementById("noRankingSelectedMsg");
const rankingItemsList = document.getElementById("rankingItemsList");

const rankingActionsSection = document.getElementById("rankingActionsSection");
const driveFolderSelect = document.getElementById("driveFolderSelect");
const btnProcessRanking = document.getElementById("btnProcessRanking");

// Frame Modal Preview (kept for custom items or modal previews if needed, but not on lists)
const previewContainer = document.getElementById("previewContainer");
const previewTitle = document.getElementById("previewTitle");
const closePreviewBtn = document.getElementById("closePreviewBtn");
const previewLoading = document.getElementById("previewLoading");
const previewImg = document.getElementById("previewImg");

// Live 9:16 Preview Box
const livePreviewArea = document.getElementById("livePreviewArea");
const livePreviewFallback = document.getElementById("livePreviewFallback");
const livePreviewFrame = document.getElementById("livePreviewFrame");
const livePreviewOverlay = document.getElementById("livePreviewOverlay");
const livePreviewTitle = document.getElementById("livePreviewTitle");
const livePreviewItemsList = document.getElementById("livePreviewItemsList");
const previewLoadingBadge = document.getElementById("previewLoadingBadge");
const btnOpenTab = document.getElementById("btnOpenTab");

// Live Preview Tarja Overlay
const livePreviewTarja = document.getElementById("livePreviewTarja");
const livePreviewTarjaText = document.getElementById("livePreviewTarjaText");
const livePreviewTarjaResize = document.getElementById("livePreviewTarjaResize");

// ── Initialize ──
document.addEventListener("DOMContentLoaded", () => {
  // Load saved API URL
  chrome.storage.local.get(["apiUrl", "lastRankingId"], (result) => {
    if (result.apiUrl) {
      API_URL = result.apiUrl;
      apiUrlInput.value = API_URL;
    }
    if (result.lastRankingId) {
      activeRankingId = result.lastRankingId;
    }
    checkApiConnection().then((ok) => {
      if (ok) {
        loadOverlays();
        loadRankings();
        loadDriveFolders();
      }
    });
  });

  setupEventListeners();
  updateActiveTabInfo();
});

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
          if (ok) {
            loadOverlays();
            loadRankings();
            loadDriveFolders();
          }
        });
      });
    }
  });

  // Refresh Rankings
  refreshRankingsBtn.addEventListener("click", () => {
    loadRankings();
    loadDriveFolders();
  });

  // Change selected ranking
  rankingSelect.addEventListener("change", (e) => {
    activeRankingId = e.target.value;
    chrome.storage.local.set({ lastRankingId: activeRankingId });
    if (activeRankingId) {
      loadRankingDetails(activeRankingId);
    } else {
      hideRankingDetails();
    }
  });

  // Edit general ranking title in real-time
  globalTitleInput.addEventListener("input", (e) => {
    const val = e.target.value;
    if (activeRankingData) {
      activeRankingData.titulo_geral = val;
      updateLivePreviewItems();
      // Sync the option label inside select dropdown
      const selectedOpt = rankingSelect.options[rankingSelect.selectedIndex];
      if (selectedOpt) {
        selectedOpt.text = `${val || "(Sem título)"} [${activeRankingData.itens.length} itens]`;
      }
    }
  });

  globalTitleInput.addEventListener("change", async (e) => {
    if (!activeRankingId) return;
    const val = e.target.value.trim();
    try {
      const res = await fetch(`${API_URL}/api/ranking/${activeRankingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ titulo_geral: val })
      });
      if (res.ok) {
        showStatusMessage("Título do ranking atualizado!", "success");
      }
    } catch (err) {
      console.error("Erro ao salvar título geral:", err);
      showStatusMessage("Erro ao salvar título", "error");
    }
  });

  // Change global overlay dropdown for the selected ranking
  globalOverlaySelect.addEventListener("change", async (e) => {
    if (!activeRankingId) return;
    const overlayVal = e.target.value || null;
    try {
      const res = await fetch(`${API_URL}/api/ranking/${activeRankingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ overlay: overlayVal })
      });
      if (res.ok) {
        activeRankingData.overlay = overlayVal;
        showStatusMessage("Máscara atualizada!", "success");
        updateLivePreviewOverlay();
      }
    } catch (err) {
      console.error("Erro ao salvar overlay global:", err);
      showStatusMessage("Erro ao salvar overlay", "error");
    }
  });

  // Change global title color select for the selected ranking
  globalColorSelect.addEventListener("change", async (e) => {
    if (!activeRankingId) return;
    const colorVal = e.target.value;
    try {
      const res = await fetch(`${API_URL}/api/ranking/${activeRankingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cor_titulo: colorVal })
      });
      if (res.ok) {
        activeRankingData.cor_titulo = colorVal;
        showStatusMessage("Cor do título atualizada!", "success");
        updateLivePreviewItems();
      }
    } catch (err) {
      console.error("Erro ao salvar cor do título:", err);
      showStatusMessage("Erro ao salvar cor", "error");
    }
  });

  // Sync Height Slider for Global Title
  globalTitleYInput.addEventListener("input", (e) => {
    const val = e.target.value;
    globalTitleYVal.textContent = val + "px";
    if (activeRankingData) {
      activeRankingData.title_y = parseInt(val, 10);
      updateLivePreviewItems();
    }
  });

  globalTitleYInput.addEventListener("change", async (e) => {
    if (!activeRankingId) return;
    const val = parseInt(e.target.value, 10);
    try {
      const res = await fetch(`${API_URL}/api/ranking/${activeRankingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title_y: val })
      });
      if (res.ok) {
        showStatusMessage("Altura do título salva!", "success");
      }
    } catch (err) {
      console.error("Erro ao salvar altura do título:", err);
      showStatusMessage("Erro ao salvar altura", "error");
    }
  });

  // Change active Google Drive destination folder
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
          showStatusMessage("Pasta do Drive atualizada!", "success");
        }
      } catch (err) {
        console.error("Erro ao salvar pasta selecionada do Drive:", err);
        showStatusMessage("Erro ao salvar pasta", "error");
      }
    });
  }

  // Toggle Create Ranking Panel
  btnToggleCreateRanking.addEventListener("click", () => {
    createRankingPanel.classList.toggle("collapsed");
    btnToggleCreateRanking.textContent = createRankingPanel.classList.contains("collapsed") ? "+ Novo" : "Fechar";
  });

  // Create Test Preset Button
  btnCreateTestPreset.addEventListener("click", createTestPresetRanking);

  // Submit Create Ranking
  btnSubmitCreateRanking.addEventListener("click", createNewRanking);

  // Sync double range slider values
  trimInicioSlider.addEventListener("input", updateDoubleSlider);
  trimFimSlider.addEventListener("input", updateDoubleSlider);

  // Sync Height Slider Display & Real-time Live Preview positioning
  videoYInput.addEventListener("input", (e) => {
    const val = e.target.value;
    videoYVal.textContent = val + "px";
    updateLivePreviewPlacement();
  });

  // Real-time update live preview title as user types
  itemTitleInput.addEventListener("input", () => {
    updateLivePreviewItems();
  });

  // Close Editor Button listener
  if (btnCancelEdit) {
    btnCancelEdit.addEventListener("click", () => {
      itemEditorSection.style.display = "none";
      activePositionEditing = null;
      if (activeRankingData) renderRankingItems(activeRankingData);
      livePreviewTarja.style.display = "none";
    });
  }

  // Tarja Field Listeners
  tarjaAtivaCheckbox.addEventListener("change", () => {
    const isChecked = tarjaAtivaCheckbox.checked;
    tarjaFieldsContainer.style.display = isChecked ? "flex" : "none";
    if (activeRankingData && activePositionEditing) {
      const item = activeRankingData.itens.find(it => it.posicao === activePositionEditing);
      if (item) {
        if (!item.tarja) item.tarja = { ativo: false, texto: "", x: 0.35, y: 0.45, w: 0.30, h: 0.07 };
        item.tarja.ativo = isChecked;
        updateLivePreviewTarjaDOM(item);
      }
    }
    saveCurrentItemEditorData();
  });

  tarjaTextoInput.addEventListener("input", (e) => {
    if (activeRankingData && activePositionEditing) {
      const item = activeRankingData.itens.find(it => it.posicao === activePositionEditing);
      if (item && item.tarja) {
        item.tarja.texto = e.target.value;
        updateLivePreviewTarjaDOM(item);
      }
    }
  });
  tarjaTextoInput.addEventListener("change", saveCurrentItemEditorData);

  const onTarjaCoordsChange = () => {
    if (activeRankingData && activePositionEditing) {
      const item = activeRankingData.itens.find(it => it.posicao === activePositionEditing);
      if (item && item.tarja) {
        item.tarja.x = parseFloat(tarjaXInput.value) || 0;
        item.tarja.y = parseFloat(tarjaYInput.value) || 0;
        item.tarja.w = parseFloat(tarjaWInput.value) || 0;
        item.tarja.h = parseFloat(tarjaHInput.value) || 0;
        updateLivePreviewTarjaDOM(item);
      }
    }
    saveCurrentItemEditorData();
  };

  tarjaXInput.addEventListener("change", onTarjaCoordsChange);
  tarjaYInput.addEventListener("change", onTarjaCoordsChange);
  tarjaWInput.addEventListener("change", onTarjaCoordsChange);
  tarjaHInput.addEventListener("change", onTarjaCoordsChange);

  // Auto-save other item editor fields on change
  itemTitleInput.addEventListener("change", saveCurrentItemEditorData);
  itemUrlInput.addEventListener("change", saveCurrentItemEditorData);
  videoYInput.addEventListener("change", saveCurrentItemEditorData);
  narrationInput.addEventListener("change", saveCurrentItemEditorData);

  // Double Range Slider Change Save
  trimInicioSlider.addEventListener("change", saveCurrentItemEditorData);
  trimFimSlider.addEventListener("change", saveCurrentItemEditorData);

  // Mouse interaction with Tarja Box in preview
  livePreviewTarja.addEventListener("mousedown", (e) => {
    startDrag("move", e);
  });
  livePreviewTarjaResize.addEventListener("mousedown", (e) => {
    e.stopPropagation(); // Avoid triggering parent move drag
    startDrag("resize", e);
  });

  // Process ranking
  btnProcessRanking.addEventListener("click", queueAndProcessRanking);

  // Close Frame Preview modal
  closePreviewBtn.addEventListener("click", () => {
    previewContainer.style.display = "none";
    previewImg.style.display = "none";
    previewImg.src = "";
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

  // Refresh frame placement when the live preview image finishes loading
  livePreviewFrame.addEventListener("load", () => {
    previewLoadingBadge.style.display = "none";
    livePreviewFallback.style.opacity = "0";
    livePreviewFrame.style.opacity = "1";
    updateLivePreviewPlacement();
  });
  livePreviewFrame.addEventListener("error", () => {
    previewLoadingBadge.style.display = "none";
    // Keep fallback thumbnail visible
    livePreviewFallback.style.opacity = "1";
    livePreviewFrame.style.opacity = "0";
  });
}

// ── Double Slider Logic ──
function updateDoubleSlider() {
  let valStart = parseFloat(trimInicioSlider.value);
  let valEnd = parseFloat(trimFimSlider.value);
  const maxVal = parseFloat(trimInicioSlider.max) || 180;

  if (valStart >= valEnd) {
    // Keep a minimum 0.5s difference
    trimInicioSlider.value = valEnd - 0.5;
    valStart = valEnd - 0.5;
  }

  const leftPct = (valStart / maxVal) * 100;
  const widthPct = ((valEnd - valStart) / maxVal) * 100;

  trimTrackFill.style.left = `${leftPct}%`;
  trimTrackFill.style.width = `${widthPct}%`;

  trimValDisplay.textContent = `${valStart.toFixed(1)}s — ${valEnd.toFixed(1)}s`;
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

async function loadOverlays() {
  try {
    const ovRes = await fetch(`${API_URL}/api/overlays`);
    if (ovRes.ok) {
      const overlays = await ovRes.json();
      globalOverlaySelect.innerHTML = '<option value="">Nenhum / Padrão</option>';
      overlays.forEach((o) => {
        globalOverlaySelect.innerHTML += `<option value="${o.id}">Overlay ${o.id}</option>`;
      });
      // Sync overlay selection if ranking details is already loaded
      if (activeRankingData) {
        globalOverlaySelect.value = activeRankingData.overlay || "";
      }
    }
  } catch (e) {
    console.error("Erro ao carregar overlays:", e);
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

async function loadRankings() {
  try {
    const res = await fetch(`${API_URL}/api/ranking`);
    if (!res.ok) throw new Error("Falha ao buscar rankings");
    const rankings = await res.json();

    rankingSelect.innerHTML = '<option value="">-- Escolha um Ranking --</option>';
    if (rankings.length === 0) {
      rankingSelect.innerHTML = '<option value="">Nenhum ranking criado</option>';
      hideRankingDetails();
      return;
    }

    rankings.forEach((r) => {
      const isSelected = r.id === activeRankingId ? "selected" : "";
      rankingSelect.innerHTML += `<option value="${r.id}" ${isSelected}>${r.titulo_geral || "(Sem título)"} [${r.itens.length} itens]</option>`;
    });

    if (activeRankingId && rankings.some(r => r.id === activeRankingId)) {
      loadRankingDetails(activeRankingId);
    } else {
      rankingSelect.value = "";
      hideRankingDetails();
    }
  } catch (e) {
    console.error(e);
    rankingSelect.innerHTML = '<option value="">Erro ao conectar</option>';
    hideRankingDetails();
  }
}

async function loadRankingDetails(rid) {
  try {
    const res = await fetch(`${API_URL}/api/ranking/${rid}`);
    if (!res.ok) throw new Error("Erro ao ler ranking");
    const ranking = await res.json();
    activeRankingData = ranking;

    noRankingSelectedMsg.style.display = "none";
    rankingItemsList.style.display = "flex";
    rankingActionsSection.style.display = "block";
    selectedRankingConfig.style.display = "block";

    globalTitleInput.value = ranking.titulo_geral || "";
    globalOverlaySelect.value = ranking.overlay || "";
    globalColorSelect.value = ranking.cor_titulo || "Branco";
    globalTitleYInput.value = ranking.title_y || 220;
    globalTitleYVal.textContent = (ranking.title_y || 220) + "px";

    renderRankingItems(ranking);
    updateLivePreviewOverlay();
    updateLivePreviewItems();
  } catch (e) {
    console.error(e);
    showStatusMessage("Erro ao carregar itens do ranking", "error");
  }
}

function hideRankingDetails() {
  noRankingSelectedMsg.style.display = "block";
  rankingItemsList.style.display = "none";
  rankingActionsSection.style.display = "none";
  selectedRankingConfig.style.display = "none";
  activeRankingData = null;
  livePreviewArea.style.display = "none";
}

function renderRankingItems(ranking) {
  rankingItemsList.innerHTML = "";
  if (!ranking.itens || ranking.itens.length === 0) {
    rankingItemsList.innerHTML = '<div class="alert-box alert-info">Nenhuma posição encontrada.</div>';
    return;
  }

  const sortedItens = [...ranking.itens].sort((a, b) => a.posicao - b.posicao);

  sortedItens.forEach((item) => {
    const hasLink = !!item.link;
    const isTopItem = item.posicao === 1;

    let metaHtml = "";
    if (hasLink) {
      metaHtml = `
        <span class="position-meta-item">⏱️ ${item.trim_inicio_s.toFixed(1)}s - ${item.trim_fim_s.toFixed(1)}s</span>
        <span class="position-meta-item">↕️ ${item.video_y}px</span>
      `;
    } else {
      metaHtml = `<span class="position-meta-item">Nenhum vídeo atribuído</span>`;
    }

    const card = document.createElement("div");
    card.className = "position-card";
    card.draggable = true;
    card.setAttribute("data-old-pos", item.posicao);
    card.setAttribute("data-pos", item.posicao);

    if (item.posicao === activePositionEditing) {
      card.style.borderColor = "var(--cyan)";
      card.style.background = "var(--cyan-soft)";
    }

    card.innerHTML = `
      <div class="position-badge ${isTopItem ? "pos-top" : ""}">${item.posicao}</div>
      <div class="position-info">
        <div class="position-title ${!hasLink ? "empty" : ""}">
          ${hasLink ? (item.titulo_item || "Vídeo " + item.posicao) : "Vazio / Clique para atribuir o vídeo da aba"}
        </div>
        <div class="position-meta">${metaHtml}</div>
      </div>
      ${hasLink ? `<button class="btn-substitute" data-pos="${item.posicao}">Substituir</button>` : ""}
    `;

    // Drag and Drop Event Listeners
    card.addEventListener("dragstart", (e) => {
      draggedCard = card;
      card.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
    });

    card.addEventListener("dragover", (e) => {
      e.preventDefault();
      if (draggedCard !== card) {
        card.classList.add("drag-over");
      }
    });

    card.addEventListener("dragleave", () => {
      card.classList.remove("drag-over");
    });

    card.addEventListener("dragend", () => {
      card.classList.remove("dragging");
      rankingItemsList.querySelectorAll(".position-card").forEach(c => c.classList.remove("drag-over"));
    });

    card.addEventListener("drop", async (e) => {
      e.preventDefault();
      card.classList.remove("drag-over");

      if (draggedCard && draggedCard !== card) {
        const parent = card.parentNode;
        const cards = Array.from(parent.querySelectorAll(".position-card"));
        const draggedIndex = cards.indexOf(draggedCard);
        const targetIndex = cards.indexOf(card);

        if (draggedIndex < targetIndex) {
          parent.insertBefore(draggedCard, card.nextSibling);
        } else {
          parent.insertBefore(draggedCard, card);
        }

        // Get the new order of positions based on DOM children sequence
        const updatedCards = Array.from(parent.querySelectorAll(".position-card"));
        const newOrder = updatedCards.map(c => parseInt(c.getAttribute("data-old-pos"), 10));

        // Submit PATCH /api/ranking/{rid}/reorder to save layout reorder
        updateStatus("Reordenando...", "checking");
        try {
          const res = await fetch(`${API_URL}/api/ranking/${activeRankingId}/reorder`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ order: newOrder })
          });
          if (res.ok) {
            showStatusMessage("Ordem atualizada!", "success");
            // Reload the details to sync list and live preview instantly
            await loadRankingDetails(activeRankingId);
          } else {
            throw new Error("Erro na reordenação");
          }
        } catch (err) {
          console.error("Erro ao reordenar ranking:", err);
          showStatusMessage("Erro ao reordenar", "error");
          checkApiConnection();
        }
      }
    });

    // Make the entire card clickable to trigger edit/load or auto-include
    card.addEventListener("click", async () => {
      activePositionEditing = item.posicao;
      
      if (!hasLink) {
        if (currentTabVideoUrl) {
          // If the card is empty, click to assign the current tab's video
          await autoAssignTabVideoToPosition(item.posicao, currentTabVideoUrl, currentTabVideoTitle);
        } else {
          showStatusMessage("Nenhum vídeo detectado na aba ativa para atribuir!", "error");
        }
      } else {
        // If the card already has a video, click to ONLY open configurations for conference
        populateFormWithItem(item);
      }
    });

    // Add event listener to the substitute button
    if (hasLink) {
      const btnSub = card.querySelector(".btn-substitute");
      if (btnSub) {
        btnSub.addEventListener("click", async (e) => {
          e.stopPropagation(); // Prevent triggering the card's click event
          
          activePositionEditing = item.posicao;
          if (currentTabVideoUrl) {
            await autoAssignTabVideoToPosition(item.posicao, currentTabVideoUrl, currentTabVideoTitle);
          } else {
            showStatusMessage("Nenhum vídeo detectado na aba ativa para atribuir!", "error");
          }
        });
      }
    }

    rankingItemsList.appendChild(card);
  });
}

async function createNewRanking() {
  const title = newRankingTitle.value.trim();
  const qty = parseInt(newRankingQty.value, 10);
  const order = newRankingOrder.value;

  if (!title) {
    showStatusMessage("Insira um título para o ranking!", "error");
    return;
  }

  try {
    const res = await fetch(`${API_URL}/api/ranking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titulo_geral: title,
        quantidade: qty,
        ordem: order
      })
    });

    if (!res.ok) throw new Error("Erro HTTP");
    const newRanking = await res.json();
    
    newRankingTitle.value = "";
    createRankingPanel.classList.add("collapsed");
    btnToggleCreateRanking.textContent = "+ Novo";

    activeRankingId = newRanking.id;
    chrome.storage.local.set({ lastRankingId: activeRankingId });
    showStatusMessage("Ranking criado com sucesso!", "success");
    
    await loadRankings();
  } catch (e) {
    console.error(e);
    showStatusMessage("Falha ao criar o ranking", "error");
  }
}

async function createTestPresetRanking() {
  updateStatus("Criando preset de teste...", "checking");
  try {
    const res = await fetch(`${API_URL}/api/ranking`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        titulo_geral: "Ranking de Teste 🏆",
        quantidade: 3,
        ordem: "decrescente"
      })
    });

    if (!res.ok) throw new Error("Erro ao criar ranking");
    const newRanking = await res.json();
    const rankingId = newRanking.id;

    const testVideoUrl = "https://www.youtube.com/watch?v=h4NzUoUVi38";
    const presetItems = [
      {
        posicao: 3,
        titulo_item: "Item de Teste 3",
        trim_inicio_s: 0.0,
        trim_fim_s: 5.0,
        video_y: 150,
        narracao_texto: "Este é o item número três do nosso teste",
        transicao_tipo: "fade_preto",
        transicao_sfx: "whoosh"
      },
      {
        posicao: 2,
        titulo_item: "Item de Teste 2",
        trim_inicio_s: 5.0,
        trim_fim_s: 10.0,
        video_y: 150,
        narracao_texto: "Seguindo em frente, aqui está o item número dois",
        transicao_tipo: "slide_up",
        transicao_sfx: "camera"
      },
      {
        posicao: 1,
        titulo_item: "Item de Teste 1",
        trim_inicio_s: 10.0,
        trim_fim_s: 15.0,
        video_y: 150,
        narracao_texto: "E por fim, o grande vencedor do nosso teste",
        transicao_tipo: "slide_left",
        transicao_sfx: "click"
      }
    ];

    for (const item of presetItems) {
      const itemRes = await fetch(`${API_URL}/api/ranking/${rankingId}/items/${item.posicao}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          link: testVideoUrl,
          titulo_item: item.titulo_item,
          trim_inicio_s: item.trim_inicio_s,
          trim_fim_s: item.trim_fim_s,
          video_y: item.video_y,
          narracao_texto: item.narracao_texto,
          transicao_tipo: item.transicao_tipo,
          transicao_sfx: item.transicao_sfx,
          tarja: {
            ativo: true,
            texto: item.titulo_item,
            x: 0.35,
            y: 0.45,
            w: 0.30,
            h: 0.07
          }
        })
      });
      if (!itemRes.ok) throw new Error(`Erro ao salvar item ${item.posicao}`);
    }

    activeRankingId = rankingId;
    chrome.storage.local.set({ lastRankingId: activeRankingId });
    showStatusMessage("Preset de teste criado!", "success");
    await loadRankings();
  } catch (e) {
    console.error(e);
    showStatusMessage("Falha ao criar o preset", "error");
  }
}

async function autoAssignTabVideoToPosition(posicao, url, title) {
  if (!activeRankingId) {
    showStatusMessage("Selecione um ranking primeiro!", "error");
    return;
  }

  updateStatus("Salvando item...", "checking");

  try {
    const existingItem = activeRankingData && activeRankingData.itens ? activeRankingData.itens.find(it => it.posicao === posicao) : null;
    const sameVideo = existingItem && existingItem.link === url;
    
    const trimInicio = sameVideo ? (existingItem.trim_inicio_s !== undefined ? existingItem.trim_inicio_s : 0.0) : 0.0;
    const trimFim = sameVideo ? (existingItem.trim_fim_s !== undefined ? existingItem.trim_fim_s : 10.0) : 10.0;
    const videoY = sameVideo ? (existingItem.video_y !== undefined ? existingItem.video_y : 150) : 150;
    const narration = sameVideo ? (existingItem.narracao_texto || "") : "";
    const transicaoSfx = sameVideo ? (existingItem.transicao_sfx || "default") : "default";
    const transicaoTipo = sameVideo ? (existingItem.transicao_tipo || "fade_preto") : "fade_preto";
    const tarja = sameVideo ? (existingItem.tarja || null) : null;

    const res = await fetch(`${API_URL}/api/ranking/${activeRankingId}/items/${posicao}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        link: url,
        titulo_item: sameVideo ? (existingItem.titulo_item || "") : "",
        trim_inicio_s: trimInicio,
        trim_fim_s: trimFim,
        video_y: videoY,
        narracao_texto: narration,
        transicao_sfx: transicaoSfx,
        transicao_tipo: transicaoTipo,
        tarja: tarja
      })
    });

    if (!res.ok) throw new Error("Falha ao atualizar");
    
    showStatusMessage(`Posição ${posicao} atualizada!`, "success");
    await checkApiConnection();
    await loadRankingDetails(activeRankingId);

    // After updating, immediately load this item's details into the editor form!
    if (activeRankingData && activeRankingData.itens) {
      const updatedItem = activeRankingData.itens.find(it => it.posicao === posicao);
      if (updatedItem) {
        populateFormWithItem(updatedItem);
      }
    }
  } catch (e) {
    console.error(e);
    showStatusMessage(`Erro ao atualizar posição ${posicao}`, "error");
    checkApiConnection();
  }
}

async function applyCurrentVideoToPosition(posicao) {
  if (!activeRankingId) {
    showStatusMessage("Selecione um ranking primeiro!", "error");
    return;
  }

  const url = itemUrlInput.value.trim();
  const title = itemTitleInput.value.trim();
  const trimInicio = parseFloat(trimInicioSlider.value) || 0;
  const trimFim = parseFloat(trimFimSlider.value) || 10;
  const videoY = parseInt(videoYInput.value, 10) || 0;
  const narration = narrationInput.value.trim() || null;

  if (!url) {
    showStatusMessage("Nenhum vídeo capturado da aba!", "error");
    return;
  }

  updateStatus("Salvando item...", "checking");

  try {
    const res = await fetch(`${API_URL}/api/ranking/${activeRankingId}/items/${posicao}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        link: url,
        titulo_item: title,
        trim_inicio_s: trimInicio,
        trim_fim_s: trimFim,
        video_y: videoY,
        narracao_texto: narration
      })
    });

    if (!res.ok) throw new Error("Falha ao atualizar");
    
    showStatusMessage(`Posição ${posicao} atualizada!`, "success");
    await checkApiConnection();
    await loadRankingDetails(activeRankingId);
  } catch (e) {
    console.error(e);
    showStatusMessage(`Erro ao atualizar posição ${posicao}`, "error");
    checkApiConnection();
  }
}

function populateFormWithItem(item) {
  itemTitleInput.value = item.titulo_item || "";
  itemUrlInput.value = item.link || "";
  
  // Set slider boundaries
  const maxDuration = item.duracao_original_s || 180;
  trimInicioSlider.max = maxDuration;
  trimFimSlider.max = maxDuration;

  trimInicioSlider.value = item.trim_inicio_s !== undefined ? item.trim_inicio_s : 0.0;
  trimFimSlider.value = item.trim_fim_s !== undefined ? item.trim_fim_s : 10.0;
  updateDoubleSlider();

  videoYInput.value = item.video_y || 0;
  videoYVal.textContent = (item.video_y || 0) + "px";
  
  narrationInput.value = item.narracao_texto || "";
  
  // Show editor panel and configure title
  itemEditorSection.style.display = "block";
  itemEditorTitle.textContent = `📝 Editar Posição #${item.posicao}`;

  // Tarja Configs Prefill
  const hasTarja = !!item.tarja?.ativo;
  tarjaAtivaCheckbox.checked = hasTarja;
  tarjaFieldsContainer.style.display = hasTarja ? "flex" : "none";
  tarjaTextoInput.value = item.tarja?.texto || "";
  tarjaXInput.value = item.tarja?.x !== undefined ? item.tarja.x.toFixed(2) : "0.35";
  tarjaYInput.value = item.tarja?.y !== undefined ? item.tarja.y.toFixed(2) : "0.45";
  tarjaWInput.value = item.tarja?.w !== undefined ? item.tarja.w.toFixed(2) : "0.30";
  tarjaHInput.value = item.tarja?.h !== undefined ? item.tarja.h.toFixed(2) : "0.07";
  updateLivePreviewTarjaDOM(item);

  // Render video preview in real time
  triggerLivePreviewLoading(item.link, item.titulo_item);

  // Refresh items list view to highlight active editing item
  if (activeRankingData) {
    renderRankingItems(activeRankingData);
    updateLivePreviewItems();
  }

  showStatusMessage("Dados carregados no formulário!", "success");
}

async function queueAndProcessRanking() {
  if (!activeRankingId) return;

  try {
    updateStatus("Enfileirando...", "checking");
    
    const queueRes = await fetch(`${API_URL}/api/ranking/${activeRankingId}/queue`, { method: "POST" });
    if (!queueRes.ok) throw new Error("Erro ao enfileirar");

    const procRes = await fetch(`${API_URL}/api/ranking/process`, { method: "POST" });
    if (!procRes.ok) throw new Error("Erro ao iniciar processador");

    showStatusMessage("Ranking enfileirado! Renderização iniciada.", "success");
    await checkApiConnection();
    await loadRankingDetails(activeRankingId);
  } catch (e) {
    console.error(e);
    showStatusMessage("Erro ao processar ranking", "error");
    checkApiConnection();
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
    
    // Keep item title field empty by default so user types it
    itemTitleInput.value = "";

    // Reset range sliders to defaults first
    trimInicioSlider.max = 180;
    trimFimSlider.max = 180;
    trimInicioSlider.value = 0;
    trimFimSlider.value = 180;
    updateDoubleSlider();

    // Check if we can extract duration from the active tab directly
    let durationExtracted = false;
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const video = document.querySelector("video");
          return video ? { duration: video.duration } : null;
        }
      });
      if (results && results[0] && results[0].result) {
        const data = results[0].result;
        if (data.duration && data.duration > 0) {
          trimInicioSlider.max = data.duration;
          trimFimSlider.max = data.duration;
          trimInicioSlider.value = 0;
          trimFimSlider.value = data.duration;
          updateDoubleSlider();
          durationExtracted = true;
        }
      }
    } catch (e) {
      console.warn("Could not query tab details directly:", e);
    }

    // Fallback: If duration wasn't extracted from the tab, query the API
    if (!durationExtracted) {
      fetchVideoDurationAndSetupSlider(url);
    }

    videoYInput.value = 0;
    videoYVal.textContent = "0px";

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

    // Load live preview
    triggerLivePreviewLoading(url, "");
  } else {
    if (!itemUrlInput.value) {
      showNoVideoDetected();
    }
  }
}

async function fetchVideoDurationAndSetupSlider(url) {
  try {
    const res = await fetch(`${API_URL}/api/ranking/items/duracao`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ link: url })
    });
    if (res.ok) {
      const data = await res.json();
      if (data.duracao && data.duracao > 0) {
        trimInicioSlider.max = data.duracao;
        trimFimSlider.max = data.duracao;
        trimInicioSlider.value = 0;
        trimFimSlider.value = data.duracao;
        updateDoubleSlider();
      }
    }
  } catch (e) {
    console.error("Erro ao obter duração do vídeo da API:", e);
  }
}

function showNoVideoDetected() {
  currentTabVideoUrl = "";
  currentTabVideoTitle = "";
  noVideoMsg.style.display = "block";
  videoDetails.style.display = "none";
  livePreviewArea.style.display = "none";
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
function triggerLivePreviewLoading(url, title) {
  if (!activeRankingId) return;

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
  livePreviewFrame.src = `${API_URL}/api/frame?url=${encodeURIComponent(url)}&v=${Date.now()}`;
  
  updateLivePreviewOverlay();
  updateLivePreviewItems();
}

function updateLivePreviewOverlay() {
  if (!activeRankingData) return;
  if (activeRankingData.overlay) {
    livePreviewOverlay.src = `${API_URL}/api/overlay/${activeRankingData.overlay}`;
    livePreviewOverlay.style.display = "block";
  } else {
    livePreviewOverlay.style.display = "none";
    livePreviewOverlay.src = "";
  }
}

function updateLivePreviewItems() {
  if (!livePreviewItemsList) return;
  livePreviewItemsList.innerHTML = "";
  
  if (!activeRankingData) return;

  // Title rendering
  const title = (activeRankingData.titulo_geral || "").trim();
  if (livePreviewTitle) {
    livePreviewTitle.textContent = title || "Digite um título...";
    const titleY = activeRankingData.title_y || 220;
    livePreviewTitle.style.top = `${(titleY / 19.2)}%`;
    
    const corLabel = activeRankingData.cor_titulo || "Branco";
    livePreviewTitle.style.color = CORES_HEX[corLabel] || "#FFFFFF";
    
    const fontLabel = activeRankingData.font || "Padrão";
    const fontFamily = fontLabel === "Manuscrita" ? "Caveat" : fontLabel === "Estilo 1" ? "Times New Roman" : fontLabel === "Estilo 2" ? "Arial" : "sans-serif";
    livePreviewTitle.style.fontFamily = fontFamily;
  }

  // Items positioning
  const itensY = activeRankingData.itens_y || 538;
  livePreviewItemsList.style.top = `${(itensY / 19.2)}%`;

  // Sort and render items
  const isDesc = activeRankingData.ordem !== "crescente";
  const sorted = [...activeRankingData.itens].sort((a, b) => isDesc ? b.posicao - a.posicao : a.posicao - b.posicao);

  sorted.forEach((it) => {
    const isActive = it.posicao === activePositionEditing;
    let displayTitle = it.titulo_item || `Item ${it.posicao}`;
    
    if (isActive) {
      displayTitle = itemTitleInput.value.trim() || displayTitle;
    }

    const itemDiv = document.createElement("div");
    itemDiv.className = "live-preview-item";
    itemDiv.innerHTML = `
      <span class="live-preview-item-num">${it.posicao}º</span>
      <span class="live-preview-item-text ${isActive ? "active" : ""}">${displayTitle}</span>
    `;
    livePreviewItemsList.appendChild(itemDiv);
  });
}

function updateLivePreviewPlacement() {
  if (!livePreviewFrame || !livePreviewFrame.naturalWidth) return;
  const videoY = parseInt(videoYInput.value, 10) || 0;
  
  const imgW = livePreviewFrame.naturalWidth;
  const imgH = livePreviewFrame.naturalHeight;

  const _W = 1080, _H = 1920, _VSCALE = 0.937;
  const isHorizontal = imgW > imgH;
  let dispW, dispH;
  
  if (!isHorizontal) {
    dispH = _VSCALE * _H;
    dispW = dispH * (imgW / imgH);
  } else {
    dispW = _VSCALE * _W;
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

// ── Interactive Preview Tarja Math & Saving ──
async function saveCurrentItemEditorData() {
  if (!activeRankingId || !activePositionEditing) return;

  const url = itemUrlInput.value.trim();
  const title = itemTitleInput.value.trim();
  const trimInicio = parseFloat(trimInicioSlider.value) || 0;
  const trimFim = parseFloat(trimFimSlider.value) || 10;
  const videoY = parseInt(videoYInput.value, 10) || 0;
  const narration = narrationInput.value.trim() || null;
  const tarjaAtiva = tarjaAtivaCheckbox.checked;
  const tarjaTexto = tarjaTextoInput.value.trim();
  const tarjaX = parseFloat(tarjaXInput.value) || 0.35;
  const tarjaY = parseFloat(tarjaYInput.value) || 0.45;
  const tarjaW = parseFloat(tarjaWInput.value) || 0.30;
  const tarjaH = parseFloat(tarjaHInput.value) || 0.07;

  try {
    const res = await fetch(`${API_URL}/api/ranking/${activeRankingId}/items/${activePositionEditing}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        link: url,
        titulo_item: title,
        trim_inicio_s: trimInicio,
        trim_fim_s: trimFim,
        video_y: videoY,
        narracao_texto: narration,
        tarja: {
          ativo: tarjaAtiva,
          texto: tarjaTexto,
          x: tarjaX,
          y: tarjaY,
          w: tarjaW,
          h: tarjaH
        }
      })
    });
    if (res.ok) {
      // Update local cache
      if (activeRankingData) {
        const item = activeRankingData.itens.find(it => it.posicao === activePositionEditing);
        if (item) {
          item.titulo_item = title;
          item.link = url;
          item.trim_inicio_s = trimInicio;
          item.trim_fim_s = trimFim;
          item.video_y = videoY;
          item.narracao_texto = narration;
          item.tarja = {
            ativo: tarjaAtiva,
            texto: tarjaTexto,
            x: tarjaX,
            y: tarjaY,
            w: tarjaW,
            h: tarjaH
          };
        }
      }
      // Update list view text
      const cardTitle = document.querySelector(`.position-card[data-pos="${activePositionEditing}"] .position-title`);
      if (cardTitle) cardTitle.textContent = title || "Sem título";
      
      updateLivePreviewItems();
    }
  } catch (err) {
    console.error("Erro ao salvar dados do formulário:", err);
  }
}

function updateLivePreviewTarjaDOM(item) {
  if (!item || !item.tarja || !item.tarja.ativo) {
    livePreviewTarja.style.display = "none";
    return;
  }
  const t = item.tarja;
  livePreviewTarja.style.display = "flex";
  livePreviewTarja.style.left = `${t.x * 100}%`;
  livePreviewTarja.style.top = `${t.y * 100}%`;
  livePreviewTarja.style.width = `${t.w * 100}%`;
  livePreviewTarja.style.height = `${t.h * 100}%`;
  livePreviewTarjaText.textContent = t.texto || "";
}

let dragMode = null; // 'move' or 'resize'
let dragStartX = 0, dragStartY = 0;
let dragOrigX = 0, dragOrigY = 0, dragOrigW = 0, dragOrigH = 0;

function startDrag(mode, e) {
  if (!activeRankingData || !activePositionEditing) return;
  const item = activeRankingData.itens.find(it => it.posicao === activePositionEditing);
  if (!item) return;

  dragMode = mode;
  dragStartX = e.clientX;
  dragStartY = e.clientY;

  const t = item.tarja || { x: 0.35, y: 0.45, w: 0.30, h: 0.07 };
  dragOrigX = t.x;
  dragOrigY = t.y;
  dragOrigW = t.w;
  dragOrigH = t.h;

  document.addEventListener("mousemove", onDragMove);
  document.addEventListener("mouseup", onDragUp);
  e.preventDefault();
}

function onDragMove(e) {
  if (!dragMode || !activeRankingData || !activePositionEditing) return;
  const item = activeRankingData.itens.find(it => it.posicao === activePositionEditing);
  if (!item) return;

  const rect = livePreviewContainer.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const dx = (e.clientX - dragStartX) / rect.width;
  const dy = (e.clientY - dragStartY) / rect.height;

  if (!item.tarja) item.tarja = { ativo: true, texto: "", x: 0.35, y: 0.45, w: 0.30, h: 0.07 };

  if (dragMode === "move") {
    item.tarja.x = Math.max(0, Math.min(1 - item.tarja.w, dragOrigX + dx));
    item.tarja.y = Math.max(0, Math.min(1 - item.tarja.h, dragOrigY + dy));
  } else if (dragMode === "resize") {
    item.tarja.w = Math.max(0.05, Math.min(1 - item.tarja.x, dragOrigW + dx));
    item.tarja.h = Math.max(0.02, Math.min(1 - item.tarja.y, dragOrigH + dy));
  }

  // Sync numeric inputs
  tarjaXInput.value = item.tarja.x.toFixed(2);
  tarjaYInput.value = item.tarja.y.toFixed(2);
  tarjaWInput.value = item.tarja.w.toFixed(2);
  tarjaHInput.value = item.tarja.h.toFixed(2);

  updateLivePreviewTarjaDOM(item);
}

function onDragUp() {
  document.removeEventListener("mousemove", onDragMove);
  document.removeEventListener("mouseup", onDragUp);
  dragMode = null;
  saveCurrentItemEditorData();
}
