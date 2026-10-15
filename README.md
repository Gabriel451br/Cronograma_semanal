# Cronograma Semanal

Agenda semanal e diária, simples e minimalista, para organizar rotina, compromissos fixos, estudo, família, trabalho e pequenas tarefas — com lembretes e um planejador inteligente.

**App:** https://gabriel451br.github.io/Cronograma_semanal/

## Funcionalidades

- **Hoje** — agenda do dia, tarefas sem horário, progresso, “próximo compromisso” e distribuição do tempo por área. Adição rápida em linguagem natural: `14:30 dentista`, `reunião 9h-10h`, `comprar pão`.
- **Semana** — visão dos 7 dias com compromissos fixos e pontuais, e horas planejadas por área.
- **Compromissos fixos semanais** — repetem nos dias escolhidos; dá para marcar como feito por dia ou pular apenas uma data.
- **Lembretes** — notificações do navegador/celular com antecedência configurável (por item ou padrão). Exportação `.ics` para Google Agenda / Apple Calendário, com alarmes que funcionam mesmo com o app fechado.
- **Planejar (✦)** — questionário curto (horários, trabalho, período de mais energia, horas de estudo, exercício, tempo com a família, metas pessoais) que gera uma rotina semanal equilibrada, com avisos e dicas. Pode ser refeito a qualquer momento sem apagar seus itens manuais.
- **Tudo personalizável** — categorias (nome e cor), tema claro/escuro, início da semana, lembrete padrão, horário ativo do dia.
- **Funciona offline** e pode ser instalado na tela inicial (PWA). Backup/restauração em JSON.

Os dados ficam salvos apenas no seu dispositivo (localStorage).

## Rodar localmente

Sem dependências nem build:

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

## Deploy

Cada push na branch `main` publica automaticamente no GitHub Pages (`.github/workflows/deploy.yml`).
Se for o primeiro deploy e falhar, ative em **Settings → Pages → Source: GitHub Actions** e rode o workflow novamente.

## Estrutura

```
index.html            # casca do app
css/style.css         # estilos (tema claro/escuro)
js/app.js             # interface e telas
js/store.js           # dados e datas
js/notifications.js   # lembretes
js/planner.js         # planejador inteligente
js/ics.js             # exportação de calendário
sw.js                 # service worker (offline + notificações)
```
