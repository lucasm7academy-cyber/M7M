# Terceiro modo de trilha sonora: ducking automático

**Data:** 2026-07-26
**Escopo:** backend de áudio (`video_processor.py`) + rótulos nas três UIs

## Problema

O app tem hoje dois modos de trilha de fundo, selecionados por `trilha_modo`
(ranking) / `musica_modo` (vídeo/shorts):

| Modo | Áudio do clipe fonte | Trilha escolhida |
|---|---|---|
| `100_musica` | 0% (silêncio digital via `anullsrc`) | 100% |
| `50_50` | 100% | 12% (`0.12` linear ≈ −18 dB) |

No modo `50_50` a trilha entra com **multiplicador fixo**, independente de quão
alto o clipe fonte foi gravado. Como o volume dos clipes varia muito (live de
FPS com o cara gritando vs. gameplay calmo), o equilíbrio percebido oscila:
em uns vídeos a trilha some, em outros atropela a voz.

Agrava o efeito o fato de `normalizar_audio` (`ranking_processor.py:1150`)
aplicar `loudnorm` a −13 LUFS **na mistura inteira** ao final. O volume absoluto
escolhido importa pouco; o que decide o resultado é a **razão** voz/música — e
essa razão hoje é refém do nível do clipe fonte.

### Correção já aplicada (fora do escopo deste spec)

Antes deste trabalho, `vol_base` era `2.0` (+6 dB), o que amplificava o áudio do
clipe fonte e fazia a música própria dele soar como uma segunda trilha por cima
da escolhida. Já foi corrigido para `1.0` em `ranking_processor.py:427` e
`video_processor.py:1928`, com verificação por medição de banda
(−18.1 dB → −24.1 dB, batendo exatamente o nível do arquivo fonte).

## Objetivo

Adicionar um **terceiro modo** onde a música é claramente audível mas recua
sozinha quando há voz — "perceber a música sem atrapalhar a voz".

Alvo de comportamento, definido com o usuário:

- Sem voz: música em **~50%**
- Com voz: música recua para **~12%**

## Design

### Novo valor de modo: `ducking`

Terceiro valor ao lado de `50_50` e `100_musica`. **O padrão continua `50_50`** —
o modo novo é opt-in, para teste, sem alterar nada do comportamento existente.

### Mudança de lógica: apenas `_adicionar_trilha_fundo`

Ponto único de alteração, em `video_processor.py:1639`. O grafo de filtro, hoje
fixo, passa a ter um ramo para o modo novo:

```
[0:a]asplit=2[voz][key_raw];
[key_raw]highpass=f=200,lowpass=f=4000[key];
[1:a]volume=0.5[mus];
[mus][key]sidechaincompress=threshold=<calibrar>:ratio=<calibrar>:attack=20:release=350[mus_duck];
[voz][mus_duck]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[final_a]
```

O áudio do clipe é duplicado por `asplit`: uma cópia entra na mistura final
intacta (100%), a outra vira **sinal de gatilho** do compressor. A música entra
a 50% e o `sidechaincompress` a empurra para baixo enquanto o gatilho tem sinal.

- `attack=20ms` — rápido o bastante para não deixar a música vazar por cima da
  primeira sílaba
- `release=350ms` — retorno suave, sem o bombeamento que denuncia compressão malfeita
- `highpass=200,lowpass=4000` no gatilho — concentra a detecção na banda vocal,
  reduzindo disparo por graves e por música de fundo do clipe

`threshold` e `ratio` ficam **a calibrar por medição** (ver Verificação). Os
valores de partida são `threshold=0.03:ratio=8`.

### Nada muda em `montar_item`

`vol_base` é `0.0 if modo == "100_musica" else 1.0` em ambos os fluxos, então o
modo novo já herda o áudio original em 100% automaticamente. Nenhuma edição
necessária em `ranking_processor.py:427` nem em `video_processor.py:1928`.

### UI: três arquivos ganham a terceira opção

| Arquivo | Contexto |
|---|---|
| `ranking_companion_live/sidepanel/sidepanel.html:200` | extensão RANKING (LIVE) |
| `frontend/src/ranking/RankingGlobalConfigPanel.tsx` | app web, ranking |
| `frontend/src/components/ConfigPanel.tsx` | app web, vídeo/shorts |

Rótulo: **"Música Dinâmica (abaixa na fala)"** — descreve o comportamento em vez
de porcentagem. Porcentagem já se provou uma fonte de confusão neste projeto:
os três painéis anunciavam números diferentes (25%, 30%, 30%) para o mesmo
processamento de 12%.

A extensão `video_companion` (shorts) não tem seletor de modo e não é afetada;
ela usa o default `100_musica` de `video_processor.py:2127`.

## Limitação conhecida

`sidechaincompress` dispara com **qualquer som** do clipe fonte, não só com voz.
O filtro de banda vocal no gatilho ajuda, mas não separa perfeitamente.

- Clipe com voz e fundo calmo → funciona como desenhado
- Clipe que já tem música própria alta e contínua → o gatilho nunca fica quieto e
  a trilha nova fica permanentemente abaixada, resultado próximo aos 12% de hoje

O modo novo melhora o equilíbrio **voz × música**. Ele **não** elimina a música
que já vem embutida no clipe fonte — nenhum modo que preserve o áudio original
elimina. Só o `100_musica` faz isso, descartando o áudio do clipe.

## Verificação

Medição por banda, mesmo método usado na investigação que originou este trabalho:

1. Clipe de teste com "voz" em 0–2s e 4–6s, silêncio em 2–4s
2. Trilha em frequência distinta da voz, para medir separadamente
3. Medir o nível da música em cada janela com `bandpass` + `volumedetect`

Critério de aceite: música alta na janela muda e recuada nas janelas com voz,
com a diferença entre os dois estados próxima do alvo 50% → 12% (≈ 12 dB).
`threshold` e `ratio` são ajustados até a medição bater; o modo não é dado como
pronto por inspeção visual do código.

Verificar também que `50_50` e `100_musica` seguem inalterados após a mudança.

## Fora de escopo

- Alterar o comportamento de `50_50` ou `100_musica`
- Mexer na normalização final de −13 LUFS
- Normalização relativa por LUFS entre clipe e música (avaliada e adiada:
  adiciona uma passada de medição por vídeo, custo de tempo que o usuário não quer)
- Os 25 erros de tipo pré-existentes no frontend, que fazem `npm run build` falhar
