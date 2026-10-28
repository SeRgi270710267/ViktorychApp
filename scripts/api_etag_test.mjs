/* Repeat API reads send the last ETag back; a 304 reuses the body the app
   already has, with no bytes sent. Runs accounts.js in a vm. */
const sent = [];
let reply = null;
function fakeFetch(url, init) {
  const headers = (init && init.headers) || {};
  if (String(url).indexOf("/v1/") < 0) return Promise.resolve(res(404, null));
  sent.push({ url, inm: headers["If-None-Match"] || "" });
  return Promise.resolve(reply(headers));
}
function res(status, body, tag) {
  return { status, headers: { get: (k) => (k.toLowerCase() === "etag" ? tag || null : null) }, text: () => Promise.resolve(body == null ? "" : JSON.stringify(body)) };
}
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const accountsCode = fs.readFileSync("accounts.js", "utf8");
const store = {};
const windowMock = {
  addEventListener: () => {},
  removeEventListener: () => {},
  dispatchEvent: () => true,
  CustomEvent: function () {},
  t: (key) => key,
  SI18n: { productName: () => "ViktorychApp" },
  VIKTORYCH_ACCOUNTS: { api: "https://api.test", gate: false },
  fetch: (url, init) => fakeFetch(url, init),
  location: { hash: "#/", replace() {} },
  matchMedia: () => ({ matches: false }),
  localStorage: {
    getItem: (key) => (Object.prototype.hasOwnProperty.call(store, key) ? store[key] : null),
    setItem: (key, value) => { store[key] = String(value); },
    removeItem: (key) => { delete store[key]; }
  },
  sessionStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
  document: {
    addEventListener: () => {},
    removeEventListener: () => {},
    querySelector: () => null,
    querySelectorAll: () => []
  },
  HandleSkeleton: { skeleton: (handle) => String(handle || "").toLowerCase() }
};
windowMock.window = windowMock;
windowMock.document.defaultView = windowMock;
vm.runInContext(accountsCode, vm.createContext(windowMock));
const accounts = windowMock.ViktorychAccounts;

reply = () => res(200, { lives: [{ id: "a" }], status: "ok" }, 'W/"t1"');
let body = await accounts.call("/v1/live", { token: "tok" });
assert.equal(body.status, 200);
assert.equal(body.bodyStatus, "ok");
assert.equal(sent[0].inm, "", "first read sends no tag");

reply = (h) => (h["If-None-Match"] === 'W/"t1"' ? res(304, null, 'W/"t1"') : res(200, { lives: [] }, 'W/"t2"'));
body = await accounts.call("/v1/live", { token: "tok" });
assert.equal(sent[1].inm, 'W/"t1"', "repeat read sends the tag");
assert.equal(body.status, 200, "a 304 reads as the same 200 body");
assert.deepEqual(JSON.parse(JSON.stringify(body.lives)), [{ id: "a" }]);
assert.equal(body.bodyStatus, "ok");
body.lives.push({ id: "mutated" });
body = await accounts.call("/v1/live", { token: "tok" });
assert.equal(body.lives.length, 1, "callers cannot change the kept copy");

// Another account never reuses this one's copy; writes never send a tag.
reply = () => res(200, { lives: [] }, 'W/"t3"');
await accounts.call("/v1/live", { token: "other" });
assert.equal(sent[sent.length - 1].inm, "");
await accounts.call("/v1/live", { method: "POST", token: "tok", body: {} });
assert.equal(sent[sent.length - 1].inm, "");
console.log("api etag ok");
