/* Parse and sort a feed snapshot off the main thread.
   The same UTC comparison the tabs use stays in shared/feed-order.js. */
import { compare, key } from "./shared/feed-order.js";

export function orderFeedDoc(doc) {
  if (!doc || !Array.isArray(doc.posts)) return doc || null;
  const seen = new Set();
  const posts = [];
  doc.posts.forEach((post) => {
    if (!post) return;
    const id = key(post);
    if (!id || seen.has(id)) return;
    seen.add(id);
    posts.push(post);
  });
  posts.sort(compare);
  return Object.assign({}, doc, { posts: posts });
}

const inWorker = typeof WorkerGlobalScope !== "undefined" && typeof self !== "undefined" && self instanceof WorkerGlobalScope;

if (inWorker) {
  self.onmessage = (event) => {
    const data = event.data || {};
    let doc = null;
    try {
      doc = data.text ? JSON.parse(data.text) : data.doc;
    } catch (err) {
      doc = null;
    }
    let next = null;
    try { next = orderFeedDoc(doc); }
    catch (err) { next = doc; }
    self.postMessage({ id: data.id, doc: next });
  };
}
