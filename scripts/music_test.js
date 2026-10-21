/* SIntelMusic library rules. No document, no playback. */
const assert = require("assert");
const fs = require("fs");
const vm = require("vm");

const context = { console, URL };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync("music.js", "utf8"), context);
const L = context.MusicLogic;
assert.ok(L, "music.js exports MusicLogic without a document");
assert.strictEqual(typeof context.SIntelMusic.install, "function");

const src = fs.readFileSync("music.js", "utf8");
const css = fs.readFileSync("music.css", "utf8");
const data = fs.readFileSync("data/music.json", "utf8");
const logo = fs.readFileSync("logo/sintelmusic.svg", "utf8");
const si = fs.readFileSync("logo/si.svg", "utf8");
const siPath = si.slice(si.indexOf('d="') + 3, si.indexOf('"', si.indexOf('d="') + 3));
assert.ok(src.includes(siPath.slice(0, 40)), "the SI mark matches the sidebar logo");
assert.ok(src.includes("M 2510.2 991V 1661H 2330.2"), "the light run starts where SIntelApp starts");
assert.ok(src.includes("11430.20"), "the wordmark keeps the SI cap height");
assert.ok(src.includes("SIntelMusic"));
assert.ok(!src.includes("SuperintelMusic"));
assert.ok(!css.includes("SuperintelMusic"));
assert.ok(!data.includes("SuperintelMusic"));
assert.ok(!logo.includes("SuperintelMusic"));
assert.ok(logo.includes('aria-label="SIntelMusic"'));

assert.strictEqual(L.classifySource("http://example.com/a.mp3").ok, false);
assert.strictEqual(L.classifySource("javascript:alert(1)").ok, false);
assert.strictEqual(L.classifySource("https://user:pass@example.com/a.mp3").ok, false);
assert.strictEqual(L.classifySource("https://localhost/a.mp3").ok, false);
assert.strictEqual(L.classifySource("https://www.youtube.com/watch?v=dQw4w9WgXcQ").kind, "youtube");
assert.strictEqual(L.youtubeId("https://youtu.be/dQw4w9WgXcQ"), "dQw4w9WgXcQ");
const archive = L.classifySource("https://archive.org/download/example/tone.mp3");
assert.strictEqual(archive.kind, "audio");
assert.strictEqual(archive.publish, true);
assert.strictEqual(L.classifySource("https://archive.org/details/example").kind, "archive");
assert.strictEqual(L.classifySource("idb:song1:audio").publish, false);

const remote = {
  songs: [
    { id: "a", title: "A", artist: "One", source: "https://example.com/a.mp3", kind: "audio" },
    { id: "b", title: "B", artist: "Two", source: "https://example.com/b.mp3", kind: "audio" }
  ],
  playlists: [{ id: "p", name: "Remote", songIds: ["a"] }]
};
const merged = L.mergeLibrary(remote, { hidden: ["b"], edits: { a: { title: "Edited" } }, songs: [{ id: "c", title: "Local", artist: "", source: "idb:c:audio", kind: "audio" }], order: ["c", "a"] });
assert.strictEqual(merged.songs.map((song) => song.id).join(","), "c,a");
assert.strictEqual(merged.songs[1].title, "Edited");
assert.strictEqual(merged.playlists[0].name, "Remote");
const localLists = L.mergeLibrary(remote, { playlistTouched: true, playlists: [{ id: "mine", name: "Mine", songIds: [] }], songs: [] });
assert.strictEqual(localLists.playlists[0].id, "mine");
assert.strictEqual(localLists.playlists[1].id, "p");
assert.strictEqual(L.reorder(["a", "b", "c"], "a", "c").join(","), "b,c,a");
assert.strictEqual(L.formatTime(65), "1:05");
assert.strictEqual(L.sameSection({ name: "music", section: "home", id: "" }, "#/music"), true);
assert.strictEqual(L.sameSection({ name: "music", section: "home", id: "" }, "#/music/search"), false);
assert.strictEqual(L.sameSection({ name: "music", section: "home", id: "" }, "#/"), false);
assert.strictEqual(L.publishable(merged.songs).length, 1);

console.log("music tests ok");
