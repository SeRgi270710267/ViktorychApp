// Feeds › Add account with a Discord invite opens Add Discord with the invite
// filled in and looks it up. Placeholder codes only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

function load(owner) {
  const calls = [];
  const root = {
    t: (k) => k,
    ViktorychAccounts: {
      token: () => "tok",
      account: () => (owner ? { owner: true } : { owner: false }),
      call: (path) => {
        calls.push(path);
        if (path.indexOf("/v1/discord/picks/invite") === 0) return Promise.resolve({ status: 200, code: "sampleCode", url: "https://discord.gg/sampleCode", guild: { id: "100000000000000001", name: "Sample", icon: "" } });
        return Promise.resolve({ status: 200, catalog: { servers: [] }, picks: { servers: [] } });
      }
    }
  };
  root.window = root;
  vm.runInNewContext(readFileSync(new URL("../discord-picks.js", import.meta.url), "utf8"), { window: root, globalThis: root, Promise, setTimeout });
  return { picks: root.DiscordPicks, calls };
}

test("owner: pasted invite opens the sheet and looks it up", async () => {
  const { picks, calls } = load(true);
  assert.equal(picks.openInvite("https://discord.gg/sampleCode"), true);
  await new Promise((r) => setTimeout(r, 0));
  assert.ok(calls.some((p) => p === "/v1/discord/picks/invite?code=" + encodeURIComponent("https://discord.gg/sampleCode")));
  assert.equal(picks._state().open, true);
  assert.equal(picks._state().step, "invite");
  assert.ok(!calls.some((p) => p.indexOf("/join") >= 0), "never joins on its own");
});

test("non-owner: nothing opens, falls back to the toast", () => {
  const { picks, calls } = load(false);
  assert.equal(picks.openInvite("https://discord.gg/sampleCode"), false);
  assert.equal(calls.length, 0);
});
