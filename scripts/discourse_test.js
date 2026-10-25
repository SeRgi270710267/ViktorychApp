// Test Discourse community mirroring & UI rendering in ViktorychApp
const fs = require('fs');
const path = require('path');
const assert = require('assert');

console.log('Testing Discourse community mirroring...');

// 1. Verify index.json has GrapheneOS
const indexFile = path.join(__dirname, '..', 'data', 'communities', 'index.json');
assert(fs.existsSync(indexFile), 'data/communities/index.json must exist');
const index = JSON.parse(fs.readFileSync(indexFile, 'utf8'));
const grapheneMeta = index.communities.find(c => c.name === 'grapheneos');
assert(grapheneMeta, 'grapheneos community must be in index.json');
assert.strictEqual(grapheneMeta.type, 'discourse', 'grapheneos type must be discourse');
assert(grapheneMeta.title.includes('GrapheneOS'), 'grapheneos title must include GrapheneOS');
console.log('✔ index.json has valid grapheneos entry');

// 2. Verify grapheneos.json data
const graphFile = path.join(__dirname, '..', 'data', 'communities', 'grapheneos.json');
assert(fs.existsSync(graphFile), 'data/communities/grapheneos.json must exist');
const grapheneDoc = JSON.parse(fs.readFileSync(graphFile, 'utf8'));
assert.strictEqual(grapheneDoc.name, 'grapheneos');
assert.strictEqual(grapheneDoc.type, 'discourse');
assert(Array.isArray(grapheneDoc.posts), 'posts must be an array');
assert(grapheneDoc.posts.length > 0, 'must have mirrored topics');

const topTopic = grapheneDoc.posts[0];
assert(topTopic.id, 'topic must have id');
assert(topTopic.title, 'topic must have title');
assert(topTopic.author, 'topic must have author');
assert(topTopic.category, 'topic must have category');
assert(topTopic.categoryColor, 'topic must have categoryColor');
assert(Array.isArray(topTopic.replies), 'topic must have replies array');
console.log(`✔ grapheneos.json contains ${grapheneDoc.posts.length} topics; top topic "${topTopic.title.slice(0, 30)}..." has ${topTopic.replies.length} replies`);

// 3. Verify communities.js has Discourse support
const communitiesJs = fs.readFileSync(path.join(__dirname, '..', 'communities.js'), 'utf8');
assert(communitiesJs.includes('isDiscourse'), 'communities.js must have isDiscourse helper');
assert(communitiesJs.includes('svgDiscourse'), 'communities.js must have svgDiscourse icon');
assert(communitiesJs.includes('discourseCard'), 'communities.js must have discourseCard topic renderer');
assert(communitiesJs.includes('categoryPills'), 'communities.js must have categoryPills');
assert(communitiesJs.includes('cm-d-stream'), 'communities.js must have cm-d-stream for Discourse post streams');
assert(communitiesJs.includes('sanitizeDiscourseHtml'), 'communities.js must sanitize Discourse HTML');
console.log('✔ communities.js implements Discourse forum visual rendering');

// 4. Verify communities.css has Discourse styles
const communitiesCss = fs.readFileSync(path.join(__dirname, '..', 'communities.css'), 'utf8');
assert(communitiesCss.includes('.cm-discourse-badge'), 'communities.css must have .cm-discourse-badge');
assert(communitiesCss.includes('.cm-d-topic-row'), 'communities.css must have .cm-d-topic-row');
assert(communitiesCss.includes('.cm-d-cat-bar'), 'communities.css must have .cm-d-cat-bar');
assert(communitiesCss.includes('.cm-d-stream'), 'communities.css must have .cm-d-stream');
assert(communitiesCss.includes('.cm-d-post'), 'communities.css must have .cm-d-post');
assert(communitiesCss.includes('.cm-d-badge.op'), 'communities.css must style OP badge');
console.log('✔ communities.css contains Discourse forum layout & theme rules');

// 5. Test Discourse rendering in a simulated DOM environment
global.window = {
  t: (k, vars) => {
    if (vars && vars.name) return k.replace('{name}', vars.name);
    return k;
  },
  VIKTORYCH_ACCOUNTS: { api: '', gate: false }
};
global.document = {
  addEventListener: () => {}
};
global.location = { hash: '#/communities' };
global.fetch = (url) => {
  if (url.includes('index.json')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(index) });
  }
  if (url.includes('grapheneos.json')) {
    return Promise.resolve({ ok: true, json: () => Promise.resolve(grapheneDoc) });
  }
  return Promise.resolve({ ok: false });
};

// Execute communities.js in context
eval(communitiesJs);
assert(global.window.ViktorychCommunities, 'ViktorychCommunities must be registered on window');

// First render initiates load
const loadingHtml = global.window.ViktorychCommunities.page({ name: 'communities' });
assert(typeof loadingHtml === 'string');

// After index loads, verify list page
setTimeout(() => {
  const listHtml = global.window.ViktorychCommunities.page({ name: 'communities' });
  assert(listHtml.includes('GrapheneOS'), 'list page must display GrapheneOS');
  assert(listHtml.includes('Discourse'), 'list page must display Discourse badge');

  // Test single community page
  global.window.ViktorychCommunities.page({ name: 'communities', sub: 'grapheneos' });
  setTimeout(() => {
    const commHtml = global.window.ViktorychCommunities.page({ name: 'communities', sub: 'grapheneos' });
    assert(commHtml.includes('GrapheneOS Discussion'), 'community page must display GrapheneOS title');
    assert(commHtml.includes('Discourse Forum'), 'community page must have Discourse Forum badge');
    assert(commHtml.includes('cm-d-cat-bar'), 'community page must have category pills bar');
    assert(commHtml.includes('cm-d-topic-row'), 'community page must display Discourse topic rows');
    assert(commHtml.includes(topTopic.title), 'community page must display top topic');

    // Test single thread page
    global.window.ViktorychCommunities.page({ name: 'communities', sub: 'grapheneos', post: String(topTopic.id) });
    const threadHtml = global.window.ViktorychCommunities.page({ name: 'communities', sub: 'grapheneos', post: String(topTopic.id) });
    assert(threadHtml.includes('cm-d-thread-header'), 'thread page must have Discourse thread header');
    assert(threadHtml.includes('cm-d-stream'), 'thread page must have Discourse post stream');
    assert(threadHtml.includes('#1'), 'thread page must display post #1');

    console.log('✔ simulated DOM rendering of Discourse communities & topics works seamlessly');
    console.log('All Discourse tests passed successfully!');
  }, 50);
}, 50);
