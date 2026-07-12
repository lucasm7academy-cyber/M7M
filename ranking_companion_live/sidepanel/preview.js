/**
 * MoviePy Floating Preview — Logic
 */

let API_URL = "http://localhost:8090";
let activeRankingData = null;
let currentUrl = "";
let currentVideoY = 0;

const CORES_HEX = {
  Branco: '#FFFFFF', Amarelo: '#FFD400', Preto: '#000000',
  Vermelho: '#FF3B30', Verde: '#27E36B', Azul: '#3B82F6', Rosa: '#FF2D95',
};

const livePreviewFallback = document.getElementById("livePreviewFallback");
const livePreviewFrame = document.getElementById("livePreviewFrame");
const livePreviewOverlay = document.getElementById("livePreviewOverlay");
const livePreviewTitle = document.getElementById("livePreviewTitle");
const livePreviewItemsList = document.getElementById("livePreviewItemsList");

// Setup event listeners for image load
livePreviewFrame.addEventListener("load", () => {
  livePreviewFallback.style.opacity = "0";
  livePreviewFrame.style.opacity = "1";
  updateLivePreviewPlacement();
});

livePreviewFrame.addEventListener("error", () => {
  livePreviewFallback.style.opacity = "1";
  livePreviewFrame.style.opacity = "0";
});

// Listener for preview updates from the side panel
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "UPDATE_PREVIEW") {
    const data = message.data;
    API_URL = data.apiUrl || API_URL;
    activeRankingData = data.rankingData;
    currentVideoY = parseInt(data.videoY, 10) || 0;

    // 1. Update Title Overlay
    if (livePreviewTitle && activeRankingData) {
      const title = (activeRankingData.titulo_geral || "").trim();
      livePreviewTitle.textContent = title || "Digite um título...";
      const titleY = activeRankingData.title_y || 220;
      livePreviewTitle.style.top = `${(titleY / 19.2)}%`;
      
      const corLabel = activeRankingData.cor_titulo || "Branco";
      livePreviewTitle.style.color = CORES_HEX[corLabel] || "#FFFFFF";
      
      const fontLabel = activeRankingData.font || "Padrão";
      const fontFamily = fontLabel === "Manuscrita" ? "Caveat" : fontLabel === "Estilo 1" ? "Times New Roman" : fontLabel === "Estilo 2" ? "Arial" : "sans-serif";
      livePreviewTitle.style.fontFamily = fontFamily;
    }

    // 2. Update Overlay Mask
    if (livePreviewOverlay) {
      if (activeRankingData && activeRankingData.overlay) {
        livePreviewOverlay.src = `${API_URL}/api/overlay/${activeRankingData.overlay}`;
        livePreviewOverlay.style.display = "block";
      } else {
        livePreviewOverlay.style.display = "none";
        livePreviewOverlay.src = "";
      }
    }

    // 3. Update items vertical list
    updateItemsList(data.activePos, data.itemTitle);

    // 4. Update Video Frame
    if (data.url && data.url !== currentUrl) {
      currentUrl = data.url;
      livePreviewFrame.style.opacity = "0";
      livePreviewFallback.style.opacity = "1";

      const videoId = extractVideoId(data.url);
      if (videoId) {
        livePreviewFallback.src = `https://img.youtube.com/vi/${videoId}/mqdefault.jpg`;
        livePreviewFallback.style.display = "block";
      } else {
        livePreviewFallback.style.display = "none";
      }

      livePreviewFrame.src = `${API_URL}/api/frame?url=${encodeURIComponent(data.url)}&v=${Date.now()}`;
    } else {
      updateLivePreviewPlacement();
    }
  }
});

function updateItemsList(activePos, activeTitle) {
  if (!livePreviewItemsList || !activeRankingData) return;
  livePreviewItemsList.innerHTML = "";

  const itensY = 710;
  livePreviewItemsList.style.top = `${(itensY / 19.2)}%`;

  const isDesc = activeRankingData.ordem !== "crescente";
  const sorted = [...activeRankingData.itens].sort((a, b) => isDesc ? b.posicao - a.posicao : a.posicao - b.posicao);

  const esquema = activeRankingData.esquema_cores || "roxo_verde";
  const colorMap = {
    roxo_verde: { past: '#8B5CF6', current: '#00FF66' },
    azul_amarelo: { past: '#3B82F6', current: '#FFD400' },
    cinza_ciano: { past: '#A1A1AA', current: '#00BDFF' },
    rosa_roxo: { past: '#FF2D95', current: '#8B5CF6' },
    amarelo_verde: { past: '#FFD400', current: '#00FF66' }
  };
  const colors = colorMap[esquema] || colorMap.roxo_verde;

  sorted.forEach((it) => {
    const isActive = it.posicao === activePos;
    let displayTitle = it.titulo_item || `Item ${it.posicao}`;
    
    if (isActive) {
      displayTitle = activeTitle.trim() || displayTitle;
    }

    const itemDiv = document.createElement("div");
    itemDiv.className = "live-preview-item";
    
    const textColor = isActive ? colors.current : colors.past;

    itemDiv.innerHTML = `
      <span class="live-preview-item-num">${it.posicao}º</span>
      <span class="live-preview-item-text" style="color: ${textColor} !important;">${displayTitle}</span>
    `;
    livePreviewItemsList.appendChild(itemDiv);
  });
}

function updateLivePreviewPlacement() {
  if (!livePreviewFrame || !livePreviewFrame.naturalWidth) return;
  
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
  const yOff = (currentVideoY / _H) * 100;

  livePreviewFrame.style.position = 'absolute';
  livePreviewFrame.style.left = '50%';
  livePreviewFrame.style.top = `calc(50% + ${yOff}%)`;
  livePreviewFrame.style.width = `${wPct}%`;
  livePreviewFrame.style.height = `${hPct}%`;
  livePreviewFrame.style.transform = 'translate(-50%, -50%)';
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
