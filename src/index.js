// For local dev run: `node --env-file=.env src/index.js`. On Railway/Fly env vars are injected natively.
import { callApi } from "./api.js";
import { loginQConcursos, collectQuestionLinks, answerAndReadCorrect } from "./adapters/qconcursos.js";

const POLL = Number(process.env.POLL_INTERVAL_MS ?? 15_000);
const DELAY = Number(process.env.QUESTION_DELAY_MS ?? 2_000);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runJob(job, credentials) {
  console.log(`[job ${job.id}] source=${job.source} url=${job.target_url}`);

  if (job.source !== "qconcursos") throw new Error(`Unsupported source: ${job.source}`);
  if (!credentials?.email || !credentials?.password) throw new Error("Missing QConcursos credentials");

  const { browser, page } = await loginQConcursos(credentials.email, credentials.password);
  const stats = { total: 0, collected: 0, errors: 0 };
  try {
    const links = await collectQuestionLinks(page, job.target_url);
    stats.total = links.length;
    console.log(`[job ${job.id}] ${links.length} question links found`);

    for (const link of links) {
      try {
        const q = await answerAndReadCorrect(page, link);
        await callApi("/api/public/scrape/questions", { job_id: job.id, question: q });
        stats.collected++;
      } catch (e) {
        console.error(`[job ${job.id}] ${link} -> ${e.message}`);
        stats.errors++;
      }
      await sleep(DELAY);
    }

    await callApi("/api/public/scrape/finish", { job_id: job.id, status: "succeeded", stats });
    console.log(`[job ${job.id}] done`, stats);
  } catch (err) {
    console.error(`[job ${job.id}] failed`, err);
    await callApi("/api/public/scrape/finish", {
      job_id: job.id,
      status: "failed",
      error: err.message ?? String(err),
      stats,
    }).catch(() => null);
  } finally {
    await browser.close().catch(() => null);
  }
}

async function main() {
  console.log("Scraper worker up. Polling every", POLL, "ms");
  while (true) {
    try {
      const { job, credentials } = await callApi("/api/public/scrape/claim");
      if (!job) {
        await sleep(POLL);
        continue;
      }
      await runJob(job, credentials);
    } catch (e) {
      console.error("poll error:", e.message);
      await sleep(POLL);
    }
  }
}

main().catch((e) => {
  console.error("fatal", e);
  process.exit(1);
});
