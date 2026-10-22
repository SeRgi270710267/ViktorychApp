/* stdin helper so the sync and the Worker share one live parser. */
import { parseRoomId, pickStreams } from "../shared/tiktok-live.js";

const cmd = process.argv[2] || "";
const chunks = [];
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const text = Buffer.concat(chunks).toString("utf8");
  let out = {};
  if (cmd === "room") out = { roomId: parseRoomId(text) };
  else {
    let info = {};
    try { info = JSON.parse(text || "{}"); }
    catch (err) { info = {}; }
    out = pickStreams(info);
  }
  process.stdout.write(JSON.stringify(out));
});
