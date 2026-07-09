export function normalizeSpeechText(text) {
  const firstLine = String(text).split("\n")[0];
  return firstLine.split(/\s+/).filter(Boolean).join(" ");
}

export function roundRatePercent(rate) {
  const percent = (Number(rate) - 1) * 100;
  return Math.round(percent / 5) * 5;
}

export async function computeCacheKey(text, voice, rate) {
  const payload = `${normalizeSpeechText(text)}|${voice}|${roundRatePercent(rate)}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
