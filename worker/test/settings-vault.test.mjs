import assert from "node:assert/strict";
import test from "node:test";
import { sealPayload, openPayload, maybeBackupSettings, readSettingsBackup, vaultKey } from "../src/settings-vault.js";

function fakeEnv(rows) {
  const objects = new Map();
  return {
    ACCOUNT_PEPPER: "pepper-test",
    objects,
    DB: { prepare() { return { bind(offset) { return { async all() { return { results: rows.slice(offset, offset + 200) }; } }; } }; } },
    DATA: {
      async head(key) { return objects.has(key) ? {} : null; },
      async put(key, value) { objects.set(key, new Uint8Array(value)); },
      async get(key) { const v = objects.get(key); return v ? { async arrayBuffer() { return v.buffer.slice(v.byteOffset, v.byteOffset + v.byteLength); } } : null; },
      async list() { return { objects: Array.from(objects.keys()).map((key) => ({ key })) }; },
      async delete(key) { objects.delete(key); }
    }
  };
}

test("seal and open round-trip, and nothing is sealed without a secret", async () => {
  const env = fakeEnv([]);
  const sealed = await sealPayload(env, { mutedWords: ["a"], bells: { x: 1 }, appearance: "dim" });
  assert.equal(sealed.mutedWords, undefined);
  assert.equal(sealed.appearance, "dim");
  assert.match(sealed.sealed, /^v1:/);
  const opened = await openPayload(env, JSON.parse(JSON.stringify(sealed)));
  assert.deepEqual(opened.mutedWords, ["a"]);
  assert.deepEqual(opened.bells, { x: 1 });
  assert.equal(opened.sealed, undefined);
  const plain = await sealPayload({}, { mutedWords: ["a"] });
  assert.deepEqual(plain.mutedWords, ["a"]);
  const wrong = await openPayload({ ACCOUNT_PEPPER: "other" }, JSON.parse(JSON.stringify(sealed)));
  assert.equal(wrong.mutedWords, undefined, "a wrong key drops only the sealed part");
  assert.equal(wrong.appearance, "dim");
});

test("the daily settings backup is encrypted, readable with the key, and pruned", async () => {
  const env = fakeEnv([{ public_id: "user_a", payload: "{\"appearance\":\"dim\"}", updated_at: 5 }]);
  const at = Date.UTC(2026, 9, 28, 4, 47);
  env.objects.set("backups/settings/2026-10-01.json.gz.enc", new Uint8Array([1]));
  assert.equal(await maybeBackupSettings(env, Date.UTC(2026, 9, 28, 4, 46)), false, "only in its slot");
  assert.equal(await maybeBackupSettings(env, at), true);
  const key = vaultKey(at);
  const bytes = env.objects.get(key);
  assert.ok(bytes && Buffer.from(bytes).indexOf("appearance") < 0, "the object is not plaintext");
  const back = await readSettingsBackup(env, key);
  assert.equal(back.rows[0].id, "user_a");
  assert.equal(back.rows[0].payload, "{\"appearance\":\"dim\"}");
  assert.equal(env.objects.has("backups/settings/2026-10-01.json.gz.enc"), false, "old copies are pruned");
  assert.equal(await maybeBackupSettings(env, at), false, "once a day");
  assert.equal(await maybeBackupSettings({ DB: env.DB, DATA: env.DATA }, at, true), false, "no secret, no backup");
});
