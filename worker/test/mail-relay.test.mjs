import assert from "node:assert/strict";
import test from "node:test";
import { handleMail, searchQuery, utf7, cleanFolder, decodeWords, messageText, splitFrom } from "../src/mail-relay.js";

// Synthetic mailbox only: example.test addresses and made-up codes.
const json = (status, body, headers) => new Response(JSON.stringify(body), { status, headers: Object.assign({ "content-type": "application/json" }, headers || {}) });
const limited = () => json(429, { error: "rate_limited" });
const ON = { INBOX_RELAY: "on" };

const HEAD1 = "From: =?UTF-8?B?0K/QvdC00LXQutGB?= <noreply@example.test>\r\nSubject: Your code 482913\r\nDate: Thu, 29 Oct 2026 10:00:00 +0000\r\n\r\n";
const HEAD2 = "From: News <news@example.test>\r\nSubject: Weekly digest\r\n\r\n";
const BODY = "From: a@example.test\r\nContent-Type: multipart/alternative; boundary=\"b1\"\r\n\r\n--b1\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: quoted-printable\r\n\r\nYour code is 482913=0D=0AThanks\r\n--b1--\r\n";

function fakeServer(log, opts) {
  opts = opts || {};
  const out = [];
  let push;
  const readable = new ReadableStream({ start(c) { push = (s) => c.enqueue(new TextEncoder().encode(s)); push("* OK ready\r\n"); } });
  const writable = new WritableStream({
    write(chunk) {
      const line = new TextDecoder().decode(chunk).trim();
      log.push(line);
      const [tag, cmd] = [line.split(" ")[0], line.split(" ").slice(1).join(" ")];
      if (/^LOGIN/.test(cmd)) push(opts.badLogin ? tag + " NO [AUTHENTICATIONFAILED] nope\r\n" : tag + " OK done\r\n");
      else if (/^EXAMINE/.test(cmd)) push(opts.noFolder ? tag + " NO no such folder\r\n" : "* 2 EXISTS\r\n* OK [UIDVALIDITY 77] v\r\n* OK [UIDNEXT 13] n\r\n" + tag + " OK [READ-ONLY] done\r\n");
      else if (/^UID SEARCH/.test(cmd)) push("* SEARCH 11 12\r\n" + tag + " OK done\r\n");
      else if (/^UID FETCH 11,12/.test(cmd)) push("* 1 FETCH (UID 11 FLAGS (\\Seen) INTERNALDATE \"29-Oct-2026 10:00:00 +0000\" RFC822.SIZE 900 BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {" + HEAD1.length + "}\r\n" + HEAD1 + ")\r\n* 2 FETCH (UID 12 FLAGS () RFC822.SIZE 500 BODY[HEADER.FIELDS (FROM SUBJECT DATE)] {" + HEAD2.length + "}\r\n" + HEAD2 + ")\r\n" + tag + " OK done\r\n");
      else if (/^UID FETCH 11 /.test(cmd)) push("* 1 FETCH (UID 11 BODY[]<0> {" + BODY.length + "}\r\n" + BODY + ")\r\n" + tag + " OK done\r\n");
      else if (/^LOGOUT/.test(cmd)) push("* BYE\r\n" + tag + " OK bye\r\n");
      else push(tag + " BAD unexpected\r\n");
    }
  });
  return { readable, writable, close() {} };
}

function deps(log, opts, signedIn) {
  return {
    json, limited,
    rateHit: async () => ({ ok: true }),
    sessionAccount: async () => (signedIn === false ? null : { public_id: "000000000002" }),
    readJson: async (req) => JSON.parse(await req.text()),
    connect: (addr, o) => { log.push("CONNECT " + addr.hostname + ":" + addr.port + " " + o.secureTransport); return fakeServer(log, opts); }
  };
}
const post = (body) => new Request("https://accounts.test/v1/inbox/mail", { method: "POST", body: JSON.stringify(body) });
const base = { provider: "yandex", user: "member@example.test", pass: "app-pass-123", folder: "ViktorychApp" };

test("off by default, and signed-in only", async () => {
  assert.equal((await handleMail(post(base), {}, deps([]))).status, 404);
  assert.equal((await handleMail(post(base), ON, deps([], {}, false))).status, 401);
  const st = await handleMail(new Request("https://accounts.test/v1/inbox/mail"), ON, deps([]));
  assert.equal(st.status, 200);
  assert.equal((await st.json()).enabled, true);
});

test("lists headers of only the chosen folder, read-only, and never stores anything", async () => {
  const log = [];
  const res = await handleMail(post(base), ON, deps(log));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("cache-control"), "no-store");
  const body = await res.json();
  assert.equal(body.uidvalidity, 77);
  assert.equal(body.messages.length, 2);
  assert.equal(body.messages[0].uid, 12);
  assert.equal(body.messages[1].from, "Яндекс");
  assert.equal(body.messages[1].subject, "Your code 482913");
  assert.equal(body.messages[1].seen, true);
  assert.equal(log[0], "CONNECT imap.yandex.com:993 on");
  assert.ok(log.some((l) => /^v\d+ EXAMINE "ViktorychApp"$/.test(l)));
  assert.ok(!log.some((l) => /\b(SELECT|LIST|LSUB|STORE|COPY|MOVE|EXPUNGE|DELETE|APPEND)\b/.test(l.split(" ").slice(1, 3).join(" "))));
  assert.ok(log.every((l) => !/BODY\[\]/.test(l)), "no bodies while listing");
});

test("refuses INBOX and folder tricks unless the member allowed INBOX", async () => {
  for (const folder of ["INBOX", "inbox", "*", "Work%", "a\r\nb", "", "x\"y"]) {
    const res = await handleMail(post(Object.assign({}, base, { folder })), ON, deps([]));
    assert.equal(res.status, 400, folder);
  }
  assert.equal(cleanFolder("INBOX", true), "INBOX");
  assert.equal((await handleMail(post(Object.assign({}, base, { provider: "evil.example" })), ON, deps([]))).status, 400);
});

test("codes only and filters run before any header is downloaded", async () => {
  const log = [];
  const res = await handleMail(post(Object.assign({}, base, { since: 5, uidvalidity: 77, filters: { codesOnly: true, from: ["noreply@example.test", "x@example.test"], days: 7 } })), ON, deps(log));
  const body = await res.json();
  assert.deepEqual(body.messages.map((m) => m.uid), [11]);
  const search = log.find((l) => / UID SEARCH /.test(l));
  assert.match(search, /UID 6:\* SINCE \d+-\w{3}-\d{4} \(OR FROM "noreply@example.test" FROM "x@example.test"\)/);
});

test("a body is fetched only when opened and decoded to text", async () => {
  const log = [];
  const res = await handleMail(post(Object.assign({}, base, { op: "body", uid: 11 })), ON, deps(log));
  const body = await res.json();
  assert.equal(body.text, "Your code is 482913\r\nThanks".replace(/\r\n/g, "\n"));
  assert.ok(log.some((l) => /UID FETCH 11 \(UID BODY\.PEEK\[\]<0\.\d+>\)/.test(l)));
});

test("a wrong app password or a missing folder are clear errors", async () => {
  assert.deepEqual(await (await handleMail(post(base), ON, deps([], { badLogin: true }))).json(), { error: "auth" });
  assert.deepEqual(await (await handleMail(post(base), ON, deps([], { noFolder: true }))).json(), { error: "folder" });
});

test("helpers", () => {
  assert.equal(utf7("Коды"), "&BBoEPgQ0BEs-");
  assert.equal(utf7("A&B"), "A&-B");
  assert.equal(decodeWords("=?utf-8?Q?Caf=C3=A9_ok?="), "Café ok");
  assert.deepEqual(splitFrom("\"Bank\" <no@example.test>"), { name: "Bank", address: "no@example.test" });
  assert.equal(searchQuery({ since: 0 }), "UID 1:*");
  assert.match(messageText("Content-Type: text/html\r\n\r\n<p>Code <b>1234</b></p><style>x{}</style>"), /Code 1234/);
});
