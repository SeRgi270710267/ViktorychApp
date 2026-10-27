// Blocks the paid X API hosts. Public fxtwitter reads and x.com intent links stay allowed.

const PAID = /^(?:api\.x\.com|api\.twitter\.com|upload\.twitter\.com)$/i;

export function assertNotPaidX(value) {
  let host = "";
  try { host = new URL(String(value)).hostname; } catch (err) { return; }
  if (PAID.test(host)) throw new Error("paid-x-api");
}
