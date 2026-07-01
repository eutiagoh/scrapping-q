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

  // Tenta encontrar a resposta pelo DOM se a API falhar
  await page.locator('button:has-text("Responder"), button:has-text("Enviar")').first().click({ timeout: 5000 });
  await page.waitForTimeout(2500); // Aguarda o ajax/animações

  // Verifica se apareceu o modal de limite de 10 questões
  const limitModal = await page.locator(':text-matches("Limite de 10 questões", "i")').count();
  if (limitModal > 0) {
    throw new Error("Limite de 10 questões diárias do QConcursos atingido na conta gratuita.");
  }

  // No QConcursos, após responder, a alternativa correta costuma receber uma classe específica ou
  // o gabarito é revelado num bloco de estatísticas.
  // Vamos procurar a div do gabarito (que é mostrada em contas premium ou quando erramos)
  let letter = await page.evaluate(() => {
    // Procura por "Gabarito: A"
    const textNodes = document.body.innerText;
    const match = textNodes.match(/Gabarito:?\s*([A-E])/i);
    if (match) return match[1].toUpperCase();

    // Procura se alguma alternativa ganhou classe de correta (ex: is-correct)
    const correctAlt = document.querySelector('.is-correct input, .correct input, .q-correct-option input, .js-correct-alternative input');
    if (correctAlt && correctAlt.value) return correctAlt.value.toUpperCase();

    return null;
  });

  if (!letter) {
    // Se o robô chutou a opção "A" e acertou, a tela diz "Parabéns, você acertou!" e não mostra o gabarito
    const hasSuccess = await page.locator('.q-correct, .js-response-correct, :text-matches("Você acertou", "i")').count();
    if (hasSuccess > 0) {
      letter = 'A'; // Sabendo que chutamos a primeira (A)
    } else {
      throw new Error(`Could not parse correct answer. Maybe UI changed or account is limited. URL: ${questionUrl}`);
    }
  }

  return { external_id: externalId, correct_answer: letter, source_url: questionUrl };
}
