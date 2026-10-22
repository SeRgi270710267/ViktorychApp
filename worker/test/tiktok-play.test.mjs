import assert from "node:assert/strict";
import test from "node:test";
import { describeTikTok, pickPlayUrl } from "../../shared/tiktok-play.js";

const PAGE = `<!doctype html><script id="__UNIVERSAL_DATA_FOR_REHYDRATION__" type="application/json">${JSON.stringify({
  __DEFAULT_SCOPE__: {
    "webapp.video-detail": {
      statusCode: 0,
      itemInfo: {
        itemStruct: {
          video: {
            playAddr: "https://v16-webapp-prime.us.tiktok.com/video/default.mp4",
            codecType: "h264",
            bitrateInfo: [
              { CodecType: "h265", PlayAddr: { Height: 1280, UrlList: ["https://v16-webapp-prime.us.tiktok.com/video/hevc.mp4"] } },
              { CodecType: "h264", PlayAddr: { Height: 720, UrlList: ["https://v16-webapp-prime.us.tiktok.com/video/h264-low.mp4"] } },
              { CodecType: "h264", PlayAddr: { Height: 1080, UrlList: ["https://v16-webapp-prime.us.tiktok.com/video/h264.mp4"] } }
            ]
          }
        }
      }
    }
  }
})}</script>`;

test("play url prefers the tallest h264 address", () => {
  assert.equal(pickPlayUrl(PAGE), "https://v16-webapp-prime.us.tiktok.com/video/h264.mp4");
  assert.equal(pickPlayUrl("<html></html>"), "");
});

test("a blocked TikTok response is described without calling it a success", () => {
  const blocked = describeTikTok(403, "text/html", "<html>captcha-verify</html>");
  assert.equal(blocked.captcha, true);
  assert.match(blocked.detail, /403/);
  assert.match(blocked.detail, /captcha/);
  const ok = describeTikTok(200, "text/html; charset=utf-8", PAGE);
  assert.equal(ok.captcha, false);
  assert.equal(ok.tiktokType, "text/html");
});
