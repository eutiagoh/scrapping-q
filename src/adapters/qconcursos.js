import { chromium } from "playwright-extra";
import stealthPlugin from "puppeteer-extra-plugin-stealth";

chromium.use(stealthPlugin());

const LOGIN_URL = "https://www.qconcursos.com/conta/entrar";

/**
 * Faz login e retorna um browser context autenticado.
 * Ajuste os seletores conforme mudanças no QConcursos.
 */
export async function loginQConcursos(email, password) {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1366, height: 900 },
    userAgent:
      "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36",
  });
  const page = await context.newPage();
  await page.goto(LOGIN_URL, { waitUntil: "domcontentloaded" });

  await page.fill('#login_email', email);
  await page.fill('#login_password', password);
  await Promise.all([
    page.waitForNavigation({ waitUntil: "domcontentloaded" }).catch(() => null),
    page.click('button[type="submit"]'),
  ]);

  const cookies = await context.cookies();
  const loggedIn = cookies.some((c) => /session|auth|token/i.test(c.name));
  if (!loggedIn) {
    // Alguns fluxos não redirecionam — checa presença do link "sair".
    const hasLogout = await page.locator('a:has-text("Sair"), a[href*="logout"]').count();
    if (!hasLogout) {
      await browser.close();
      throw new Error("QConcursos login failed (check credentials or captcha).");
    }
  }

  return { browser, context, page };
}

/**
 * Coleta URLs de questões a partir da URL de um caderno.
 * Estratégia genérica: procura por links `/questoes/<id>`.
 */
export async function collectQuestionLinks(page, cadernoUrl) {
  await page.goto(cadernoUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);

  // Aceita popups de cookies etc.
  await page
    .locator('button:has-text("Aceitar"), button:has-text("Concordo")')
    .first()
    .click({ timeout: 1500 })
    .catch(() => null);

  const links = await page.$$eval("a[href*='/questoes/']", (nodes) =>
    Array.from(new Set(nodes.map((n) => n.href).filter((h) => /\/questoes\/\d+/.test(h)))),
  );
  return links;
}

/**
 * Responde 'A' em uma questão e captura o gabarito revelado.
 * Retorna { external_id, correct_answer } ou lança em falha.
 */
export async function answerAndReadCorrect(page, questionUrl) {
  await page.goto(questionUrl, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(800);

  const externalIdMatch = questionUrl.match(/\/questoes\/(\d+)/);
  const externalId = externalIdMatch?.[1];
  if (!externalId) throw new Error(`Cannot parse external id from ${questionUrl}`);

  // Seleciona primeira alternativa (rádio) — QConcursos costuma usar labels "A", "B"...
  const firstAlt = page.locator('label.js-choose-alternative').first();
  await firstAlt.click({ timeout: 5000 });

  // Prepara para capturar a resposta da API do QConcursos
  const responsePromise = page.waitForResponse(
    (response) => response.url().includes('/respostas') && response.status() === 200,
    { timeout: 15000 }
  );

  // Botão "Responder"
  await page.locator('button:has-text("Responder"), button:has-text("Enviar")').first().click({ timeout: 5000 });

  // Aguarda a resposta da API
  const apiResponse = await responsePromise;
  const json = await apiResponse.json();
  
  const letter = json.correct_alternative?.toUpperCase() || json.gabarito?.toUpperCase();
  
  if (!letter) {
    throw new Error(`Could not parse correct answer from API response: ${JSON.stringify(json)}`);
  }

  return { external_id: externalId, correct_answer: letter, source_url: questionUrl };
}
