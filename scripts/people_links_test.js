/* Per-reader merge overrides: platform toggles, merge with Undo, unmerge. Synthetic accounts only. */
const assert = require("assert");
require("../people.js");
const P=globalThis.FeedsPeople;
const S={settings:{follows:{}}, toasts:[]};
const feeds=[{id:"x:alpha_test",platform:"x",handle:"alpha_test",name:"Alpha Test",avatar:"https://pbs.twimg.com/profile_images/1/a.jpg",bio:"see youtube.com/@alphatube"},
 {id:"youtube:alphatube",platform:"youtube",handle:"alphatube",name:"Alpha Test",avatar:"https://yt3.googleusercontent.com/b"},
 {id:"threads:beta_t",platform:"threads",handle:"beta_t",name:"Beta"},{id:"instagram:beta_t",platform:"instagram",handle:"beta_t",name:"Beta"}];
P.bind({feeds:()=>feeds, links:()=>S.settings.peopleLinks, saveLinks:(n)=>{S.settings.peopleLinks=n;}, isFollowed:(id)=>!!S.settings.follows[id],
 follow:(ids,on)=>ids.forEach(i=>{ if(on) S.settings.follows[i]=1; else delete S.settings.follows[i];}), toastAction:(m,l,fn)=>S.toasts.push([m,l,fn]),
 tr:(k,v)=>k.replace(/\{(\w+)\}/g,(a,b)=>v&&v[b]!=null?v[b]:a), render:()=>{}, basePosts:()=>[]});
P.use({people:[{id:"p1",name:"Alpha Test",accounts:[{platform:"x",handle:"alpha_test",feedId:"x:alpha_test"},{platform:"youtube",handle:"alphatube",feedId:"youtube:alphatube"}]}]});
assert.strictEqual(P.evidence(feeds[0],feeds[1]),"strong"); assert.strictEqual(P.evidence(feeds[2],feeds[3]),"strong");
P.act("pm-plat",{dataset:{person:"p1",feed:"youtube:alphatube"}}); // not followed -> follow
assert.ok(S.settings.follows["youtube:alphatube"]);
P.act("pm-plat",{dataset:{person:"p1",feed:"youtube:alphatube"}}); // off
assert.deepStrictEqual(P.followIds("p1"),["x:alpha_test"]);
const post={platform:"youtube",handle:"alphatube",feedId:"youtube:alphatube",id:"v1"};
assert.ok(P.hidden(post), "an unfollowed platform is filtered");
const xp={platform:"x",handle:"alpha_test",feedId:"x:alpha_test",id:"1",crossPosts:[{platform:"youtube",feedId:"youtube:alphatube",statusId:"abcdefghijk"}]};
assert.ok(!P.hidden(xp), "a cross-post with a followed copy stays");
S.settings.follows["threads:beta_t"]=1;
P.afterFollow(["instagram:beta_t"]);
assert.ok(P.match("instagram","beta_t")); S.toasts.pop()[2](); assert.ok(!P.match("instagram","beta_t"));
P.act("pm-split",{dataset:{person:"p1"}}); assert.ok(!P.byId("p1"));
S.toasts.pop()[2](); assert.ok(P.byId("p1"), "unmerge can be undone");
console.log("people links ok");
