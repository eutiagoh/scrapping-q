import { createHmac } from "node:crypto";
import { fetch } from "undici";

const APP = process.env.LOVABLE_APP_URL;
const SECRET = process.env.SCRAPER_WORKER_SHARED_SECRET;
if (!APP || !SECRET) throw new Error("LOVABLE_APP_URL and SCRAPER_WORKER_SHARED_SECRET are required");

function sign(ts, body) {
  return createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
}

export async function callApi(path, payload = {}) {
  const body = JSON.stringify(payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  const res = await fetch(`${APP}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-worker-timestamp": ts,
      "x-worker-signature": sign(ts, body),
    },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${path} -> ${res.status}: ${text}`);
  return text ? JSON.parse(text) : {};
}
