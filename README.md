# Scraper Worker — Coletor de Questões

Worker externo Node.js + Playwright que consome jobs de coleta do Lovable Cloud, faz login autenticado na plataforma alvo (QConcursos), responde cada questão (alternativa A) e envia o gabarito revelado de volta ao backend.

## Como funciona

```
Lovable Cloud (backend)         Worker externo (este repo)
──────────────────────         ─────────────────────────────
POST /api/public/scrape/claim  ←── polling a cada 15s
      returns { job, creds }   ──→ abre Chromium, faz login
POST /api/public/scrape/questions ←── por questão coletada
POST /api/public/scrape/finish    ←── ao terminar
```

Autenticação: cada request usa HMAC-SHA256 sobre `timestamp.body` com o segredo compartilhado (`SCRAPER_WORKER_SHARED_SECRET`), enviados nos headers `x-worker-timestamp` e `x-worker-signature`. O backend rejeita timestamps fora de uma janela de 5 minutos.

## Rodar localmente

```bash
cd worker
cp .env.example .env
# Preencha LOVABLE_APP_URL e SCRAPER_WORKER_SHARED_SECRET
npm install
npx playwright install chromium
npm start
```

## Deploy no Railway (recomendado)

1. Crie um novo projeto no Railway apontando para esta pasta (`worker/`).
2. Railway detecta o `Dockerfile` automaticamente — ele já traz Chromium pré-instalado.
3. Configure as variáveis de ambiente em Settings → Variables:
   - `LOVABLE_APP_URL` — URL de produção do app (ex.: `https://project--<id>.lovable.app`)
   - `SCRAPER_WORKER_SHARED_SECRET` — mesmo valor do secret no Lovable Cloud
   - `POLL_INTERVAL_MS` (opcional, default 15000)
   - `QUESTION_DELAY_MS` (opcional, default 2000)
4. Deploy. O worker fica em polling contínuo.

## Onde ajustar quando o layout do QConcursos mudar

Todos os seletores estão em `src/adapters/qconcursos.js`. Se algo parar de funcionar:

- **Login falha**: revise seletores em `loginQConcursos()`.
- **Não encontra questões no caderno**: ajuste o pattern em `collectQuestionLinks()`.
- **Gabarito não aparece**: ajuste `correctLocator` em `answerAndReadCorrect()`.

## Como adicionar outra plataforma

1. Crie `src/adapters/<nome>.js` implementando as mesmas 3 funções.
2. No backend, adicione o valor ao enum `public.scrape_source` (migration).
3. No `src/index.js`, adicione um `switch (job.source)` chamando o adapter correspondente.
4. Reflita na UI (`_authenticated/scraping.tsx`, `<Select>` de plataforma).
