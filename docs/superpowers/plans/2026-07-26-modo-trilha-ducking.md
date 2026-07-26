# Modo de trilha `ducking` — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Adicionar um terceiro modo de trilha sonora onde a música fica em ~50% no silêncio e recua sozinha para ~12% quando há voz no clipe fonte.

**Architecture:** A construção do grafo de filtro da trilha é extraída de `_adicionar_trilha_fundo` para uma função pura `_filtro_trilha(modo) -> str`, testável sem ffmpeg. O modo novo usa `sidechaincompress` com o áudio do clipe (filtrado na banda vocal) como gatilho. Os parâmetros ficam em `config.py`, seguindo o padrão já usado por `NARRATION_DUCK_VOLUME` e `RANKING_TARGET_LUFS`.

**Tech Stack:** Python 3.10 (venv em `backend/venv`), ffmpeg em `C:\Users\78787\Documents\ffmpeg\bin`, React + TypeScript + Tailwind no frontend, extensão Chrome em JS puro.

## Global Constraints

- Spec de referência: `docs/superpowers/specs/2026-07-26-modo-trilha-ducking-design.md`
- O padrão continua `50_50`. O modo novo é **opt-in**; nenhum default muda.
- Comportamento de `50_50` e `100_musica` deve permanecer **byte-idêntico** no grafo de filtro gerado.
- Valor do modo novo: a string exata `ducking`.
- Rótulo do modo novo nas UIs: a string exata `Música Dinâmica (abaixa na fala)`.
- Alvo de ducking: música ~50% (`0.5`) sem voz, ~12% (`0.12`) com voz — diferença ≈ 12 dB.
- Não mexer na normalização final de −13 LUFS (`ranking_processor.py:1150`).
- O projeto **não tem pytest** e não vai ganhar. Testes são scripts com `assert`, rodados com o Python do venv.
- Python do venv: `backend/venv/Scripts/python.exe`
- ffmpeg/ffprobe: `C:/Users/78787/Documents/ffmpeg/bin/ffmpeg` e `.../ffprobe`
- Importar `video_processor` custa ~3s (faz probe de GPU no import). É esperado, não é bug.

---

### Task 1: Extrair o grafo de filtro para uma função pura

Refatoração sem mudança de comportamento. Só depois disso o modo novo entra, num diff pequeno e revisável.

**Files:**
- Modify: `backend/video_processor.py:1639-1658` (grafo de filtro) e `:1672` (print de sucesso)
- Create: `backend/test_filtro_trilha.py`

**Interfaces:**
- Consumes: nada de tarefas anteriores.
- Produces: `_filtro_trilha(modo: str) -> str` em `backend/video_processor.py`. Recebe o valor de `trilha_modo`/`musica_modo` e devolve a string completa do `-filter_complex`, assumindo `[0:a]` = áudio do vídeo, `[1:a]` = música, saída `[final_a]`.

- [ ] **Step 1: Escrever o teste que falha**

Criar `backend/test_filtro_trilha.py`:

```python
"""
Testes do montador de filtro da trilha de fundo (_filtro_trilha).

Sem pytest de propósito: o projeto não tem infra de teste e não vale
adicionar dependência só por isso.

Rodar:  backend/venv/Scripts/python.exe backend/test_filtro_trilha.py
Sai com código 0 se tudo passar, 1 se algo falhar.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from video_processor import _filtro_trilha

FALHAS = []


def checa(nome, condicao, detalhe=""):
    if condicao:
        print(f"  ok    {nome}")
    else:
        print(f"  FALHA {nome} {detalhe}")
        FALHAS.append(nome)


# As duas strings abaixo sao EXATAMENTE o que o codigo produzia antes da
# refatoracao. Se mudarem, o comportamento dos modos existentes mudou.
ESPERADO_100 = (
    "[1:a]volume=1.0[mus];"
    "[0:a][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[final_a]"
)
ESPERADO_FIXO = (
    "[1:a]volume=0.12[mus];"
    "[0:a][mus]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[final_a]"
)

print("modo 100_musica:")
checa("grafo identico ao original", _filtro_trilha("100_musica") == ESPERADO_100,
      f"\n    veio: {_filtro_trilha('100_musica')}")

print("modo 50_50:")
checa("grafo identico ao original", _filtro_trilha("50_50") == ESPERADO_FIXO,
      f"\n    veio: {_filtro_trilha('50_50')}")

print("modo desconhecido:")
checa("cai no comportamento do 50_50", _filtro_trilha("modo_que_nao_existe") == ESPERADO_FIXO,
      f"\n    veio: {_filtro_trilha('modo_que_nao_existe')}")
checa("string vazia cai no 50_50", _filtro_trilha("") == ESPERADO_FIXO)

print()
if FALHAS:
    print(f"{len(FALHAS)} falha(s): {', '.join(FALHAS)}")
    sys.exit(1)
print("todos os testes passaram")
sys.exit(0)
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd C:/Users/78787/Documents/moviepy && backend/venv/Scripts/python.exe backend/test_filtro_trilha.py
```

Esperado: `ImportError: cannot import name '_filtro_trilha' from 'video_processor'`

- [ ] **Step 3: Implementar a função pura**

Em `backend/video_processor.py`, inserir a função **antes** de `def _adicionar_trilha_fundo` (ou seja, antes da linha 1622):

```python
def _filtro_trilha(modo: str) -> str:
    """
    Monta o -filter_complex da trilha de fundo para o modo dado.

    Entradas esperadas no comando ffmpeg:
        [0:a] = áudio do vídeo    [1:a] = música
    Saída: [final_a]

    Modos:
        100_musica  → música sozinha a 100% (o áudio do clipe já vem mudo do item)
        qualquer outro (inclui 50_50) → música em nível fixo baixo

    0.12 é amplitude linear (≈ -18 dB), o que o ouvido percebe como ~25% do
    volume. Por isso os painéis rotulam esse modo como "25% Música / 100%
    Original". Se mudar este número, atualize também os rótulos em:
        ranking_companion_live/sidepanel/sidepanel.html
        frontend/src/ranking/RankingGlobalConfigPanel.tsx
        frontend/src/components/ConfigPanel.tsx
    """
    _MIX = "amix=inputs=2:duration=first:dropout_transition=0:normalize=0[final_a]"

    if modo == "100_musica":
        return f"[1:a]volume=1.0[mus];[0:a][mus]{_MIX}"

    return f"[1:a]volume=0.12[mus];[0:a][mus]{_MIX}"
```

Depois, em `_adicionar_trilha_fundo`, **substituir** as linhas 1639-1658 — do comentário `# 0.12 é amplitude linear...` até o `]` que fecha a lista `cmd` (a linha logo antes do `if dur is not None:`) — por:

```python
    out_path = video_path + ".trilha.mp4"

    dur = _get_video_duration(video_path)
    cmd = [
        "ffmpeg", "-y", "-loglevel", "error",
        "-i", video_path,
        "-stream_loop", "-1", "-i", musica_path,
        "-filter_complex", _filtro_trilha(modo),
        "-map", "0:v:0", "-map", "[final_a]",
        "-c:v", "copy",
        "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100",
    ]
```

E na linha do print de sucesso (era 1672), trocar por (a variável `vol_musica` deixou de existir):

```python
        print(f"[trilha] aplicou '{musica_fundo}' (modo={modo}) com sucesso!")
```

- [ ] **Step 4: Rodar o teste e confirmar que passa**

```bash
cd C:/Users/78787/Documents/moviepy && backend/venv/Scripts/python.exe backend/test_filtro_trilha.py
```

Esperado: `todos os testes passaram`, exit 0.

- [ ] **Step 5: Confirmar que não sobrou referência à variável removida**

```bash
cd C:/Users/78787/Documents/moviepy && grep -n "vol_musica" backend/video_processor.py
```

Esperado: nenhuma saída. Se aparecer algo, é uma referência órfã que vai quebrar em runtime — corrigir antes de commitar.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/78787/Documents/moviepy
git add backend/video_processor.py backend/test_filtro_trilha.py
git commit -m "refactor: extrai grafo de filtro da trilha para _filtro_trilha()

Funcao pura, testavel sem ffmpeg. Comportamento de 50_50 e 100_musica
inalterado - o teste compara o grafo gerado com as strings literais que
o codigo produzia antes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 2: Adicionar o modo `ducking` ao grafo

**Files:**
- Modify: `backend/config.py:196-199` (inserir bloco novo depois de `NARRATION_FADE_S`)
- Modify: `backend/video_processor.py` (função `_filtro_trilha`)
- Modify: `backend/test_filtro_trilha.py`

**Interfaces:**
- Consumes: `_filtro_trilha(modo: str) -> str` da Task 1.
- Produces: constantes em `config.py` — `TRILHA_VOL_DUCK: float`, `TRILHA_DUCK_THRESHOLD: float`, `TRILHA_DUCK_RATIO: int`, `TRILHA_DUCK_ATTACK_MS: int`, `TRILHA_DUCK_RELEASE_MS: int`. A Task 3 ajusta os valores de `TRILHA_DUCK_THRESHOLD` e `TRILHA_DUCK_RATIO`.

- [ ] **Step 1: Escrever o teste que falha**

Em `backend/test_filtro_trilha.py`, inserir **antes** do bloco final `if FALHAS:`:

```python
print("modo ducking:")
g = _filtro_trilha("ducking")
checa("duplica o audio do clipe com asplit", "asplit=2" in g, f"\n    veio: {g}")
checa("filtra o gatilho na banda vocal grave", "highpass=f=200" in g)
checa("filtra o gatilho na banda vocal aguda", "lowpass=f=4000" in g)
checa("usa sidechaincompress", "sidechaincompress=" in g)
checa("musica entra no nivel base de ducking", "volume=0.5[mus]" in g)
checa("saida continua sendo [final_a]", g.endswith("[final_a]"))
checa("voz entra na mistura sem atenuacao", "[voz][mus_duck]amix" in g)
checa("nao vaza rotulo intermediario", g.count("[final_a]") == 1)

print("modos existentes seguem sem sidechain:")
checa("100_musica sem sidechain", "sidechaincompress" not in _filtro_trilha("100_musica"))
checa("50_50 sem sidechain", "sidechaincompress" not in _filtro_trilha("50_50"))
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

```bash
cd C:/Users/78787/Documents/moviepy && backend/venv/Scripts/python.exe backend/test_filtro_trilha.py
```

Esperado: exit 1, com falhas nos checks do modo ducking (o grafo devolvido ainda é o do `50_50`).

- [ ] **Step 3: Adicionar as constantes em `config.py`**

Em `backend/config.py`, inserir depois da linha 199 (`NARRATION_FADE_S = 0.3`):

```python

# ── Trilha de fundo (música) ─────────────────────────────────────────────────
# Nível base da música no modo "ducking", em amplitude linear, ANTES do
# compressor. O sidechaincompress derruba esse valor enquanto há voz no clipe.
TRILHA_VOL_DUCK            = 0.5
# Parâmetros do sidechaincompress. threshold e ratio são calibrados por
# medição — ver docs/superpowers/specs/2026-07-26-modo-trilha-ducking-design.md
# Alvo: música ~0.5 sem voz, ~0.12 com voz (≈ 12 dB de diferença).
TRILHA_DUCK_THRESHOLD      = 0.03
TRILHA_DUCK_RATIO          = 8
# attack curto pega o início da fala antes da música vazar por cima da primeira
# sílaba; release longo evita o bombeamento que denuncia compressão malfeita.
TRILHA_DUCK_ATTACK_MS      = 20
TRILHA_DUCK_RELEASE_MS     = 350
```

- [ ] **Step 4: Adicionar o ramo `ducking` em `_filtro_trilha`**

Em `backend/video_processor.py`, dentro de `_filtro_trilha`, inserir o bloco abaixo **entre** o `if modo == "100_musica":` e o `return` final:

```python
    if modo == "ducking":
        # O áudio do clipe é duplicado: [voz] entra na mistura final intacto
        # (100%), [key] vira só o gatilho do compressor. O passa-banda no
        # gatilho concentra a detecção na região da fala, reduzindo disparo
        # por graves e por música de fundo já embutida no clipe.
        return (
            f"[0:a]asplit=2[voz][key_raw];"
            f"[key_raw]highpass=f=200,lowpass=f=4000[key];"
            f"[1:a]volume={TRILHA_VOL_DUCK}[mus];"
            f"[mus][key]sidechaincompress="
            f"threshold={TRILHA_DUCK_THRESHOLD}:ratio={TRILHA_DUCK_RATIO}"
            f":attack={TRILHA_DUCK_ATTACK_MS}:release={TRILHA_DUCK_RELEASE_MS}[mus_duck];"
            f"[voz][mus_duck]{_MIX}"
        )
```

Atualizar também o docstring da função, acrescentando a linha do modo novo na lista de modos:

```
        ducking     → música a 50% recuando sozinha quando há voz no clipe
```

`TRILHA_VOL_DUCK` e as demais constantes já entram via o `from config import *` da linha 6 — não precisa de import novo.

- [ ] **Step 5: Rodar o teste e confirmar que passa**

```bash
cd C:/Users/78787/Documents/moviepy && backend/venv/Scripts/python.exe backend/test_filtro_trilha.py
```

Esperado: `todos os testes passaram`, exit 0. Os testes da Task 1 continuam passando — os modos antigos não foram tocados.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/78787/Documents/moviepy
git add backend/config.py backend/video_processor.py backend/test_filtro_trilha.py
git commit -m "feat: adiciona modo de trilha 'ducking' ao grafo de filtro

Musica a 50% recuando via sidechaincompress com o audio do clipe como
gatilho, filtrado na banda vocal (200-4000 Hz). Parametros em config.py.
threshold/ratio ainda com valores de partida - calibracao na proxima task.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 3: Calibrar o ducking por medição

O grafo está sintaticamente certo, mas ninguém sabe se ele realmente entrega 50%→12%. Esta task mede e ajusta até bater.

**Files:**
- Create: `backend/test_trilha_ducking_audio.py`
- Modify: `backend/config.py` (valores de `TRILHA_DUCK_THRESHOLD` / `TRILHA_DUCK_RATIO`)

**Interfaces:**
- Consumes: `_filtro_trilha("ducking")` da Task 2; constantes `TRILHA_DUCK_THRESHOLD` e `TRILHA_DUCK_RATIO` de `config.py`.
- Produces: nada consumido por tasks posteriores. É o portão de aceite do comportamento.

- [ ] **Step 1: Escrever o teste de medição**

Criar `backend/test_trilha_ducking_audio.py`:

```python
"""
Teste comportamental do modo 'ducking': mede se a musica realmente recua
quando ha voz no clipe.

Monta um clipe de 6s cujo audio simula voz em 0-2s e 4-6s, com silencio
em 2-4s. A musica e um tom continuo numa frequencia distinta, para poder
ser medida isolada por bandpass.

  voz    = 1000 Hz  (dentro da banda 200-4000 Hz que o gatilho escuta)
  musica = 6000 Hz  (fora da banda do gatilho, medivel separadamente)

Rodar:  backend/venv/Scripts/python.exe backend/test_trilha_ducking_audio.py
"""
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from video_processor import _filtro_trilha

FFMPEG = r"C:/Users/78787/Documents/ffmpeg/bin/ffmpeg"

# Alvo: musica 0.5 sem voz, 0.12 com voz -> 20*log10(0.5/0.12) ~= 12.4 dB
DELTA_MIN_DB = 9.0
DELTA_MAX_DB = 16.0


def run(cmd):
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        print(r.stderr.decode("utf-8", errors="replace")[-800:])
        raise SystemExit(f"ffmpeg falhou: {' '.join(cmd[:6])}...")
    return r


def medir(path, freq, inicio, dur):
    """mean_volume em dB da banda `freq`, na janela [inicio, inicio+dur]."""
    r = subprocess.run(
        [FFMPEG, "-hide_banner", "-nostats", "-ss", str(inicio), "-t", str(dur),
         "-i", path, "-af", f"bandpass=f={freq}:w=200,volumedetect", "-f", "null", "-"],
        capture_output=True,
    )
    saida = r.stderr.decode("utf-8", errors="replace")
    m = re.search(r"mean_volume:\s*(-?[\d.]+) dB", saida)
    if not m:
        raise SystemExit(f"nao consegui medir {path} @ {freq}Hz:\n{saida[-500:]}")
    return float(m.group(1))


tmp = tempfile.mkdtemp(prefix="duck_test_")
clipe = os.path.join(tmp, "clipe.mp4")
musica = os.path.join(tmp, "musica.mp3")
saida = os.path.join(tmp, "saida.mp4")

# Clipe: video azul + "voz" em 0-2s e 4-6s (1000 Hz ligado/desligado)
run([FFMPEG, "-y", "-loglevel", "error",
     "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=6",
     "-f", "lavfi", "-i",
     "sine=frequency=1000:sample_rate=44100:duration=6,"
     "volume='if(between(t,2,4),0,1)':eval=frame",
     "-c:v", "libx264", "-pix_fmt", "yuv420p",
     "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100", "-shortest", clipe])

# Musica: tom continuo de 6000 Hz
run([FFMPEG, "-y", "-loglevel", "error",
     "-f", "lavfi", "-i", "sine=frequency=6000:sample_rate=44100:duration=6",
     "-c:a", "libmp3lame", "-b:a", "192k", musica])

# Aplica o modo ducking com o MESMO grafo que o pipeline usa
run([FFMPEG, "-y", "-loglevel", "error",
     "-i", clipe, "-stream_loop", "-1", "-i", musica,
     "-filter_complex", _filtro_trilha("ducking"),
     "-map", "0:v:0", "-map", "[final_a]",
     "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100",
     "-t", "6.000", saida])

com_voz = medir(saida, 6000, 0.5, 1.0)    # janela com voz -> musica deve recuar
sem_voz = medir(saida, 6000, 2.5, 1.0)    # janela muda    -> musica deve subir
delta = sem_voz - com_voz

print("=" * 62)
print(f"  musica COM voz (0.5-1.5s):  {com_voz:7.2f} dB")
print(f"  musica SEM voz (2.5-3.5s):  {sem_voz:7.2f} dB")
print(f"  diferenca (o duck):         {delta:7.2f} dB")
print(f"  alvo: entre {DELTA_MIN_DB} e {DELTA_MAX_DB} dB")
print("=" * 62)

if delta < DELTA_MIN_DB:
    print("\nFALHOU: duck fraco demais - a musica quase nao recua na fala.")
    print("  Ajuste: AUMENTE TRILHA_DUCK_RATIO e/ou DIMINUA TRILHA_DUCK_THRESHOLD")
    sys.exit(1)
if delta > DELTA_MAX_DB:
    print("\nFALHOU: duck forte demais - a musica some na fala.")
    print("  Ajuste: DIMINUA TRILHA_DUCK_RATIO e/ou AUMENTE TRILHA_DUCK_THRESHOLD")
    sys.exit(1)

print("\nPASSOU: o ducking esta dentro do alvo.")
sys.exit(0)
```

- [ ] **Step 2: Rodar a medição**

```bash
cd C:/Users/78787/Documents/moviepy && backend/venv/Scripts/python.exe backend/test_trilha_ducking_audio.py
```

Anotar o valor de `diferenca`. Com os valores de partida (`threshold=0.03`, `ratio=8`) é provável que ainda não esteja no alvo — isso é esperado.

- [ ] **Step 3: Calibrar até passar**

Se o teste falhou, editar **apenas** `TRILHA_DUCK_THRESHOLD` e `TRILHA_DUCK_RATIO` em `backend/config.py` e rodar de novo. Um parâmetro por vez, para saber qual moveu o quê.

- Duck fraco (delta < 9 dB): subir `TRILHA_DUCK_RATIO` (8 → 12 → 20) ou baixar `TRILHA_DUCK_THRESHOLD` (0.03 → 0.015 → 0.008)
- Duck forte (delta > 16 dB): baixar `TRILHA_DUCK_RATIO` (8 → 5 → 3) ou subir `TRILHA_DUCK_THRESHOLD` (0.03 → 0.06 → 0.1)

Repetir o Step 2 depois de cada mudança. Não seguir para o Step 4 antes do teste sair com exit 0.

- [ ] **Step 4: Confirmar que o teste de grafo continua passando**

```bash
cd C:/Users/78787/Documents/moviepy && backend/venv/Scripts/python.exe backend/test_filtro_trilha.py
```

Esperado: `todos os testes passaram`, exit 0.

- [ ] **Step 5: Commit**

```bash
cd C:/Users/78787/Documents/moviepy
git add backend/config.py backend/test_trilha_ducking_audio.py
git commit -m "test: calibra o ducking por medicao de banda

Clipe sintetico com voz em 0-2s/4-6s e silencio em 2-4s; mede o nivel da
musica em cada janela. threshold/ratio ajustados ate a diferenca cair na
faixa alvo de 9-16 dB.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 4: Expor o modo nas três UIs

**Files:**
- Modify: `ranking_companion_live/sidepanel/sidepanel.html:199-202`
- Modify: `frontend/src/ranking/RankingGlobalConfigPanel.tsx:292-315`
- Modify: `frontend/src/components/ConfigPanel.tsx:800-823`

**Interfaces:**
- Consumes: a string de modo `ducking`, tratada pelo backend desde a Task 2.
- Produces: nada consumido por tasks posteriores.

Não há teste automatizado de UI neste projeto. A verificação é o typecheck mais a inspeção do Step 5.

- [ ] **Step 1: Extensão RANKING (LIVE)**

Em `ranking_companion_live/sidepanel/sidepanel.html`, substituir o bloco do `<select>` (linhas 199-202) por:

```html
                <select id="globalTrilhaModoSelect" class="select-field">
                  <option value="50_50">25% Música / 100% Original</option>
                  <option value="ducking">Música Dinâmica (abaixa na fala)</option>
                  <option value="100_musica">100% Música (Sem Áudio Original)</option>
                </select>
```

Nenhuma mudança em `sidepanel.js`: o handler de `change` (linha 378) já manda `e.target.value` cru para o backend, seja qual for o valor.

- [ ] **Step 2: App web — painel do ranking**

Em `frontend/src/ranking/RankingGlobalConfigPanel.tsx`, trocar a `<div>` da linha 292 de `className="flex gap-1 pt-0.5"` para `className="flex flex-col gap-1 pt-0.5"` (três rótulos longos não cabem lado a lado) e inserir o botão novo **entre** os dois botões existentes, logo depois do `</button>` da linha 303:

```tsx
                <button
                  onClick={() => handleChange({ trilha_modo: 'ducking' })}
                  className={`flex-1 py-1 px-1.5 rounded text-[10px] font-medium border transition-all cursor-pointer ${
                    ranking.trilha_modo === 'ducking'
                      ? 'bg-accent/20 border-accent text-accent font-semibold'
                      : 'bg-card2 border-border text-muted hover:text-white'
                  }`}
                  title="Mantém 100% do áudio original e toca a música num nível audível que abaixa sozinho quando alguém fala"
                >
                  Música Dinâmica (abaixa na fala)
                </button>
```

- [ ] **Step 3: App web — painel de vídeo/shorts**

Em `frontend/src/components/ConfigPanel.tsx`, trocar a `<div>` da linha 800 de `className="flex gap-1 pt-0.5"` para `className="flex flex-col gap-1 pt-0.5"` e inserir, logo depois do `</button>` da linha 811:

```tsx
              <button
                onClick={() => onChange({ musica_modo: 'ducking' })}
                className={`flex-1 py-1 px-1.5 rounded text-[10px] font-medium border transition-all cursor-pointer ${
                  video.musica_modo === 'ducking'
                    ? 'bg-accent/20 border-accent text-accent font-semibold'
                    : 'bg-card2 border-border text-muted hover:text-white'
                }`}
                title="Mantém 100% do áudio original e toca a música num nível audível que abaixa sozinho quando alguém fala"
              >
                Música Dinâmica (abaixa na fala)
              </button>
```

- [ ] **Step 4: Verificar que o typecheck não piorou**

```bash
cd C:/Users/78787/Documents/moviepy/frontend && npx tsc -b --pretty false > /tmp/tsc_task4.txt 2>&1; grep -c "error TS" /tmp/tsc_task4.txt
```

Esperado: **exatamente 25**. Esse é o número de erros pré-existentes no projeto (nenhum deles nos dois arquivos editados, a não ser dois em `RankingGlobalConfigPanel.tsx` nas linhas ~327 e ~344, que são da seção de legenda e já existiam). Qualquer número acima de 25 significa que a edição introduziu erro — corrigir antes de commitar.

- [ ] **Step 5: Conferir os três rótulos**

```bash
cd C:/Users/78787/Documents/moviepy && grep -rn "Música Dinâmica" --include=*.html --include=*.tsx frontend/src ranking_companion_live
```

Esperado: exatamente 3 ocorrências, uma em cada arquivo.

- [ ] **Step 6: Commit**

```bash
cd C:/Users/78787/Documents/moviepy
git add ranking_companion_live/sidepanel/sidepanel.html frontend/src/ranking/RankingGlobalConfigPanel.tsx frontend/src/components/ConfigPanel.tsx
git commit -m "feat: expoe o modo 'Musica Dinamica' nas tres UIs

Extensao LIVE ganha a opcao no select; os dois paineis do app web ganham
um terceiro botao, com o container virando coluna porque tres rotulos
longos nao cabem lado a lado.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

### Task 5: Regressão dos três modos ponta a ponta

Garante que o modo novo não quebrou os dois que já funcionavam.

**Files:**
- Create: `backend/test_trilha_regressao.py`

**Interfaces:**
- Consumes: `_filtro_trilha` da Task 1/2, já calibrado pela Task 3.
- Produces: nada. É o portão final.

- [ ] **Step 1: Escrever o teste de regressão**

Criar `backend/test_trilha_regressao.py`:

```python
"""
Regressao dos tres modos de trilha, ponta a ponta com ffmpeg de verdade.

Usa um clipe com "audio original" em 440 Hz e uma musica em 6000 Hz, e
confere para cada modo se cada um dos dois sinais esta presente ou ausente
na saida.

Rodar:  backend/venv/Scripts/python.exe backend/test_trilha_regressao.py
"""
import os
import re
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from video_processor import _filtro_trilha

FFMPEG = r"C:/Users/78787/Documents/ffmpeg/bin/ffmpeg"

# Abaixo disso consideramos o sinal ausente. Silencio digital mede ~-91 dB;
# vazamento do bandpass a partir de um tom forte fica na casa dos -50 dB.
LIMIAR_AUSENTE_DB = -45.0

FALHAS = []


def checa(nome, condicao, detalhe=""):
    if condicao:
        print(f"  ok    {nome}")
    else:
        print(f"  FALHA {nome} {detalhe}")
        FALHAS.append(nome)


def run(cmd):
    r = subprocess.run(cmd, capture_output=True)
    if r.returncode != 0:
        print(r.stderr.decode("utf-8", errors="replace")[-800:])
        raise SystemExit("ffmpeg falhou")


def medir(path, freq):
    r = subprocess.run(
        [FFMPEG, "-hide_banner", "-nostats", "-i", path,
         "-af", f"bandpass=f={freq}:w=200,volumedetect", "-f", "null", "-"],
        capture_output=True,
    )
    saida = r.stderr.decode("utf-8", errors="replace")
    m = re.search(r"mean_volume:\s*(-?[\d.]+) dB", saida)
    if not m:
        raise SystemExit(f"nao consegui medir {path} @ {freq}Hz")
    return float(m.group(1))


tmp = tempfile.mkdtemp(prefix="trilha_reg_")
musica = os.path.join(tmp, "musica.mp3")

run([FFMPEG, "-y", "-loglevel", "error",
     "-f", "lavfi", "-i", "sine=frequency=6000:sample_rate=44100:duration=6",
     "-c:a", "libmp3lame", "-b:a", "192k", musica])


def clipe_para(modo):
    """Clipe de 6s. No 100_musica o audio ja vem mudo, como o pipeline faz."""
    path = os.path.join(tmp, f"clipe_{modo}.mp4")
    if modo == "100_musica":
        audio = ["-f", "lavfi", "-t", "6", "-i", "anullsrc=r=44100:cl=stereo"]
    else:
        audio = ["-f", "lavfi", "-i", "sine=frequency=440:sample_rate=44100:duration=6"]
    run([FFMPEG, "-y", "-loglevel", "error",
         "-f", "lavfi", "-i", "color=c=blue:s=320x180:r=30:d=6", *audio,
         "-c:v", "libx264", "-pix_fmt", "yuv420p",
         "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100", "-shortest", path])
    return path


for modo in ["50_50", "ducking", "100_musica"]:
    clipe = clipe_para(modo)
    saida = os.path.join(tmp, f"saida_{modo}.mp4")
    run([FFMPEG, "-y", "-loglevel", "error",
         "-i", clipe, "-stream_loop", "-1", "-i", musica,
         "-filter_complex", _filtro_trilha(modo),
         "-map", "0:v:0", "-map", "[final_a]",
         "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-ac", "2", "-ar", "44100",
         "-t", "6.000", saida])

    orig = medir(saida, 440)
    mus = medir(saida, 6000)
    print(f"modo {modo}:  original(440Hz)={orig:7.2f} dB   musica(6000Hz)={mus:7.2f} dB")

    if modo == "100_musica":
        checa("100_musica descarta o audio original", orig < LIMIAR_AUSENTE_DB,
              f"(mediu {orig:.2f} dB, esperado < {LIMIAR_AUSENTE_DB})")
        checa("100_musica mantem a musica", mus > LIMIAR_AUSENTE_DB)
    else:
        checa(f"{modo} preserva o audio original", orig > LIMIAR_AUSENTE_DB,
              f"(mediu {orig:.2f} dB, esperado > {LIMIAR_AUSENTE_DB})")
        checa(f"{modo} mantem a musica", mus > LIMIAR_AUSENTE_DB)

print()
if FALHAS:
    print(f"{len(FALHAS)} falha(s): {', '.join(FALHAS)}")
    sys.exit(1)
print("todos os modos passaram na regressao")
sys.exit(0)
```

- [ ] **Step 2: Rodar a regressão**

```bash
cd C:/Users/78787/Documents/moviepy && backend/venv/Scripts/python.exe backend/test_trilha_regressao.py
```

Esperado: `todos os modos passaram na regressao`, exit 0.

Se `50_50` ou `100_musica` falharem, a refatoração da Task 1 quebrou comportamento existente — voltar e corrigir, não relaxar o limiar.

- [ ] **Step 3: Rodar os três testes em sequência**

```bash
cd C:/Users/78787/Documents/moviepy
backend/venv/Scripts/python.exe backend/test_filtro_trilha.py && \
backend/venv/Scripts/python.exe backend/test_trilha_ducking_audio.py && \
backend/venv/Scripts/python.exe backend/test_trilha_regressao.py && \
echo "TUDO VERDE"
```

Esperado: `TUDO VERDE`.

- [ ] **Step 4: Commit**

```bash
cd C:/Users/78787/Documents/moviepy
git add backend/test_trilha_regressao.py
git commit -m "test: regressao ponta a ponta dos tres modos de trilha

Confere por medicao de banda que 100_musica descarta o audio original e
que 50_50 e ducking o preservam, todos mantendo a musica.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Como testar de verdade depois

Os testes acima usam tons sintéticos. Para validar com material real, o usuário precisa:

1. Reiniciar o backend (`uvicorn` roda com `reload=False`, então mudança em `.py` só vale depois de reiniciar)
2. Na extensão RANKING (LIVE), escolher **"Música Dinâmica (abaixa na fala)"** no seletor Modo da Trilha
3. Processar um ranking e comparar com um vídeo feito no modo `50_50`

Lembrar do limite registrado no spec: em clipe que já tem música própria alta e contínua, o gatilho nunca fica quieto e a trilha nova fica sempre abaixada, com resultado parecido com os 12% de hoje. O modo brilha em clipe com voz e fundo calmo.
