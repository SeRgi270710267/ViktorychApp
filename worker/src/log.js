/* Structured Worker logs. The message is a short code. Tokens, cookies, and
   long opaque strings are removed before they reach Workers Logs. */

function scrub(value) {
  return String(value || "error")
    .replace(/bearer\s+\S+/gi, "bearer [redacted]")
    .replace(/\b(?:token|secret|password|cookie|authorization)\b\s*[:=]\s*\S+/gi, "[redacted]")
    .replace(/[A-Za-z0-9_\-+/=]{24,}/g, "[redacted]")
    .replace(/\b\d{4}(?:[ -]?\d{4}){3}\b/g, "[redacted]")
    .replace(/\b[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}\b/g, "[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 160);
}

export function logError(area, err) {
  const name = String(area || "worker").replace(/[^a-z0-9_-]/gi, "").slice(0, 32) || "worker";
  const code = scrub(err && err.message ? err.message : err);
  console.error(JSON.stringify({ at: "worker", area: name, code: code }));
}
