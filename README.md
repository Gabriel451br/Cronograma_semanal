# Cronograma Semanal

Agenda semanal e diária, simples e minimalista, para organizar rotina, compromissos fixos, estudo, família, trabalho e pequenas tarefas — com lembretes e um planejador inteligente.

**App:** https://gabriel451br.github.io/Cronograma_semanal/

## Funcionalidades

- **Início (painel)** — o bloco de **agora** com progresso e detalhes, o próximo bloco, contagem regressiva para dormir, progresso do dia, faixa da semana e horas por área.
- **Rotina** — rotina semanal no estilo “períodos do dia” (🌅 Manhã, 🏢 Tarde, 🏋️ Noite…), com blocos de horário, etiqueta (ex: `1h15 brutos ➔ 1h líquida`) e detalhes em tópicos. Edite por dia, copie um dia para outros, exporte em texto.
- **Importar texto / modelo** — cole uma rotina em texto (`06:15 às 07:30 – Bloco de Estudos 1`, com `•` para detalhes e títulos com emoji para os períodos) e ela vira blocos. Inclui o modelo pronto *Foco, Família e Trabalho*.
- **Sono em ciclos de 90 min** — escolha fixar a hora de acordar **ou** de dormir, quantos ciclos (3–6) e o tempo para adormecer; o app calcula o outro horário e ajusta automaticamente os blocos “Acordar” e “Dormir” da rotina.
- **Agenda** — compromissos detalhados (data, horário, local, detalhes, lembrete) nas visões Dia, Semana e Mês. Adição rápida: `14:30 dentista`.
- **Lembretes** — notificações com antecedência configurável e exportação `.ics` para Google Agenda / Calendário do celular.
- **Assistente ✦** — questionário que sugere uma rotina equilibrada a partir de metas.
- **Tudo personalizável** — períodos (emoji, nome, subtítulo, horário), categorias, tema claro/escuro, início da semana. Funciona offline, instalável (PWA), com backup em JSON.

Os dados ficam salvos apenas no seu dispositivo (localStorage).

## Rodar localmente

Sem dependências nem build:

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

## Deploy

Cada push na branch `main` publica automaticamente no GitHub Pages (`.github/workflows/deploy.yml`).
O workflow copia os arquivos do app para a branch `gh-pages`, que é servida pelo GitHub Pages (Settings → Pages → Source: *Deploy from a branch* → `gh-pages`).

## Estrutura

```
index.html            # casca do app
css/style.css         # estilos (tema claro/escuro)
js/app.js             # interface e telas
js/sleep.js           # calculadora de ciclos de sono
js/routine-text.js    # importar/exportar rotina em texto + modelo
js/store.js           # dados e datas
js/notifications.js   # lembretes
js/planner.js         # planejador inteligente
js/ics.js             # exportação de calendário
sw.js                 # service worker (offline + notificações)
```
