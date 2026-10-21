/* X-style reader. Timelines come from feeds.json plus monthly archive stubs on the data branch. X replies, YouTube comments, and old-post details load live in the browser. */
(function () {
  const KEY = "rss-feeds-settings-v1";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const COLORS = ["#1d9bf0", "#7856ff", "#f91880", "#00ba7c", "#ff7a00", "#333639"];
  const PLATFORM = { x: "X", threads: "Threads", instagram: "Instagram", rss: "RSS", youtube: "YouTube" };

  const PATH = {
    logo: "M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z",
    home: "M21.591 7.146L12.52 1.157c-.316-.21-.724-.21-1.04 0l-9.071 5.99c-.26.173-.409.456-.409.757v13.183c0 .502.418.913.929.913h6.638v-7.075h4.874v7.075h6.639c.51 0 .928-.41.928-.913V7.904c0-.301-.158-.584-.408-.758zM20 20.044h-4.153v-7.075h-7.694v7.075H4V8.31l8-5.31 8 5.31v11.734z",
    homeOn: "M21.591 7.146L12.52 1.157c-.316-.21-.724-.21-1.04 0l-9.071 5.99c-.26.173-.409.456-.409.757v13.183c0 .502.418.913.929.913H9.14a.93.93 0 0 0 .929-.913v-7.075h3.909v7.075c0 .502.417.913.928.913h5.653c.51 0 .929-.41.929-.913V7.904c0-.301-.158-.584-.408-.758z",
    search: "M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5c1.795 0 3.419-.726 4.596-1.904 1.178-1.177 1.904-2.801 1.904-4.596 0-3.59-2.91-6.5-6.5-6.5zm-8.5 6.5c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5c0 1.986-.682 3.815-1.824 5.262l4.781 4.781-1.414 1.414-4.781-4.781c-1.447 1.142-3.276 1.824-5.262 1.824-4.694 0-8.5-3.806-8.5-8.5z",
    bell: "M19.993 9.042C19.48 5.017 16.054 2 11.996 2s-7.49 3.021-7.999 7.051L2.866 18H7.1c.463 2.282 2.481 4 4.9 4s4.437-1.718 4.9-4h4.236l-1.143-8.958zM12 20c-1.306 0-2.417-.835-2.829-2h5.658c-.412 1.165-1.523 2-2.829 2zm-6.866-4l.847-6.698C6.364 6.272 8.941 4 11.996 4s5.627 2.268 6.013 5.295L18.864 16H5.134z",
    mail: "M1.998 5.5c0-1.381 1.119-2.5 2.5-2.5h15c1.381 0 2.5 1.119 2.5 2.5v13c0 1.381-1.119 2.5-2.5 2.5h-15c-1.381 0-2.5-1.119-2.5-2.5v-13zm2.5-.5c-.276 0-.5.224-.5.5v2.764l8 3.638 8-3.636V5.5c0-.276-.224-.5-.5-.5h-15zm15.5 5.463l-8 3.636-8-3.638V18.5c0 .276.224.5.5.5h15c.276 0 .5-.224.5-.5v-8.037z",
    spark: "M12 2.2l1.7 5.4 5.5 1.5-5.5 1.6L12 16.2l-1.7-5.5L4.8 9.1l5.5-1.5L12 2.2zM18.2 13.2l.8 2.4 2.5.7-2.5.7-.8 2.5-.8-2.5-2.4-.7 2.4-.7.8-2.4z",
    lists: "M3 5.5C3 4.12 4.12 3 5.5 3h13C19.88 3 21 4.12 21 5.5v13c0 1.38-1.12 2.5-2.5 2.5h-13C4.12 21 3 19.88 3 18.5v-13zM5.5 5c-.28 0-.5.22-.5.5v13c0 .28.22.5.5.5h13c.28 0 .5-.22.5-.5v-13c0-.28-.22-.5-.5-.5h-13zM7 8h10v2H7V8zm0 4h10v2H7v-2zm0 4h7v2H7v-2z",
    bookmark: "M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z",
    subs: "M4 5.5C4 4.12 5.12 3 6.5 3h11C18.88 3 20 4.12 20 5.5v13c0 1.38-1.12 2.5-2.5 2.5h-11C5.12 21 4 19.88 4 18.5v-13zM6.5 5c-.28 0-.5.22-.5.5v13c0 .28.22.5.5.5h11c.28 0 .5-.22.5-.5v-13c0-.28-.22-.5-.5-.5h-11zM10 8.2v7.6l6-3.8-6-3.8z",
    grid: "M4 4h7v7H4V4zm9 0h7v7h-7V4zM4 13h7v7H4v-7zm9 0h7v7h-7v-7z",
    rows: "M4 5h16v3H4V5zm0 5.5h16v3H4v-3zM4 16h16v3H4v-3z",
    thumb: "M2 9.5C2 8.12 3.12 7 4.5 7H8l1.2-1.6c.3-.4.8-.6 1.3-.6h3c.5 0 1 .2 1.3.6L16 7h3.5C20.88 7 22 8.12 22 9.5v7c0 1.38-1.12 2.5-2.5 2.5h-15C3.12 19 2 17.88 2 16.5v-7zm8.2 1.1 4.3 2.5-4.3 2.5v-5z",
    thumbDown: "M22 14.5c0 1.38-1.12 2.5-2.5 2.5H16l-1.2 1.6c-.3.4-.8.6-1.3.6h-3c-.5 0-1-.2-1.3-.6L8 17H4.5C3.12 17 2 15.88 2 14.5v-7C2 6.12 3.12 5 4.5 5h15C20.88 5 22 6.12 22 7.5v7zM13.8 13.4 9.5 10.9v5l4.3-2.5z",
    bookmarkOn: "M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5z",
    more: "M3 12c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2zm9 2c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm7 0c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2z",
    reply: "M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z",
    repost: "M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z",
    heart: "M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z",
    heartOn: "M20.884 13.19c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z",
    views: "M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z",
    share: "M12 2.59l5.7 5.7-1.41 1.42L13 6.41V16h-2V6.41l-3.3 3.3-1.41-1.42L12 2.59zM21 15l-.02 3.51c0 1.38-1.12 2.49-2.5 2.49H5.5C4.11 21 3 19.88 3 18.5V15h2v3.5c0 .28.22.5.5.5h12.98c.28 0 .5-.22.5-.5L19 15h2z",
    check: "M20.396 11c-.018-.646-.215-1.275-.57-1.816-.354-.54-.852-.972-1.438-1.246.223-.607.27-1.264.14-1.897-.131-.634-.437-1.218-.882-1.687-.47-.445-1.053-.75-1.687-.882-.633-.13-1.29-.083-1.897.14-.273-.587-.704-1.086-1.245-1.44S11.647 1.62 11 1.604c-.646.017-1.273.213-1.813.568s-.969.854-1.24 1.44c-.608-.223-1.267-.272-1.902-.14-.635.13-1.22.436-1.69.882-.445.47-.749 1.055-.878 1.688-.13.633-.08 1.29.144 1.896-.587.274-1.087.705-1.443 1.245-.356.54-.555 1.17-.574 1.817.02.647.218 1.276.574 1.817.356.54.856.972 1.443 1.245-.224.606-.274 1.263-.144 1.896.13.634.433 1.218.877 1.688.47.443 1.054.747 1.687.878.633.132 1.29.084 1.897-.136.274.586.705 1.084 1.246 1.439.54.354 1.17.551 1.816.569.647-.016 1.276-.213 1.817-.567s.972-.854 1.245-1.44c.604.222 1.261.27 1.894.139.634-.13 1.22-.435 1.689-.882.445-.47.749-1.055.878-1.688.132-.633.084-1.29-.139-1.896.586-.274 1.084-.705 1.438-1.246.354-.54.551-1.17.569-1.816zM9.662 14.85l-3.429-3.428 1.293-1.302 2.072 2.072 4.4-4.794 1.347 1.246z",
    back: "M7.414 13l5.043 5.04-1.414 1.42L3.586 12l7.457-7.46 1.414 1.42L7.414 11H21v2H7.414z",
    close: "M10.59 12 4.54 5.96l1.42-1.42L12 10.59l6.04-6.05 1.42 1.42L13.41 12l6.05 6.04-1.42 1.42L12 13.41l-6.04 6.05-1.42-1.42L10.59 12z",
    plus: "M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7V4z",
    play: "M8 5v14l11-7z",
    pin: "M16 3H8v2l1 5-3 3v2h5v6l1 1 1-1v-6h5v-2l-3-3 1-5V3z",
    loc: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5 2.5 2.5 0 0 1 12 11.5z",
    link: "M10.6 13.4a1 1 0 0 1 0-1.4l3.4-3.4a2.5 2.5 0 0 1 3.5 3.5l-1.8 1.8-1.4-1.4 1.8-1.8a.5.5 0 0 0-.7-.7l-3.4 3.4a.5.5 0 0 0 0 .7l.2.2-1.4 1.4-.2-.3zm2.8-2.8 1.4 1.4-3.4 3.4a.5.5 0 0 1-.7-.7l1.3-1.3-1.4-1.4-1.3 1.3a2.5 2.5 0 0 0 3.5 3.5l3.4-3.4a2.5 2.5 0 0 0-3.5-3.5l-.3.3z",
    external: "M10 6H5.5C4.12 6 3 7.12 3 8.5v10C3 19.88 4.12 21 5.5 21h10c1.38 0 2.5-1.12 2.5-2.5V14h-2v4.5c0 .28-.22.5-.5.5h-10a.5.5 0 0 1-.5-.5v-10c0-.28.22-.5.5-.5H10V6zm4 0V4h7v7h-2V7.41l-7.29 7.3-1.42-1.42L17.58 6H14z",
    cal: "M7 2h2v2h6V2h2v2h3v16H4V4h3V2zm13 6H4v10h16V8z",
    ig: "M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zm5 4.2A4.8 4.8 0 1 0 16.8 12 4.8 4.8 0 0 0 12 7.2zm6.3-.8a1.15 1.15 0 1 0 1.15 1.15A1.15 1.15 0 0 0 18.3 6.4zM12 9.3A2.7 2.7 0 1 1 9.3 12 2.7 2.7 0 0 1 12 9.3z",
    threads: "M12.2 3C7.8 3 4.6 6.2 4.6 10.8c0 2.3.8 4.3 2.2 5.8l-1 3.2 3.3-1.2c.9.3 1.9.5 2.9.5 4.5 0 7.8-3.2 7.8-7.6C19.8 6.4 16.6 3 12.2 3zm0 2.2c3.2 0 5.4 2.3 5.4 5.5 0 1.5-.5 2.8-1.4 3.8-.3-2.3-1.8-4-4-4.6.8-.4 1.3-1.1 1.3-2 0-1.3-1.1-2.2-2.6-2.2-1.7 0-2.9 1.1-3.1 2.7H6.2c.3-2.6 2.6-4.6 5.9-4.6-.1 0 .1 0 .1 1.4zm-.4 4.2c1.6.2 2.8 1.3 3.1 3-.6.5-1.4.8-2.3.8-1.5 0-2.6-.8-3-2 .7-.3 1.4-.6 2.2-.8z",
    rss: "M6 17.5A1.5 1.5 0 1 1 4.5 16 1.5 1.5 0 0 1 6 17.5zM4 11a7 7 0 0 1 7 7h-2a5 5 0 0 0-5-5v-2zm0-4a11 11 0 0 1 11 11h-2A9 9 0 0 0 4 9V7z",
    feather: "M22 3.2c-5.8 0-9.4 2.2-12 5.6C8.2 11.4 7.2 15 7 19h2.1c.2-2.6.8-4.8 2-6.2 1 .2 2.1.5 3.2.9l-2.1 3.1h2.2l1.5-2.2c1.7.4 3.4.7 5.2 1 .2-.7.4-1.4.5-2.1-.9-.2-1.7-.4-2.5-.6 2-1.5 3.8-3.5 5-5.9-.3 0-.6-.1-1-.1z",
    pip: "M4 6.5C4 5.12 5.12 4 6.5 4h11C18.88 4 20 5.12 20 6.5v11c0 1.38-1.12 2.5-2.5 2.5h-11C5.12 20 4 18.88 4 17.5v-11zM6.5 6A.5.5 0 0 0 6 6.5v11c0 .28.22.5.5.5h11a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5h-11zM10 12h8v6h-8v-6z"
  };

  const STATE = {
    data: null,
    error: null,
    loading: true,
    settings: null,
    expanded: {},
    modal: null,
    draft: {},
    menu: null,
    drawer: false,
    headerHidden: false,
    confirm: null,
    replies: {},
    liveUsers: {},
    replyUi: {},
    subsLayout: "grid",
    commentSort: {},
    threadsOpen: {},
    playerAlt: {},
    disliked: {},
    share: null,
    shared: {},
    sharedState: {},
    chain: {},
    threadMore: {},
    focusId: "",
    replySort: "relevant",
    forceReply: "",
    forceWatch: "",
    replyEpoch: {},
    pendingFeed: null,
    installPrompt: null,
    incoming: null,
    scrollKey: ""
  };
  const SCROLLS = {};
  const THEME_COLORS = { default: "#ffffff", dim: "#15202b", lightsout: "#000000" };

  const icon = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PATH[name]}"/></svg>`;

  function esc(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  function feeds() { return (STATE.data && STATE.data.feeds) || []; }

  const ARCHIVE = { order: [], loaded: {}, posts: [] };
  const HYDRATED = {};
  const HYDRATE_MISS = {};
  const HYDRATE_FLIGHT = {};
  let HYDRATE_OBS = null;
  let ARCHIVE_OBS = null;
  let archiveBusy = false;
  const HYDRATE_TTL = 24 * 60 * 60 * 1000;
  const ARCHIVE_RAW = "https://raw.githubusercontent.com/owner-account/rss-feeds/data/archive/";
  const ARCHIVE_CDN = "https://cdn.jsdelivr.net/gh/owner-account/rss-feeds@data/archive/";
  const ARCHIVE_IA = "https://archive.org/download/sergi-rss-feeds-archive/archive/";

  function canonicalId(post) {
    const platform = (post && post.platform) || "";
    const raw = String((post && (post.statusId || post.id)) || "");
    const url = String((post && post.url) || "");
    if (platform === "instagram") {
      const match = (url.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/) || raw.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/) || [])[1];
      if (match) return match;
    }
    if (platform === "threads") {
      const match = (url.match(/threads\.(?:com|net)\/(?:@[^/]+\/)?(?:post|t)\/([A-Za-z0-9_-]+)/) || raw.match(/threads\.(?:com|net)\/(?:@[^/]+\/)?(?:post|t)\/([A-Za-z0-9_-]+)/) || [])[1];
      if (match) return match;
    }
    return raw;
  }

  function postIdentity(post) {
    return ((post && post.platform) || "") + ":" + canonicalId(post);
  }

  function sourceUrl(platform, handle, id) {
    if (platform === "x" && handle && id) return "https://x.com/" + handle + "/status/" + id;
    if (platform === "instagram" && id) return "https://www.instagram.com/p/" + id + "/";
    if (platform === "threads" && id) return "https://www.threads.net/t/" + id;
    if (platform === "youtube" && id) {
      if (String(id).length !== 11) return "https://www.youtube.com/post/" + id;
      return "https://www.youtube.com/watch?v=" + id;
    }
    return "";
  }

  function stubMedia(platform, id, pageUrl) {
    if (platform === "youtube") {
      const poster = "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg";
      return [{ type: "photo", url: poster, poster: poster }];
    }
    if (platform === "instagram") {
      return [{ type: "embed", url: "https://www.instagram.com/p/" + id + "/embed/", title: "Instagram", open: pageUrl }];
    }
    if (platform === "threads") {
      return [{ type: "embed", url: "https://www.threads.net/t/" + id + "/embed", title: "Threads", open: pageUrl }];
    }
    return [];
  }

  function expandStub(row) {
    if (!row || !row.p || !row.id) return null;
    const platform = String(row.p);
    const id = String(row.id);
    const handle = String(row.h || "");
    const community = row.k === "community";
    const url = community ? "https://www.youtube.com/post/" + id : sourceUrl(platform, handle, id);
    return {
      id: id,
      statusId: id,
      platform: platform,
      handle: handle,
      author: handle,
      feedId: platform + ":" + handle,
      kind: row.k || "post",
      text: row.t || "",
      date: row.d || "",
      url: url,
      media: community ? [] : stubMedia(platform, id, url),
      stub: true
    };
  }

  function posts() {
    const full = (STATE.data && STATE.data.posts) || [];
    const seen = {};
    full.forEach((post) => { seen[postIdentity(post)] = true; });
    const extra = ARCHIVE.posts.filter((post) => !seen[postIdentity(post)]).map((post) => HYDRATED[postIdentity(post)] || post);
    return full.concat(extra);
  }

  function loadSettings() {
    const configured = feeds().filter((f) => f.configured).map((f) => f.id);
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) {
        return { version: 1, initialized: true, follows: configured, lists: [], likes: {}, bookmarks: {}, reposts: {}, savedPosts: {}, appearance: "lightsout", notify: false };
      }
      const parsed = JSON.parse(raw);
      parsed.follows = Array.isArray(parsed.follows) ? parsed.follows : configured;
      parsed.lists = Array.isArray(parsed.lists) ? parsed.lists : [];
      parsed.likes = parsed.likes || {};
      parsed.bookmarks = parsed.bookmarks || {};
      parsed.reposts = parsed.reposts || {};
      parsed.savedPosts = parsed.savedPosts || {};
      if (!parsed.appearance) parsed.appearance = "lightsout";
      if (parsed.notify !== true) parsed.notify = false;
      if (!parsed.initialized) {
        parsed.follows = configured;
        parsed.initialized = true;
      }
      return parsed;
    } catch (err) {
      return { version: 1, initialized: true, follows: configured, lists: [], likes: {}, bookmarks: {}, reposts: {}, savedPosts: {}, appearance: "lightsout", notify: false };
    }
  }

  function saveSettings() {
    localStorage.setItem(KEY, JSON.stringify(STATE.settings));
    syncWorkerState();
  }

  function isFollowed(id) { return STATE.settings.follows.includes(id); }
  function feedById(id) { return feeds().find((f) => f.id === id); }

  function profileHash(platform, handle) {
    if (!handle) return "#/";
    if ((platform || "x") === "x") return `#/@${encodeURIComponent(handle)}`;
    return `#/${encodeURIComponent(platform)}/${encodeURIComponent(handle)}`;
  }
  function userHash(platform, handle) {
    if (!handle) return "#/";
    return "#/u/" + encodeURIComponent(platform || "x") + "/" + encodeURIComponent(handle);
  }
  function statusHash(post) {
    const platform = post.platform || "x";
    const handle = post.handle || "";
    const id = post.statusId || post.id;
    if (platform === "x") return `#/@${encodeURIComponent(handle)}/status/${encodeURIComponent(id)}`;
    return `#/${encodeURIComponent(platform)}/${encodeURIComponent(handle)}/status/${encodeURIComponent(id)}`;
  }

  function sitePermalink(hash) {
    const url = new URL(location.href);
    if (url.pathname.endsWith("/index.html")) url.pathname = url.pathname.slice(0, -"index.html".length);
    url.search = "";
    const clean = hash.startsWith("#") ? hash : "#" + hash;
    return url.origin + url.pathname + clean;
  }

  function findFeed(platform, handle) {
    const h = (handle || "").toLowerCase();
    return feeds().find((f) => f.platform === platform && (f.handle || "").toLowerCase() === h);
  }

  function sameAuthor(post, feed) {
    return post && feed && post.platform === feed.platform && (post.handle || "").toLowerCase() === (feed.handle || "").toLowerCase();
  }

  function asPost(quoted, platform) {
    return Object.assign({ platform: platform || "x", kind: "post", feedId: "" }, quoted);
  }

  function postsFor(feed) {
    const out = [];
    const seen = new Set();
    function add(post) {
      const key = (post.platform || "") + ":" + (post.statusId || post.id);
      if (seen.has(key)) return;
      seen.add(key);
      out.push(post);
    }
    posts().forEach((post) => {
      if (post.feedId === feed.id || sameAuthor(post, feed)) add(post);
      if (post.quoted && sameAuthor(post.quoted, feed)) add(asPost(post.quoted, post.quoted.platform || "x"));
    });
    return out.sort(byStamp);
  }

  function findPost(platform, handle, id) {
    const shared = STATE.shared[String(id)];
    if (shared) return shared;
    const h = (handle || "").toLowerCase();
    const all = posts();
    const direct = all.find((p) => (p.platform === platform) && String(p.statusId || p.id) === String(id) && (!h || (p.handle || "").toLowerCase() === h))
      || all.find((p) => String(p.id) === String(id) || String(p.statusId) === String(id));
    if (direct) return direct;
    const byCode = all.find((p) => canonicalId(p) === String(id) && (!platform || p.platform === platform) && (!h || (p.handle || "").toLowerCase() === h));
    if (byCode) return byCode;
    for (const post of all) {
      if (post.quoted && String(post.quoted.statusId || post.quoted.id) === String(id)) return asPost(post.quoted, post.quoted.platform || platform || "x");
    }
    const buckets = Object.keys(STATE.replies);
    for (let i = 0; i < buckets.length; i++) {
      const list = (STATE.replies[buckets[i]] && STATE.replies[buckets[i]].replies) || [];
      for (let j = 0; j < list.length; j++) {
        const reply = list[j];
        if (String(reply.statusId || reply.id) !== String(id)) continue;
        if (h && (reply.handle || "").toLowerCase() !== h) continue;
        if (platform && reply.platform && reply.platform !== platform) continue;
        return reply;
      }
    }
    return null;
  }

  function stamp(post) { return post.sortDate || post.date || ""; }
  function byStamp(a, b) { return stamp(a) < stamp(b) ? 1 : stamp(a) > stamp(b) ? -1 : 0; }

  function formatCount(n) {
    n = Number(n);
    if (!isFinite(n)) return "";
    const abs = Math.abs(n);
    const trim = (v) => {
      const s = (Math.round(v * 10) / 10).toFixed(1);
      return s.endsWith(".0") ? s.slice(0, -2) : s;
    };
    if (abs < 10000) return Math.trunc(n).toLocaleString("en-US");
    if (abs < 1e6) return trim(n / 1e3) + "K";
    if (abs < 1e9) return trim(n / 1e6) + "M";
    return trim(n / 1e9) + "B";
  }

  function shownCount(value, extra) {
    if (value == null && !extra) return "";
    const n = (value == null ? 0 : Number(value)) + (extra || 0);
    if (!n) return "";
    return formatCount(n);
  }

  function relTime(iso) {
    const then = new Date(iso).getTime();
    if (!then) return "";
    const sec = Math.max(0, (Date.now() - then) / 1000);
    if (sec < 60) return Math.max(1, Math.floor(sec)) + "s";
    if (sec < 3600) return Math.floor(sec / 60) + "m";
    if (sec < 86400) return Math.floor(sec / 3600) + "h";
    const d = new Date(iso);
    if (d.getFullYear() === new Date().getFullYear()) return MONTHS[d.getMonth()] + " " + d.getDate();
    return MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
  }

  function fullTime(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    let h = d.getHours();
    const am = h >= 12 ? "PM" : "AM";
    h = h % 12 || 12;
    const min = String(d.getMinutes()).padStart(2, "0");
    return h + ":" + min + " " + am + " · " + MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
  }

  function joinedLabel(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return "Joined " + MONTHS_LONG[d.getMonth()] + " " + d.getFullYear();
  }

  function initials(name) {
    const t = (name || "?").trim();
    return esc(t.slice(0, 1).toUpperCase() || "?");
  }

  function avatar(src, name, cls) {
    const letter = initials(name);
    const extra = cls ? " " + cls : "";
    if (!src) return `<span class="ava initials${extra}">${letter}</span>`;
    return `<img class="ava${extra}" src="${esc(src)}" alt="" loading="lazy" referrerpolicy="no-referrer" data-fallback="avatar" data-initials="${letter}">`;
  }

  function badge(type) {
    if (!type || type === "none") return "";
    const cls = type === "business" ? "business" : type === "government" ? "government" : "blue";
    const label = cls === "business" ? "Verified business" : cls === "government" ? "Verified government" : "Verified";
    return `<span class="vbadge ${cls}" title="${label}">${icon("check")}</span>`;
  }

  function sourceBadge(platform) {
    if (!platform || platform === "x") return "";
    const name = platform === "instagram" ? "ig" : platform === "threads" ? "threads" : platform === "youtube" ? "subs" : "rss";
    return `<span class="src" title="${esc(PLATFORM[platform] || "RSS")}">${icon(name)}</span>`;
  }

  function externalProfile(feed) {
    if (feed.url) return feed.url;
    if (feed.platform === "x") return "https://x.com/" + feed.handle;
    if (feed.platform === "threads") return "https://www.threads.com/@" + feed.handle;
    if (feed.platform === "instagram") return "https://www.instagram.com/" + feed.handle + "/";
    if (feed.platform === "youtube") return "https://www.youtube.com/@" + feed.handle;
    return feed.url || "#";
  }

  function mentionHref(user, platform) {
    if (platform === "instagram") return "https://www.instagram.com/" + user + "/";
    if (platform === "threads") return "https://www.threads.com/@" + user;
    return "https://x.com/" + user;
  }
  function hashHref(tag, platform) {
    const clean = encodeURIComponent(tag);
    if (platform === "instagram") return "https://www.instagram.com/explore/tags/" + clean + "/";
    if (platform === "threads") return "https://www.threads.com/search?q=" + encodeURIComponent("#" + tag);
    return "https://x.com/hashtag/" + clean;
  }

  function linkify(text, links, platform) {
    const src = String(text || "");
    const known = (links || []).filter((l) => l && l.expanded);
    let i = 0;
    let html = "";
    const anchorHits = known.filter((l) => l.anchorText && l.anchorText !== l.expanded);
    while (i < src.length) {
      const hit = known.find((l) => src.startsWith(l.expanded, i));
      if (hit) {
        html += `<a class="entity" data-act="stop" target="_blank" rel="noopener noreferrer" href="${esc(hit.expanded)}">${esc(hit.display || hit.expanded)}</a>`;
        i += hit.expanded.length;
        continue;
      }
      const anchored = anchorHits.find((l) => l.anchorText && src.startsWith(l.anchorText, i));
      if (anchored) {
        html += `<a class="entity" data-act="stop" target="_blank" rel="noopener noreferrer" href="${esc(anchored.expanded)}">${esc(anchored.anchorText)}</a>`;
        i += anchored.anchorText.length;
        continue;
      }
      if (src.startsWith("http://", i) || src.startsWith("https://", i)) {
        const m = src.slice(i).match(/^https?:\/\/[^\s]+/);
        if (m) {
          let href = m[0].replace(/[),.;!?]+$/g, "");
          const trail = m[0].slice(href.length);
          const shown = href.replace(/^https?:\/\//, "");
          const label = shown.length > 30 ? shown.slice(0, 27) + "…" : shown;
          html += `<a class="entity" data-act="stop" target="_blank" rel="noopener noreferrer" href="${esc(href)}">${esc(label)}</a>` + esc(trail);
          i += m[0].length;
          continue;
        }
      }
      const mention = src.slice(i).match(/^@([A-Za-z0-9_]{1,30})/);
      if (mention && (i === 0 || !/[A-Za-z0-9_]/.test(src[i - 1]))) {
        html += `<a class="entity" data-act="stop" data-card="${esc((platform || "x") + ":" + mention[1])}" href="${esc(userHash(platform || "x", mention[1]))}">@${esc(mention[1])}</a>`;
        i += mention[0].length;
        continue;
      }
      const hash = src.slice(i).match(/^#([A-Za-z0-9_]{1,50})/);
      if (hash && (i === 0 || /\s/.test(src[i - 1]))) {
        html += `<a class="entity" data-act="stop" target="_blank" rel="noopener noreferrer" href="${esc(hashHref(hash[1], platform))}">#${esc(hash[1])}</a>`;
        i += hash[0].length;
        continue;
      }
      const cash = src.slice(i).match(/^\$([A-Za-z]{1,10})\b/);
      if (cash) {
        html += `<a class="entity" data-act="stop" target="_blank" rel="noopener noreferrer" href="https://x.com/search?q=%24${esc(cash[1])}&src=cashtag_click">$${esc(cash[1])}</a>`;
        i += cash[0].length;
        continue;
      }
      html += esc(src[i]);
      i += 1;
    }
    return html;
  }

  function textHtml(post, key, full) {
    const text = post.text || "";
    if (full || STATE.expanded[key] || text.length <= 280) return linkify(text, post.links, post.platform);
    let cut = text.slice(0, 280);
    const sp = cut.lastIndexOf(" ");
    if (sp > 220) cut = cut.slice(0, sp);
    return linkify(cut, post.links, post.platform) + ` <button class="show-more" data-act="more" data-key="${esc(key)}">Show more</button>`;
  }

  function mediaHtml(items, eager) {
    const list = (items || []).filter((m) => m && (m.url || m.poster || m.type === "embed" || m.type === "placeholder")).slice(0, 4);
    if (!list.length) return "";
    if (list.length === 1 && list[0].type === "embed") {
      const embed = list[0];
      const open = embed.open ? `<a class="open-original" data-act="stop" target="_blank" rel="noopener noreferrer" href="${esc(embed.open)}">Open original</a>` : "";
      return `<div class="media m1 embed-media"><div class="tile embed-tile"><iframe src="${esc(embed.url)}" title="${esc(embed.title || "Post")}" loading="lazy"></iframe>${open}</div></div>`;
    }
    if (list.length === 1 && list[0].type === "placeholder") {
      return `<div class="media m1"><div class="tile broken"><a class="open-original" data-act="stop" target="_blank" rel="noopener noreferrer" href="${esc(list[0].url || "#")}">Open original</a></div></div>`;
    }
    const n = list.length;
    const cls = n === 1 ? "m1" : n === 2 ? "m2" : n === 3 ? "m3" : "m4";
    const tiles = list.map((m, index) => {
      const alt = m.alt ? `<span class="alt-badge">ALT</span>` : "";
      const gif = m.type === "animated_gif" ? `<span class="gif-badge">GIF</span>` : "";
      const refresh = m.fallback ? ` data-refresh="${esc(m.fallback)}"` : "";
      const first = eager && index === 0;
      if (m.type === "photo" || !m.url || m.url === m.poster || /youtube-nocookie\.com|\/embed\//.test(m.url)) {
        const src = /youtube-nocookie\.com|\/embed\//.test(m.url || "") ? (m.poster || "") : (m.url || m.poster);
        const loading = first ? "eager" : "lazy";
        const priority = first ? ` fetchpriority="high"` : "";
        return `<div class="tile"><img src="${esc(src)}"${refresh} alt="${esc(m.alt || "")}" loading="${loading}"${priority} referrerpolicy="no-referrer">${alt}</div>`;
      }
      const poster = m.poster ? ` poster="${esc(m.poster)}"` : "";
      const loop = m.type === "animated_gif" ? " autoplay muted loop playsinline" : "";
      return `<div class="tile"><video src="${esc(m.url)}"${poster}${refresh}${loop} playsinline preload="metadata"></video><button class="play" data-act="play" aria-label="Play">${icon("play")}</button>${gif}${alt}</div>`;
    }).join("");
    return `<div class="media ${cls}">${tiles}</div>`;
  }

  function followButton(id, large) {
    const on = isFollowed(id);
    return `<button class="follow${on ? " following" : ""}${large ? " lg" : ""}" data-act="follow" data-id="${esc(id)}" aria-pressed="${on ? "true" : "false"}"><span class="f">Following</span><span class="u">Unfollow</span>${on ? "" : "Follow"}</button>`.replace(
      on ? "" : `<span class="f">Following</span><span class="u">Unfollow</span>`,
      ""
    );
  }

  function followButtonClean(id, large) {
    if (isFollowed(id)) {
      return `<button class="follow following${large ? " lg" : ""}" data-act="follow" data-id="${esc(id)}"><span class="f">Following</span><span class="u">Unfollow</span></button>`;
    }
    return `<button class="follow${large ? " lg" : ""}" data-act="follow" data-id="${esc(id)}">Follow</button>`;
  }

  function actionBar(post) {
    const id = post.id;
    const stats = post.stats || {};
    const liked = !!STATE.settings.likes[id];
    const booked = !!STATE.settings.bookmarks[id];
    const reposted = !!STATE.settings.reposts[id];
    const btn = (cls, act, path, label, count) => `
      <button class="action ${cls}${cls === "like" && liked ? " on" : ""}${cls === "bookmark" && booked ? " on" : ""}${cls === "repost" && reposted ? " on" : ""}" data-act="${act}" data-id="${esc(id)}" aria-label="${esc(label)}">
        <span class="ic">${icon(path)}</span>${count ? `<span class="count">${esc(count)}</span>` : ""}
      </button>`;
    const replyCount = shownCount(stats.replies, 0);
    const replyLink = `<a class="action reply" href="${esc(statusHash(post))}" data-act="stop" aria-label="Replies"><span class="ic">${icon("reply")}</span>${replyCount ? `<span class="count">${esc(replyCount)}</span>` : ""}</a>`;
    return `<div class="actions">
      <div class="action-stats">
        ${replyLink}
        ${btn("repost", "repost", "repost", "Repost", shownCount(stats.reposts, reposted ? 1 : 0))}
        ${btn("like", "like", liked ? "heartOn" : "heart", "Like", shownCount(stats.likes, liked ? 1 : 0))}
        ${btn("views", "open-status", "views", "Views", shownCount(stats.views, 0))}
      </div>
      <div class="action-more">
        ${btn("bookmark", "bookmark", booked ? "bookmarkOn" : "bookmark", "Bookmark", "")}
        ${btn("share", "share", "share", "Share", "")}
      </div>
    </div>`;
  }

  function quoteCard(quoted) {
    if (!quoted) return "";
    const platform = quoted.platform || "x";
    const href = quoted.url && !quoted.handle ? quoted.url : (quoted.handle ? statusHash(asPost(quoted, platform)) : (quoted.url || "#"));
    const external = href.startsWith("http");
    const open = external ? ` data-href="${esc(href)}"` : ` data-open="${esc(href)}"`;
    const key = "q:" + (quoted.statusId || quoted.id || "x");
    return `<div class="quote"${open}>
      <div class="quote-head">
        ${avatar(quoted.avatar, quoted.author || quoted.handle)}
        <span class="name">${esc(quoted.author || quoted.handle || "Post")}${badge(quoted.verifiedType)}</span>
        ${quoted.handle ? `<span class="handle">@${esc(quoted.handle)}</span>` : ""}
        ${quoted.date ? `<span class="dot">·</span><span class="time">${esc(relTime(quoted.date))}</span>` : ""}
      </div>
      ${quoted.text ? `<div class="quote-text">${textHtml(quoted, key, false)}</div>` : ""}
      ${mediaHtml(quoted.media)}
    </div>`;
  }

  function isSelfReply(post) {
    const to = post.replyingTo && post.replyingTo.handle;
    return post.kind === "reply" && to && to.toLowerCase() === (post.handle || "").toLowerCase();
  }

  function threadChildren(post) {
    const id = String(post.statusId || post.id);
    return posts().filter((other) => isSelfReply(other) && String((other.replyingTo || {}).id || "") === id);
  }

  function inTimeline(post) {
    if (post.kind !== "reply") return true;
    return isSelfReply(post) && threadChildren(post).length > 0;
  }

  function sameThread(parent, child) {
    if (!parent || !child) return false;
    if ((parent.handle || "").toLowerCase() !== (child.handle || "").toLowerCase()) return false;
    const id = String((child.replyingTo || {}).id || "");
    return !!id && (id === String(parent.statusId || parent.id) || id === String(parent.id));
  }

  function postKey(post) {
    return String((post && (post.statusId || post.id)) || "");
  }

  function relevantReply(post, focus) {
    const to = post.replyingTo;
    if (!to || !to.handle) return false;
    if (!focus) return true;
    const fid = postKey(focus);
    if (to.id && String(to.id) !== fid) return true;
    if (!to.id && to.handle.toLowerCase() !== (focus.handle || "").toLowerCase()) return true;
    return false;
  }

  const LIVE_TTL = 12 * 60 * 1000;
  const COMMENT_TTL = 2 * 60 * 1000;
  const FX = "https://api.fxtwitter.com";
  const NITTER_RSS = ["https://nitter.meowing.monster", "https://nitter.kareem.one", "https://nitter.jaydenha.uk"];
  const IV_SEEDS = ["https://invidious.f5.si", "https://inv.nadeko.net", "https://invidious.nerdvpn.de", "https://yt.artemislena.eu"];
  const PIPED_SEEDS = ["https://pipedapi.kavin.rocks", "https://pipedapi.adminforge.de", "https://api.piped.private.coffee", "https://pipedapi.leptons.xyz"];
  const LIVE = { mem: {}, flight: {}, dbp: null, iv: null, dead: {}, videosDown: false, fxDown: false, status: null, statusP: null, statusLoaded: false };
  const TRIED = {};
  const PREFETCHED = {};
  const GIVEAWAY = /(crypto\s*giveaway|airdrop|double your|seed phrase|claim (?:your )?reward|free\s+(?:btc|eth|usdt|bitcoin|ethereum))/i;
  const BOT_HANDLE = /^[A-Za-z]+\d{5,}$/;
  const UNAVAILABLE = ["this post is unavailable", "this tweet is unavailable", "this post was deleted", "deleted by the post author", "account is suspended", "account has been suspended"];

  function commentsCurrent(post, doc) {
    if (!doc || !doc.fetchedAt) return false;
    const fetched = Date.parse(doc.fetchedAt);
    if (!isFinite(fetched)) return false;
    const now = Date.now();
    if (now - fetched > 36 * 60 * 60 * 1000) return false;
    const posted = Date.parse((post && post.date) || "");
    if (isFinite(posted) && now - posted > 30 * 24 * 60 * 60 * 1000) return false;
    return true;
  }

  function liveDb() {
    if (LIVE.dbp) return LIVE.dbp;
    LIVE.dbp = new Promise((resolve) => {
      try {
        if (!window.indexedDB) return resolve(null);
        const req = indexedDB.open("rss-feeds-live", 1);
        req.onupgradeneeded = () => { req.result.createObjectStore("cache"); };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    });
    return LIVE.dbp;
  }

  function idbGet(key) {
    return liveDb().then((db) => new Promise((resolve) => {
      if (!db) return resolve(null);
      try {
        const query = db.transaction("cache", "readonly").objectStore("cache").get(key);
        query.onsuccess = () => resolve(query.result || null);
        query.onerror = () => resolve(null);
      } catch (err) {
        resolve(null);
      }
    }));
  }

  function idbSet(key, row) {
    return liveDb().then((db) => new Promise((resolve) => {
      if (!db) return resolve();
      try {
        const query = db.transaction("cache", "readwrite").objectStore("cache").put(row, key);
        query.onsuccess = () => resolve();
        query.onerror = () => resolve();
      } catch (err) {
        resolve();
      }
    }));
  }

  function cacheFresh(row, ttl) {
    return !!(row && row.at && Date.now() - row.at < (ttl || LIVE_TTL));
  }

  function cacheGet(key, ttl) {
    const max = ttl || LIVE_TTL;
    const hit = LIVE.mem[key];
    if (cacheFresh(hit, max)) return Promise.resolve(hit.value);
    try {
      const raw = sessionStorage.getItem("rss-live:" + key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (cacheFresh(parsed, max)) {
          LIVE.mem[key] = parsed;
          return Promise.resolve(parsed.value);
        }
      }
    } catch (err) { /* quota or private mode */ }
    return idbGet(key).then((parsed) => {
      if (cacheFresh(parsed, max)) {
        LIVE.mem[key] = parsed;
        return parsed.value;
      }
      return null;
    });
  }

  function cacheDrop(key) {
    delete LIVE.mem[key];
    try { sessionStorage.removeItem("rss-live:" + key); } catch (err) { /* private mode */ }
    return liveDb().then((db) => new Promise((resolve) => {
      if (!db) return resolve();
      try {
        const query = db.transaction("cache", "readwrite").objectStore("cache").delete(key);
        query.onsuccess = () => resolve();
        query.onerror = () => resolve();
      } catch (err) {
        resolve();
      }
    }));
  }

  function cacheSet(key, value) {
    const row = { at: Date.now(), value: value };
    LIVE.mem[key] = row;
    try {
      sessionStorage.setItem("rss-live:" + key, JSON.stringify(row));
      return Promise.resolve();
    } catch (err) {
      return idbSet(key, row);
    }
  }

  function once(key, fn) {
    if (LIVE.flight[key]) return LIVE.flight[key];
    const pending = Promise.resolve().then(fn).finally(() => { delete LIVE.flight[key]; });
    LIVE.flight[key] = pending;
    return pending;
  }

  function fetchJson(url) {
    return fetch(url, { cache: "no-cache", signal: AbortSignal.timeout(8000) }).then((res) => {
      if (!res.ok) {
        const err = new Error(String(res.status));
        err.status = res.status;
        throw err;
      }
      return res.json();
    });
  }

  function ivBases() {
    if (LIVE.iv) return LIVE.iv;
    LIVE.iv = fetchJson("https://api.invidious.io/instances.json").then((rows) => {
      const found = [];
      (rows || []).forEach((item) => {
        if (!Array.isArray(item) || item.length < 2) return;
        const meta = item[1] || {};
        if (meta.type !== "https" || !meta.api) return;
        const uri = String(meta.uri || "").replace(/\/$/, "");
        if (uri.indexOf("https://") === 0) found.push(uri);
      });
      const out = IV_SEEDS.slice();
      found.forEach((uri) => { if (out.indexOf(uri) < 0) out.push(uri); });
      return out.slice(0, 8);
    }).catch(() => IV_SEEDS.slice());
    return LIVE.iv;
  }

  function loadStatus() {
    if (LIVE.statusP) return LIVE.statusP;
    LIVE.statusP = fetch("status.json", { cache: "no-cache" }).then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    }).then((doc) => {
      LIVE.status = doc && typeof doc === "object" ? doc : null;
      ((LIVE.status && LIVE.status.down) || []).forEach((item) => {
        if (!item) return;
        if (item === "fxtwitter") LIVE.fxDown = true;
        else LIVE.dead[item] = true;
      });
      LIVE.statusLoaded = true;
      return LIVE.status;
    }).catch(() => {
      LIVE.statusLoaded = true;
      return null;
    });
    return LIVE.statusP;
  }

  function ownPack(id) {
    if (!id) return Promise.resolve(null);
    return fetch("fallback/" + encodeURIComponent(id) + ".json", { cache: "no-cache" }).then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    }).then((doc) => {
      if (!doc || typeof doc !== "object") return null;
      const stamped = Date.parse(doc.fetchedAt || "");
      doc._at = isFinite(stamped) ? stamped : 0;
      return doc;
    }).catch(() => null);
  }

  function rotate(basesPromise, path, limit, slot) {
    return loadStatus().then(() => basesPromise.then((bases) => {
      if (path.indexOf("/api/v1/videos/") === 0 && LIVE.videosDown) return null;
      const prefer = slot && LIVE[slot];
      const list = [];
      if (prefer && !LIVE.dead[prefer]) list.push(prefer);
      (bases || []).forEach((base) => {
        if (list.length >= (limit || 4)) return;
        if (list.indexOf(base) < 0 && !LIVE.dead[base]) list.push(base);
      });
      // A reply continuation only works on the instance that issued it.
      const sticky = path.indexOf("continuation=") >= 0 && prefer;
      let index = 0;
      function next() {
        if (index >= list.length) return Promise.resolve(null);
        const base = list[index++];
        return fetchJson(base.replace(/\/$/, "") + path).then((data) => {
          if (slot) LIVE[slot] = base;
          return data;
        }).catch((err) => {
          if (path.indexOf("/api/v1/videos/") === 0 && err && err.status >= 500) {
            LIVE.videosDown = true;
            return null;
          }
          if (sticky) return null;
          if (!(err && err.status === 404)) LIVE.dead[base] = true;
          return next();
        });
      }
      return next();
    }));
  }

  function fxNum(value) {
    const n = Number(value);
    return isFinite(n) ? Math.trunc(n) : 0;
  }

  function isoDate(value) {
    if (value == null || value === "") return "";
    if (typeof value === "number" || /^\d{10,13}$/.test(String(value))) {
      let n = Number(value);
      if (n < 100000000000) n *= 1000;
      return new Date(n).toISOString().replace(/\.\d{3}Z$/, "Z");
    }
    const text = String(value).trim();
    if (text.length >= 20 && text[4] === "-" && text.indexOf("T") > 0) return text;
    const parsed = Date.parse(text);
    if (!isFinite(parsed)) return "";
    return new Date(parsed).toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  function upgradeAvatar(url) {
    if (!url) return "";
    return String(url).replace("_normal.", "_400x400.").replace("_bigger.", "_400x400.").replace("_mini.", "_400x400.");
  }

  function bestMp4(variants) {
    let best = "";
    let bestRate = -1;
    (variants || []).forEach((variant) => {
      if (!variant || typeof variant !== "object") return;
      const url = variant.url || "";
      const ctype = String(variant.content_type || variant.type || variant.container || "").toLowerCase();
      const path = url.split("?")[0].toLowerCase();
      if (path.indexOf(".m3u8") >= 0) return;
      if (ctype.indexOf("mp4") < 0 && path.indexOf(".mp4") < 0) return;
      let rate = Number(variant.bitrate || variant.bit_rate || 0);
      if (!isFinite(rate)) rate = 0;
      if (rate >= bestRate) {
        bestRate = rate;
        best = url;
      }
    });
    return best;
  }

  function fxMedia(media) {
    if (!media) return [];
    let items = [];
    if (Array.isArray(media)) items = media;
    else if (typeof media === "object") {
      items = media.all || [];
      if (!items.length) items = (media.photos || []).concat(media.videos || []).concat(media.gifs || []);
    }
    const out = [];
    items.forEach((item) => {
      if (typeof item === "string") {
        out.push({ type: "photo", url: item, poster: item, width: null, height: null, alt: "" });
        return;
      }
      if (!item || typeof item !== "object") return;
      let kind = String(item.type || "photo").toLowerCase();
      if (kind === "gif" || kind === "animated_gif") kind = "animated_gif";
      else if (kind !== "photo" && kind !== "video" && kind !== "animated_gif") kind = item.variants || item.formats ? "video" : "photo";
      const mp4 = bestMp4(item.variants || item.formats || item.video_files || []);
      const poster = item.thumbnail_url || item.poster || item.preview_image_url || "";
      let url = item.url || "";
      if (kind === "video" || kind === "animated_gif") url = mp4 || url || poster;
      else {
        url = url || poster;
      }
      if (!url) return;
      out.push({ type: kind, url: url, poster: poster || (kind === "photo" ? url : ""), width: item.width || null, height: item.height || null, alt: item.alt || item.alt_text || "" });
    });
    return out;
  }

  function fxStats(status) {
    const mapping = {
      replies: ["replies", "reply_count"],
      reposts: ["reposts", "retweets", "retweet_count"],
      quotes: ["quotes", "quote_count"],
      likes: ["likes", "like_count", "favourites"],
      views: ["views", "view_count", "impression_count"],
      bookmarks: ["bookmarks", "bookmark_count"]
    };
    const out = {};
    if (!status || typeof status !== "object") return out;
    Object.keys(mapping).forEach((dest) => {
      mapping[dest].forEach((key) => {
        if (out[dest] == null && status[key] != null && status[key] !== "") out[dest] = status[key];
      });
    });
    return out;
  }

  function fxVerified(author) {
    if (!author) return null;
    const verification = author.verification;
    let kind = "";
    if (typeof verification === "string") kind = verification;
    else if (verification && typeof verification === "object") {
      kind = verification.type || verification.verified_type || "";
      if (!kind && (verification.verified || verification.is_verified)) kind = "blue";
    }
    if (!kind && author.verified) kind = "blue";
    if (!kind || kind === "none") return null;
    return kind === "individual" ? "blue" : kind;
  }

  function fxPerson(obj) {
    if (!obj || typeof obj !== "object") return null;
    let handle = obj.screen_name || obj.handle || "";
    if (!handle && obj.author) return fxPerson(obj.author);
    if (!handle && !obj.name) return null;
    const person = { name: obj.name || handle, handle: handle, avatar: upgradeAvatar(obj.avatar_url || obj.avatar || "") };
    const statusId = obj.status || obj.status_id;
    if (statusId) person.id = String(statusId);
    return person;
  }

  function fxUnavailable(status) {
    if (!status || typeof status !== "object") return true;
    if (status.deleted || status.unavailable || status.tombstone) return true;
    const type = String(status.type || "").toLowerCase();
    if (type === "tombstone" || type === "deleted" || type === "unavailable") return true;
    const text = String(status.text || status.full_text || "").trim().toLowerCase();
    if (UNAVAILABLE.some((phrase) => text.indexOf(phrase) >= 0)) return true;
    if ((status.author == null || status.author === "" || (typeof status.author === "object" && !Object.keys(status.author).length)) && !text) return true;
    return false;
  }

  function fxConversationId(status) {
    let conv = status.conversation_id || status.conversation_id_str || "";
    const nested = status.conversation;
    if (!conv && nested && typeof nested === "object") conv = nested.id || nested.status || "";
    else if (!conv && typeof nested === "string") conv = nested;
    return String(conv || "");
  }

  function fxFromStatus(status) {
    if (!status || typeof status !== "object") return null;
    const wrapped = status.tweet && typeof status.tweet === "object" ? status.tweet : status;
    if (fxUnavailable(wrapped)) return null;
    const author = wrapped.author || {};
    const handle = author.screen_name || author.handle || "";
    const statusId = String(wrapped.id || wrapped.id_str || "");
    if (!statusId) return null;
    const replying = typeof wrapped.replying_to === "string"
      ? { name: wrapped.replying_to, handle: String(wrapped.replying_to).replace(/^@/, ""), avatar: "" }
      : fxPerson(wrapped.replying_to || wrapped.replying_to_user || wrapped.in_reply_to);
    const post = {
      id: statusId,
      statusId: statusId,
      platform: "x",
      feedId: "",
      kind: replying ? "reply" : "post",
      author: author.name || handle,
      handle: handle,
      avatar: upgradeAvatar(author.avatar_url || ""),
      verifiedType: fxVerified(author),
      text: String(wrapped.text || wrapped.full_text || "").trim(),
      date: isoDate(wrapped.created_at || wrapped.created_timestamp || wrapped.date || ""),
      url: wrapped.url || (handle ? "https://x.com/" + handle + "/status/" + statusId : ""),
      media: fxMedia(wrapped.media),
      stats: fxStats(wrapped),
      replyingTo: replying
    };
    if (author.joined) post.authorJoined = isoDate(author.joined);
    if (typeof author.followers === "number") post.authorFollowers = author.followers;
    const conv = fxConversationId(wrapped);
    if (conv) post.conversationId = conv;
    if (replying && (wrapped.replying_to && (wrapped.replying_to.status || wrapped.replying_to.status_id))) {
      post.replyingTo = Object.assign({}, replying, { id: String(wrapped.replying_to.status || wrapped.replying_to.status_id) });
    }
    return post;
  }

  function fxStatusObject(data) {
    if (!data || typeof data !== "object") return null;
    if (data.code != null && data.code !== 200 && data.code !== "200") return null;
    if (data.tweet && typeof data.tweet === "object") return data.tweet;
    if (data.status && typeof data.status === "object" && (data.status.id || data.status.id_str)) return data.status;
    if (data.id && (data.text != null || data.author)) return data;
    return null;
  }

  function fxBelongs(post, parentId) {
    const parent = String(parentId || "");
    if (!parent) return null;
    const target = String((post.replyingTo || {}).id || "");
    const conv = String(post.conversationId || "");
    if (target === parent || conv === parent) return true;
    if (target || conv) return false;
    return null;
  }

  function fxExtract(data, parentId) {
    const parent = String(parentId || "");
    const out = [];
    const seen = {};
    (data.replies || []).forEach((status) => {
      if (!status || typeof status !== "object" || fxUnavailable(status)) return;
      const sid = String(status.id || status.id_str || "");
      if (!sid || sid === parent || seen[sid]) return;
      seen[sid] = true;
      const post = fxFromStatus(status);
      if (!post) return;
      post.kind = "reply";
      if (fxBelongs(post, parent) === false) return;
      out.push(post);
    });
    return out;
  }

  function fxEngagement(post) {
    const stats = post.stats || {};
    let score = fxNum(stats.likes) + fxNum(stats.replies) * 2 + fxNum(stats.reposts);
    if (post.verifiedType && post.verifiedType !== "none") score = Math.trunc(score * 1.5) + 1;
    return score;
  }

  function fxNorm(text) {
    return String(text || "").replace(/https?:\/\/\S+|t\.co\/\S+/gi, " ").replace(/@\w+/g, " ").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function fxYoung(post) {
    if (post.authorFollowers == null || fxNum(post.authorFollowers) >= 20) return false;
    const joined = Date.parse(post.authorJoined || "");
    const posted = Date.parse(post.date || "");
    if (!isFinite(joined) || !isFinite(posted)) return false;
    const gap = posted - joined;
    return gap >= 0 && gap <= 21 * 86400000;
  }

  function fxSpamReason(post, author) {
    if (author && String(post.handle || "").toLowerCase() === author) return "";
    const text = post.text || "";
    if (GIVEAWAY.test(text)) return "giveaway";
    const leftover = text.replace(/https?:\/\/\S+|t\.co\/\S+/gi, " ").replace(/@\w+/g, " ").replace(/\s+/g, "");
    if (/https?:\/\/\S+|t\.co\/\S+/i.test(text) && leftover.length < 8) return "link";
    if (fxYoung(post)) return "new";
    if (BOT_HANDLE.test(post.handle || "")) {
      const compact = text.replace(/https?:\/\/\S+|t\.co\/\S+/gi, " ").replace(/@\w+/g, " ").replace(/\s+/g, "");
      if (compact.length < 40 || /https?:\/\/\S+|t\.co\/\S+/i.test(text)) return "bot";
    }
    return "";
  }

  function fxChain(posts) {
    const ids = {};
    posts.forEach((post) => { ids[String(post.id || "")] = true; });
    const byParent = {};
    posts.forEach((post) => {
      const target = String((post.replyingTo || {}).id || "");
      (byParent[target] || (byParent[target] = [])).push(post);
    });
    Object.keys(byParent).forEach((key) => byParent[key].sort((a, b) => String(a.date || "").localeCompare(String(b.date || ""))));
    const roots = posts.filter((post) => !ids[String((post.replyingTo || {}).id || "")]);
    roots.sort((a, b) => String(a.date || "").localeCompare(String(b.date || "")));
    const out = [];
    const seen = {};
    function walk(node) {
      const sid = String(node.id || "");
      if (seen[sid]) return;
      seen[sid] = true;
      out.push(node);
      (byParent[sid] || []).forEach(walk);
    }
    roots.forEach(walk);
    posts.forEach((post) => { if (!seen[String(post.id || "")]) out.push(post); });
    return out;
  }

  function fxRank(replies, authorHandle, cap) {
    const author = String(authorHandle || "").toLowerCase();
    const posts = [];
    const seen = {};
    (replies || []).forEach((post, index) => {
      if (!post || typeof post !== "object") return;
      const item = Object.assign({}, post);
      delete item.spam;
      const sid = String(item.id || "");
      if (sid) {
        if (seen[sid]) return;
        seen[sid] = true;
      } else item._rankId = String(index);
      posts.push(item);
    });
    const groups = {};
    posts.forEach((post) => {
      if (author && String(post.handle || "").toLowerCase() === author) return;
      const key = fxNorm(post.text || "");
      if (key.length < 20) return;
      (groups[key] || (groups[key] = [])).push(post);
    });
    Object.keys(groups).forEach((key) => {
      const group = groups[key];
      if (group.length < 2) return;
      group.sort((a, b) => fxEngagement(b) - fxEngagement(a));
      group.slice(1).forEach((loser) => { loser.spam = true; });
    });
    posts.forEach((post) => { if (fxSpamReason(post, author)) post.spam = true; });
    const clean = posts.filter((post) => !post.spam);
    const flagged = posts.filter((post) => post.spam);
    const selfPosts = clean.filter((post) => author && String(post.handle || "").toLowerCase() === author);
    const others = clean.filter((post) => selfPosts.indexOf(post) < 0);
    others.sort((a, b) => fxEngagement(b) - fxEngagement(a) || fxNum((b.stats || {}).likes) - fxNum((a.stats || {}).likes) || String(b.date || "").localeCompare(String(a.date || "")));
    flagged.sort((a, b) => fxEngagement(b) - fxEngagement(a));
    const ranked = fxChain(selfPosts).concat(others);
    const newest = clean.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || ""))).slice(0, 30);
    const picked = {};
    const result = [];
    function push(post) {
      const sid = String(post.id || post._rankId || "");
      if (!sid || picked[sid]) return;
      picked[sid] = true;
      result.push(post);
    }
    ranked.forEach((post) => {
      if (result.length >= cap) return;
      push(post);
    });
    newest.forEach((post) => {
      const sid = String(post.id || post._rankId || "");
      if (!sid || picked[sid]) return;
      if (result.length >= cap) {
        for (let i = result.length - 1; i >= 0; i--) {
          const id = String(result[i].id || "");
          const isNew = newest.some((item) => String(item.id || "") === id);
          const isSelf = author && String(result[i].handle || "").toLowerCase() === author;
          if (!isNew && !isSelf) {
            delete picked[id];
            result.splice(i, 1);
            break;
          }
        }
      }
      if (result.length < cap) push(post);
    });
    const out = result.concat(flagged.slice(0, 20));
    out.forEach((post) => { delete post._rankId; });
    return out;
  }

  function fxFillRank(post, parentId) {
    if (fxBelongs(post, parentId) == null) return 0;
    if (!(post.text || "").trim() && !(post.media || []).length) return 1;
    if (!post.handle || !post.date) return 2;
    if (!((post.replyingTo || {}).id) && !post.conversationId) return 2;
    return 9;
  }

  function fxMergeLookup(post, extra, parentId) {
    if (!extra) return null;
    if (fxBelongs(extra, parentId) === false) return null;
    const filled = Object.assign({}, post);
    ["text", "handle", "author", "date", "avatar", "url", "verifiedType", "authorJoined", "authorFollowers", "conversationId"].forEach((key) => {
      if (!filled[key] && extra[key]) filled[key] = extra[key];
    });
    if (!(filled.media || []).length && (extra.media || []).length) filled.media = extra.media;
    if (!((filled.replyingTo || {}).id) && (extra.replyingTo || {}).id) filled.replyingTo = extra.replyingTo;
    if (!filled.stats && extra.stats) filled.stats = extra.stats;
    if (fxBelongs(filled, parentId) === true) return filled;
    if (fxBelongs(extra, parentId) === true) {
      if (extra.conversationId) filled.conversationId = extra.conversationId;
      if ((extra.replyingTo || {}).id) filled.replyingTo = extra.replyingTo;
    }
    if (fxBelongs(filled, parentId) !== true) return null;
    return filled;
  }

  function fxStatusPost(id) {
    const key = String(id || "");
    if (!key) return Promise.resolve(null);
    return once("fxstatus:" + key, () => cacheGet("fx:status:" + key, COMMENT_TTL).then((hit) => {
      if (hit) return hit;
      return fetchJson(FX + "/2/status/" + encodeURIComponent(key)).then((data) => {
        const status = fxStatusObject(data);
        const post = status ? fxFromStatus(status) : null;
        if (!post) throw new Error("empty");
        return cacheSet("fx:status:" + key, post).then(() => post);
      }).catch(() => null);
    }));
  }

  function fxFill(rows, parentId) {
    const ranked = rows.filter((post) => fxFillRank(post, parentId) < 9)
      .sort((a, b) => fxFillRank(a, parentId) - fxFillRank(b, parentId))
      .slice(0, 15);
    return Promise.all(ranked.map((post) => fxStatusPost(postKey(post)).then((extra) => ({ id: postKey(post), extra: extra })))).then((found) => {
      const byId = {};
      found.forEach((item) => { if (item.extra) byId[item.id] = item.extra; });
      const out = [];
      const seen = {};
      rows.forEach((post) => {
        const sid = postKey(post);
        if (!sid || seen[sid]) return;
        seen[sid] = true;
        let row = post;
        if (byId[sid]) {
          const merged = fxMergeLookup(post, byId[sid], parentId);
          if (!merged) return;
          row = merged;
        }
        if (fxBelongs(row, parentId) !== true) return;
        out.push(row);
      });
      return out;
    });
  }

  function fxUsable(payload) {
    if (!payload || typeof payload !== "object") return false;
    if (payload.code != null && payload.code !== 200 && payload.code !== "200") return false;
    return !!(payload.status || (payload.replies && payload.replies.length));
  }

  function fxConversation(id, params) {
    const query = new URLSearchParams(params || {});
    const suffix = query.toString();
    return fetchJson(FX + "/2/conversation/" + encodeURIComponent(id) + (suffix ? "?" + suffix : ""));
  }

  function fxConversationPages(id) {
    const soft = (params) => fxConversation(id, params).catch(() => null);
    return Promise.all([
      soft({}),
      soft({ ranking_mode: "recency" })
    ]).then((pair) => {
      const recent = pair[1];
      const cursor = recent && recent.cursor && recent.cursor.bottom;
      if (!cursor) return pair;
      return soft({ ranking_mode: "recency", cursor: cursor }).then((next) => pair.concat([next]));
    });
  }

  function loadXThread(post, fresh) {
    const id = postKey(post);
    if (!id) return Promise.resolve(null);
    const key = "fx:conv:" + id;
    if (fresh) cacheDrop(key);
    return once((fresh ? "fxfresh:" : "fx:") + id, () => (fresh ? Promise.resolve(null) : cacheGet(key, COMMENT_TTL)).then((hit) => {
      if (hit && hit.replies && hit.replies.length) {
        if (!hit.fetchedAt) hit.fetchedAt = Date.now();
        return hit;
      }
      return loadStatus().then(() => {
        if (LIVE.fxDown) return null;
        return fxConversationPages(id).then((pages) => {
          const usable = (pages || []).filter(fxUsable);
          if (!usable.length) return null;
          const merged = [];
          const seen = {};
          usable.forEach((payload) => {
            fxExtract(payload, id).forEach((row) => {
              const sid = postKey(row);
              if (!sid || seen[sid]) return;
              seen[sid] = true;
              merged.push(row);
            });
          });
          const primary = usable.find((payload) => payload.status) || usable[0];
          const author = ((primary.status || {}).author || {}).screen_name || post.handle || "";
          return fxFill(merged, id).then((filled) => {
            const pack = { replies: fxRank(filled, author, 60), stats: fxStats(primary.status || {}), fetchedAt: Date.now() };
            if (!pack.replies.length) return pack;
            return cacheSet(key, pack).then(() => pack);
          });
        });
      });
    }).catch(() => null));
  }

  function takeRanked(replies, cap) {
    const clean = [];
    const spam = [];
    (replies || []).forEach((row) => { (row.spam ? spam : clean).push(row); });
    return clean.slice(0, cap).concat(spam.slice(0, 20));
  }

  function selectSubthreads(replies) {
    return (replies || []).filter((post) => post && !post.spam && fxNum((post.stats || {}).replies) > 0 && postKey(post))
      .sort((a, b) => fxEngagement(b) - fxEngagement(a))
      .slice(0, 10);
  }

  function applyLiveStats(id, stats) {
    if (!stats) return;
    const touch = (post) => {
      if (!post || postKey(post) !== String(id)) return;
      post.stats = Object.assign({}, post.stats || {});
      ["replies", "reposts", "quotes", "likes", "views", "bookmarks"].forEach((key) => {
        if (stats[key] != null && stats[key] !== "") post.stats[key] = stats[key];
      });
    };
    posts().forEach(touch);
    Object.keys(STATE.shared).forEach((key) => touch(STATE.shared[key]));
    Object.keys(STATE.replies).forEach((key) => {
      const bucket = STATE.replies[key] || {};
      (bucket.replies || []).forEach(touch);
      commentRows(bucket.doc).forEach(touch);
    });
  }

  function snapshotDoc(file) {
    return fetch("comments/" + encodeURIComponent(file) + ".json", { cache: "no-cache" }).then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    });
  }

  function replyBucket(post) {
    const id = postKey(post);
    if (!id) return { loading: false, replies: [], missing: true };
    const focused = String(STATE.focusId || "") === id;
    const want = focused ? 60 : 20;
    if (post._community && post.kind !== "community") {
      return { loading: false, replies: Array.isArray(post.replies) ? post.replies : [], missing: false, cap: want };
    }
    const fresh = String(STATE.forceReply || "") === id;
    if (fresh) STATE.forceReply = "";
    const bucket = STATE.replies[id];
    const cachedAt = bucket && bucket.fetchedAt;
    const stillFresh = cachedAt && Date.now() - cachedAt < COMMENT_TTL;
    if (!fresh && bucket && !bucket.loading && (bucket.cap || 0) >= want && (stillFresh || bucket.settled)) return bucket;
    if (!fresh && bucket && bucket.loading) return bucket;
    const epoch = (STATE.replyEpoch[id] || 0) + 1;
    STATE.replyEpoch[id] = epoch;
    STATE.replies[id] = { loading: true, replies: (bucket && bucket.replies) || [], missing: false, cap: want, fetchedAt: fresh ? 0 : cachedAt || 0 };
    const finish = (replies, missing, cap, fetchedAt) => {
      if (STATE.replyEpoch[id] !== epoch) return;
      STATE.replies[id] = { loading: false, replies: replies || [], missing: !!missing, cap: cap || want, fetchedAt: fetchedAt || Date.now(), settled: true };
      render();
    };
    const snap = (ownAt) => snapshotDoc(id).then((doc) => {
      if (!commentsCurrent(post, doc)) {
        finish([], true, want, ownAt || Date.now());
        return;
      }
      const stamped = doc && doc.fetchedAt ? Date.parse(doc.fetchedAt) : Date.now();
      finish(((doc && doc.replies) || []).slice(), false, want, isFinite(stamped) ? stamped : Date.now());
    }).catch(() => finish([], true, want, ownAt || Date.now()));
    const ownThenSnap = () => ownPack(id).then((own) => {
      if (STATE.replyEpoch[id] !== epoch) return;
      if (own && own.stats) applyLiveStats(id, own.stats);
      if (own && (own.replies || []).length) {
        finish(own.replies.slice(0, want), false, want, own._at || Date.now());
        return;
      }
      snap(own && own._at);
    });
    if (post.kind === "community") {
      loadCommunityComments(post).then((result) => {
        if (!result || !(result.replies || []).length) finish([], true, want, (result && result.fetchedAt) || Date.now());
        else finish(result.replies, false, want, result.fetchedAt || Date.now());
      }).catch(() => finish([], true, want, Date.now()));
      return STATE.replies[id];
    }
    if ((post.platform || "") === "x") {
      loadXThread(post, fresh || focused).then((pack) => {
        if (STATE.replyEpoch[id] !== epoch) return;
        if (pack && (pack.replies || []).length) {
          applyLiveStats(id, pack.stats);
          const capNow = String(STATE.focusId || "") === id ? 60 : 20;
          const rows = takeRanked(pack.replies, capNow);
          if (capNow === 60 && !PREFETCHED[id]) {
            PREFETCHED[id] = true;
            selectSubthreads(rows).forEach((reply) => {
              const cid = postKey(reply);
              if (cid && !(STATE.replies[cid] && (STATE.replies[cid].cap || 0) >= 20)) replyBucket(reply);
            });
          }
          finish(rows, false, capNow, pack.fetchedAt || Date.now());
          return;
        }
        if (pack && pack.stats) applyLiveStats(id, pack.stats);
        ownThenSnap();
      });
      return STATE.replies[id];
    }
    ownThenSnap();
    return STATE.replies[id];
  }

  function ivIso(value) {
    const n = Number(value);
    if (!isFinite(n) || n < 1000000000) return "";
    return new Date(n * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  }

  function ivAvatar(comment) {
    if (!comment) return "";
    let best = comment.authorThumbnail || "";
    if (!best) {
      let width = -1;
      (comment.authorThumbnails || []).forEach((thumb) => {
        if (!thumb || !thumb.url) return;
        const w = Number(thumb.width || 0);
        if (w >= width) {
          best = thumb.url;
          width = w;
        }
      });
    }
    if (String(best).indexOf("//") === 0) best = "https:" + best;
    return best;
  }

  function ivComment(comment, parentId, handle) {
    const info = comment.replies || {};
    const author = String(comment.author || "").replace(/^@/, "");
    const row = {
      id: comment.commentId || "",
      statusId: comment.commentId || "",
      platform: "youtube",
      kind: "reply",
      author: author,
      handle: author,
      avatar: ivAvatar(comment),
      verifiedType: comment.verified ? "blue" : null,
      text: comment.content || "",
      date: ivIso(comment.published),
      stats: { likes: fxNum(comment.likeCount), replies: fxNum(info.replyCount) },
      replies: [],
      replyingTo: { id: parentId, handle: handle }
    };
    if (comment.authorId) row.channelId = String(comment.authorId);
    else if (comment.authorUrl) {
      const channel = String(comment.authorUrl).match(/UC[\w-]{10,}/);
      if (channel) row.channelId = channel[0];
    }
    if (!row.date && comment.publishedText) row.timeLabel = comment.publishedText;
    if (info.continuation) row._continuation = info.continuation;
    return row;
  }

  function stripYt(rows) {
    return (rows || []).map((row) => {
      const item = Object.assign({}, row);
      delete item._continuation;
      item.replies = stripYt(item.replies || []);
      return item;
    });
  }

  function ivCommentPage(videoId, sort, continuation) {
    let path = "/api/v1/comments/" + encodeURIComponent(videoId) + "?sort_by=" + encodeURIComponent(sort || "top");
    if (continuation) path += "&continuation=" + encodeURIComponent(continuation);
    return rotate(ivBases(), path, 4, "ivBase");
  }

  function fillIvReplies(rows, videoId) {
    const ranked = rows.filter((row) => fxNum((row.stats || {}).replies) > 0 && row._continuation)
      .sort((a, b) => fxNum((b.stats || {}).replies) - fxNum((a.stats || {}).replies) || fxNum((b.stats || {}).likes) - fxNum((a.stats || {}).likes))
      .slice(0, 10);
    let chain = Promise.resolve();
    ranked.forEach((row) => {
      chain = chain.then(() => ivCommentPage(videoId, "top", row._continuation).then((payload) => {
        if (!payload) return;
        const children = [];
        (payload.comments || []).slice(0, 20).forEach((child) => {
          if (!(child.content || "").trim()) return;
          const kid = ivComment(child, row.id || "", row.handle || "");
          delete kid._continuation;
          children.push(kid);
        });
        row.replies = children;
      }));
    });
    return chain;
  }

  function ivThread(id, handle) {
    const top = [];
    let count = null;
    let continuation = "";
    let pages = 0;
    function pull() {
      // One page, then reply threads. A later page must not run before those threads.
      if (top.length >= 20 || pages >= 1) return Promise.resolve();
      pages += 1;
      return ivCommentPage(id, "top", continuation).then((payload) => {
        if (!payload) return;
        if (payload.commentCount != null && isFinite(Number(payload.commentCount))) count = Number(payload.commentCount);
        const batch = payload.comments || [];
        batch.forEach((comment) => {
          if (String(comment.content || "").trim()) top.push(ivComment(comment, id, handle));
        });
        continuation = payload.continuation || "";
        if (continuation && batch.length) return pull();
      });
    }
    return pull().then(() => {
      if (!top.length && count == null) return null;
      return fillIvReplies(top, id).then(() => ivCommentPage(id, "new", "").then((fresh) => {
        const newest = [];
        ((fresh && fresh.comments) || []).slice(0, 60).forEach((comment) => {
          if (String(comment.content || "").trim()) newest.push(ivComment(comment, id, handle));
        });
        const doc = { postId: "yt_" + id, platform: "youtube", source: "invidious", replies: stripYt(top) };
        if (newest.length) doc.newest = stripYt(newest);
        if (count != null) doc.commentCount = count;
        return doc;
      }));
    });
  }

  function pipedComment(comment, parentId, handle, depth) {
    const author = String(comment.author || "").replace(/^@/, "");
    const row = {
      id: comment.commentId || "",
      statusId: comment.commentId || "",
      platform: "youtube",
      kind: "reply",
      author: author,
      handle: author,
      avatar: comment.thumbnail || "",
      verifiedType: null,
      text: comment.commentText || comment.comment || "",
      date: "",
      stats: { likes: fxNum(comment.likeCount), replies: fxNum(comment.replyCount) },
      replies: [],
      replyingTo: { id: parentId, handle: handle }
    };
    if (comment.authorId || comment.channelId) row.channelId = String(comment.authorId || comment.channelId);
    if (comment.commentedTime) row.timeLabel = comment.commentedTime;
    if (depth === 0 && Array.isArray(comment.replies)) {
      const kids = [];
      comment.replies.slice(0, 20).forEach((child) => {
        if (!child || !String(child.commentText || child.comment || "").trim()) return;
        kids.push(pipedComment(child, row.id, author, 1));
      });
      if (kids.length) row.replies = kids;
    }
    return row;
  }

  function pipedThread(id, handle) {
    return rotate(Promise.resolve(PIPED_SEEDS.slice()), "/comments/" + encodeURIComponent(id), 4, "pipedBase").then((piped) => {
      if (!piped) return null;
      const top = [];
      (piped.comments || []).slice(0, 60).forEach((comment) => {
        if (String(comment.commentText || comment.comment || "").trim()) top.push(pipedComment(comment, id, handle, 0));
      });
      let count = null;
      const raw = piped.commentCount != null ? piped.commentCount : piped.commentsCount;
      if (raw != null && isFinite(Number(raw))) count = Number(raw);
      if (!top.length && count == null) return null;
      const doc = { postId: "yt_" + id, platform: "youtube", source: "piped", replies: top };
      if (count != null) doc.commentCount = count;
      return doc;
    });
  }

  function hotImage(url) {
    const abs = String(url || "");
    const full = abs.indexOf("//") === 0 ? "https:" + abs : abs;
    if (full.indexOf("https://") !== 0) return "";
    try {
      const host = new URL(full).hostname;
      if (/(^|\.)ggpht\.com$/.test(host) || /(^|\.)googleusercontent\.com$/.test(host) || /(^|\.)ytimg\.com$/.test(host)) return full;
    } catch (err) {
      return "";
    }
    return "";
  }

  function bestThumb(list) {
    let best = "";
    let width = -1;
    let height = 0;
    (list || []).forEach((thumb) => {
      if (!thumb) return;
      const url = hotImage(thumb.url || thumb);
      if (!url) return;
      const w = Number(thumb.width || 0);
      if (w >= width) {
        best = url;
        width = w;
        height = Number(thumb.height || 0);
      }
    });
    return { url: best, width: width > 0 ? width : 0, height: height };
  }

  function communityFromIv(item, seed) {
    if (!item || !item.commentId) return null;
    const att = item.attachment || {};
    const media = [];
    let poll = null;
    let quoted = null;
    if (att.type === "image") {
      const img = bestThumb(att.imageThumbnails);
      if (img.url) media.push({ type: "photo", url: img.url, poster: img.url, width: img.width, height: img.height, alt: "" });
    } else if (att.type === "multiImage") {
      (att.images || []).slice(0, 4).forEach((group) => {
        const img = bestThumb(Array.isArray(group) ? group : ((group && (group.imageThumbnails || group.thumbnails)) || []));
        if (img.url) media.push({ type: "photo", url: img.url, poster: img.url, width: img.width, height: img.height, alt: "" });
      });
    } else if (att.type === "poll" && Array.isArray(att.choices)) {
      const choices = [];
      att.choices.forEach((choice) => {
        const text = choice && choice.text;
        if (!text) return;
        const row = { text: String(text) };
        if (choice.percent != null && isFinite(Number(choice.percent))) row.percent = Number(choice.percent);
        if (choice.votes != null && isFinite(Number(choice.votes))) row.votes = Number(choice.votes);
        choices.push(row);
      });
      if (choices.length) {
        poll = { choices: choices };
        if (att.totalVotes != null && isFinite(Number(att.totalVotes))) poll.totalVotes = Number(att.totalVotes);
      }
    } else if (att.type === "video" && att.videoId) {
      const poster = "https://i.ytimg.com/vi/" + att.videoId + "/hqdefault.jpg";
      quoted = {
        id: att.videoId,
        platform: "youtube",
        author: att.author || "",
        text: att.title || "",
        url: "https://www.youtube.com/watch?v=" + att.videoId,
        media: [{ type: "photo", url: poster, poster: poster, alt: att.title || "" }]
      };
    }
    const next = Object.assign({}, seed, {
      stub: false,
      kind: "community",
      author: item.author || seed.author || "",
      text: item.content || seed.text || "",
      date: ivIso(item.published) || seed.date || "",
      url: "https://www.youtube.com/post/" + item.commentId,
      media: media,
      avatar: bestThumb(item.authorThumbnails).url || seed.avatar || ""
    });
    const stats = {};
    if (item.likeCount != null && isFinite(Number(item.likeCount))) stats.likes = Number(item.likeCount);
    const replies = item.replyCount != null ? item.replyCount : (item.replies && item.replies.replyCount);
    if (replies != null && isFinite(Number(replies))) stats.replies = Number(replies);
    if (stats.likes != null || stats.replies != null) next.stats = stats;
    if (poll) next.poll = poll;
    if (quoted) next.quoted = quoted;
    return next;
  }

  function loadCommunityComments(post) {
    const id = postKey(post);
    const ucid = (feedOf(post).channelId) || "";
    function page(continuation) {
      let path = "/api/v1/post/" + encodeURIComponent(id) + "/comments?sort_by=top";
      if (ucid) path += "&ucid=" + encodeURIComponent(ucid);
      if (continuation) path += "&continuation=" + encodeURIComponent(continuation);
      return rotate(ivBases(), path, 4, "ivBase");
    }
    return loadStatus().then(() => page("").then((payload) => {
      if (payload && Array.isArray(payload.comments)) {
        if (payload.commentCount != null && isFinite(Number(payload.commentCount))) applyLiveStats(id, { replies: Number(payload.commentCount) });
        const top = [];
        payload.comments.forEach((comment) => {
          if (!String(comment.content || "").trim()) return;
          const row = ivComment(comment, id, post.handle || "");
          row._community = true;
          delete row._continuation;
          top.push(row);
        });
        return { replies: top, fetchedAt: Date.now() };
      }
      return ownPack(id).then((own) => {
        if (!own || !(own.replies || []).length) return null;
        return { replies: own.replies, fetchedAt: own._at || Date.now() };
      });
    }));
  }

  function loadYtComments(post) {
    const id = postKey(post);
    if (!id) return Promise.resolve(null);
    const fresh = STATE.forceWatch === id;
    if (fresh) STATE.forceWatch = "";
    if (fresh) cacheDrop("yt:doc:" + id);
    return once((fresh ? "ytfresh:" : "yt:") + id, () => (fresh ? Promise.resolve(null) : cacheGet("yt:doc:" + id, COMMENT_TTL)).then((hit) => {
      if (hit) return hit;
      const remember = (doc) => {
        doc.fetchedAt = new Date().toISOString();
        return cacheSet("yt:doc:" + id, doc).then(() => doc);
      };
      return loadStatus().then(() => ivThread(id, post.handle || "").then((doc) => {
        if (doc && ((doc.replies || []).length || doc.commentCount != null)) return remember(doc);
        return pipedThread(id, post.handle || "").then((piped) => {
          if (piped && ((piped.replies || []).length || piped.commentCount != null)) return remember(piped);
          return ownPack("yt_" + id).then((own) => {
            if (!own || !(own.replies || []).length) return null;
            return cacheSet("yt:doc:" + id, own).then(() => own);
          });
        });
      }));
    })).catch(() => null);
  }

  function liveDuration(id) {
    return cacheGet("yt:dur:" + id).then((hit) => {
      if (hit != null) return hit;
      return rotate(ivBases(), "/api/v1/videos/" + encodeURIComponent(id), 3, "ivBase").then((video) => {
        if (video && video.lengthSeconds != null && Number(video.lengthSeconds) >= 0) return Number(video.lengthSeconds);
        return rotate(Promise.resolve(PIPED_SEEDS.slice()), "/streams/" + encodeURIComponent(id), 3, "pipedBase").then((stream) => {
          const n = stream && Number(stream.duration);
          return isFinite(n) && n >= 0 ? n : null;
        });
      }).then((seconds) => {
        if (seconds == null) return null;
        return cacheSet("yt:dur:" + id, seconds).then(() => seconds);
      });
    }).catch(() => null);
  }

  function liveSubs(channelId) {
    return cacheGet("yt:subs:" + channelId).then((hit) => {
      if (hit != null) return hit;
      return rotate(ivBases(), "/api/v1/channels/" + encodeURIComponent(channelId), 3, "ivBase").then((channel) => {
        const count = channel && (channel.subCount != null ? channel.subCount : channel.subscriberCount);
        if (count != null && Number(count) > 0) return Number(count);
        return rotate(Promise.resolve(PIPED_SEEDS.slice()), "/channel/" + encodeURIComponent(channelId), 3, "pipedBase").then((piped) => {
          const n = piped && Number(piped.subscriberCount);
          return isFinite(n) && n > 0 ? n : null;
        });
      }).then((count) => {
        if (count == null) return null;
        return cacheSet("yt:subs:" + channelId, count).then(() => count);
      });
    }).catch(() => null);
  }

  function ensureYtMeta(post) {
    if (!post || post.platform !== "youtube" || post.kind === "community") return;
    const id = postKey(post);
    if (!id || TRIED["dur:" + id]) return;
    TRIED["dur:" + id] = 1;
    liveDuration(id).then((seconds) => {
      if (seconds == null) return;
      const media = (post.media || [])[0];
      if (!media || media.duration === seconds) return;
      media.duration = seconds;
      post.short = seconds <= 60;
      render();
    });
  }

  function archiveSentinel() {
    if (!(ARCHIVE.order || []).some((name) => !ARCHIVE.loaded[name])) return "";
    return `<div id="archive-more" class="archive-more">Older posts</div>`;
  }

  function nextShardName() {
    return (ARCHIVE.order || []).find((name) => !ARCHIVE.loaded[name]) || "";
  }

  function utcMonth() {
    const now = new Date();
    return now.getUTCFullYear() + "-" + String(now.getUTCMonth() + 1).padStart(2, "0");
  }

  function archiveSources(file, fresh) {
    const raw = ARCHIVE_RAW + file;
    const cdn = ARCHIVE_CDN + file;
    const ia = ARCHIVE_IA + file;
    return fresh ? [raw, cdn, ia] : [cdn, raw, ia];
  }

  async function fetchArchive(file, fresh) {
    const urls = archiveSources(file, fresh);
    for (let i = 0; i < urls.length; i++) {
      try {
        const res = await fetch(urls[i], { cache: "no-cache", signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
        return await res.json();
      } catch (err) { /* try the next host */ }
    }
    return null;
  }

  async function loadShard(name) {
    if (!name || ARCHIVE.loaded[name]) return;
    if (!/^\d{4}-\d{2}$/.test(name) && name !== "undated") {
      ARCHIVE.loaded[name] = "miss";
      return;
    }
    ARCHIVE.loaded[name] = "loading";
    try {
      const fresh = name === utcMonth() || name === (ARCHIVE.order || [])[0];
      const rows = await fetchArchive(name + ".json", fresh);
      if (!Array.isArray(rows)) throw new Error("miss");
      rows.forEach((row) => {
        const post = expandStub(row);
        if (!post) return;
        if (ARCHIVE.posts.some((item) => postIdentity(item) === postIdentity(post))) return;
        ARCHIVE.posts.push(post);
      });
      ARCHIVE.loaded[name] = "ok";
    } catch (err) {
      ARCHIVE.loaded[name] = "miss";
    }
  }

  async function loadNewestShard() {
    ARCHIVE.order = [];
    ARCHIVE.loaded = {};
    ARCHIVE.posts = [];
    try {
      const index = await fetchArchive("index.json", true);
      if (!index) return;
      ARCHIVE.order = (index.shards || []).filter((name) => /^\d{4}-\d{2}$/.test(name) || name === "undated");
      if (ARCHIVE.order.length) await loadShard(ARCHIVE.order[0]);
    } catch (err) { /* the timeline stays on feeds.json */ }
  }

  function revealArchive() {
    const route = parseRoute();
    if (route.name !== "home" || (route.tab && route.tab !== "foryou")) { render(); return; }
    const center = document.querySelector("main.center");
    if (!center) { render(); return; }
    const seen = {};
    center.querySelectorAll("article[data-post]").forEach((el) => { seen[el.dataset.post] = true; });
    const list = posts().filter(inTimeline).sort(byStamp);
    const head = center.querySelector("article[data-post]");
    if (head && list[0] && list[0].id !== head.dataset.post && stamp(list[0]) > (head.dataset.date || "")) {
      render();
      return;
    }
    const extra = list.filter((post) => !seen[post.id]);
    const old = document.getElementById("archive-more");
    if (old) old.remove();
    if (extra.length) center.insertAdjacentHTML("beforeend", extra.map((post) => card(post)).join(""));
    const marker = archiveSentinel();
    if (marker) center.insertAdjacentHTML("beforeend", marker);
    watchHydration();
  }

  function loadNextShard() {
    if (parseRoute().name === "user") {
      loadMoreLive(parseRoute());
      return;
    }
    const name = nextShardName();
    if (!name || archiveBusy) return;
    archiveBusy = true;
    loadShard(name).then(() => {
      archiveBusy = false;
      render();
    });
  }

  function archiveCacheGet(key) {
    return idbGet("arch:" + key).then((parsed) => {
      if (!parsed || Date.now() - parsed.at >= HYDRATE_TTL) return null;
      return parsed.value;
    });
  }

  function archiveCacheSet(key, value) {
    return idbSet("arch:" + key, { at: Date.now(), value: value });
  }

  function fxGone(data, status) {
    if (status === 404) return true;
    if (!data || typeof data !== "object") return false;
    const code = data.code;
    return code === 404 || code === 144 || code === "404" || code === "144";
  }

  function hydrateX(id) {
    const key = String(id || "");
    if (!/^\d{1,24}$/.test(key)) return Promise.resolve(null);
    return fetch(FX + "/2/status/" + encodeURIComponent(key), { cache: "no-cache", signal: AbortSignal.timeout(8000) }).then(async (res) => {
      let data = null;
      try { data = await res.json(); } catch (err) { data = null; }
      if (fxGone(data, res.status)) return { tombstone: true };
      if (!res.ok) return null;
      const status = fxStatusObject(data);
      if (!status || fxUnavailable(status)) return null;
      return fxFromStatus(status);
    }).catch(() => null);
  }

  function hydrateCommunity(post) {
    const ucid = (feedOf(post).channelId) || "";
    let path = "/api/v1/post/" + encodeURIComponent(post.id);
    if (ucid) path += "?ucid=" + encodeURIComponent(ucid);
    return rotate(ivBases(), path, 3, "ivBase").then((payload) => {
      if (!payload || typeof payload !== "object") return null;
      const error = String(payload.error || "");
      if (error && /unavailable|not found|private|removed/i.test(error)) return { tombstone: true };
      const rows = payload.comments || [];
      const item = rows.find((row) => row && row.commentId === post.id) || rows[0];
      if (!item || !item.commentId) return null;
      return communityFromIv(item, post);
    }).catch(() => null);
  }

  function hydrateYt(post) {
    if (post.kind === "community") return hydrateCommunity(post);
    const id = post.id;
    return rotate(ivBases(), "/api/v1/videos/" + encodeURIComponent(id), 3, "ivBase").then((video) => {
      if (!video || typeof video !== "object") return null;
      const error = String(video.error || "");
      if (error && /unavailable|not found|private|removed/i.test(error)) return { tombstone: true };
      const next = Object.assign({}, post, { stub: false });
      if (video.title) next.text = video.title;
      const views = Number(video.viewCount);
      if (isFinite(views) && views > 0) next.stats = Object.assign({}, post.stats, { views: views });
      const seconds = Number(video.lengthSeconds);
      if (isFinite(seconds) && seconds >= 0) {
        next.media = (next.media || []).map((item) => Object.assign({}, item));
        if (next.media[0]) next.media[0].duration = seconds;
      }
      return next;
    }).catch(() => null);
  }

  function applyHydrated(key, value, stub) {
    if (!value) return;
    if (value.tombstone) {
      HYDRATED[key] = Object.assign({}, stub, { tombstone: true, text: "", media: [], stub: false });
      return;
    }
    HYDRATED[key] = Object.assign({}, value, {
      stub: false,
      feedId: stub.feedId || value.feedId || "",
      platform: stub.platform || value.platform
    });
  }

  function hydrateKey(key) {
    if (!key || HYDRATED[key] || HYDRATE_FLIGHT[key] || HYDRATE_MISS[key]) return;
    const stub = ARCHIVE.posts.find((item) => postIdentity(item) === key);
    if (!stub || !stub.stub) return;
    if (stub.platform === "instagram" || stub.platform === "threads" || stub.platform === "rss") {
      HYDRATE_MISS[key] = true;
      return;
    }
    HYDRATE_FLIGHT[key] = true;
    archiveCacheGet(key).then((cached) => {
      if (cached) return cached;
      const pending = stub.platform === "x" ? hydrateX(stub.id) : stub.platform === "youtube" ? hydrateYt(stub) : Promise.resolve(null);
      return pending.then((value) => {
        if (!value) return null;
        return archiveCacheSet(key, value).then(() => value);
      });
    }).then((value) => {
      delete HYDRATE_FLIGHT[key];
      if (!value) {
        HYDRATE_MISS[key] = true;
        return;
      }
      applyHydrated(key, value, stub);
      render();
    }).catch(() => {
      delete HYDRATE_FLIGHT[key];
      HYDRATE_MISS[key] = true;
    });
  }

  function watchHydration() {
    if (typeof IntersectionObserver !== "function") return;
    if (!HYDRATE_OBS) {
      HYDRATE_OBS = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          hydrateKey(entry.target.getAttribute("data-hydrate"));
        });
      }, { rootMargin: "400px" });
    }
    HYDRATE_OBS.disconnect();
    document.querySelectorAll("[data-hydrate]").forEach((el) => HYDRATE_OBS.observe(el));
    if (!ARCHIVE_OBS) {
      ARCHIVE_OBS = new IntersectionObserver((entries) => {
        if (entries.some((entry) => entry.isIntersecting)) loadNextShard();
      }, { rootMargin: "600px" });
    }
    ARCHIVE_OBS.disconnect();
    const sentinel = document.getElementById("archive-more");
    if (sentinel) ARCHIVE_OBS.observe(sentinel);
    const liveSentinel = document.getElementById("live-more");
    if (liveSentinel) ARCHIVE_OBS.observe(liveSentinel);
  }

  function ensureYtSubs(feed) {
    if (!feed || feed.platform !== "youtube" || !feed.channelId) return;
    const key = "subs:" + feed.channelId;
    if (TRIED[key]) return;
    TRIED[key] = 1;
    liveSubs(feed.channelId).then((count) => {
      if (count == null || feed.followers === count) return;
      feed.followers = count;
      render();
    });
  }

  function orderReplies(focus, shown) {
    const used = new Set();
    const lifted = [];
    let cursor = focus;
    for (let guard = 0; guard < 20; guard++) {
      const next = shown.find((other) => !used.has(postKey(other)) && sameThread(cursor, other));
      if (!next) break;
      lifted.push(next);
      used.add(postKey(next));
      cursor = next;
    }
    const rest = shown.filter((other) => !used.has(postKey(other)));
    const seen = new Set();
    const clustered = [];
    rest.forEach((post) => {
      if (seen.has(postKey(post))) return;
      clustered.push(post);
      seen.add(postKey(post));
      let current = post;
      for (let guard = 0; guard < 20; guard++) {
        const child = rest.find((other) => !seen.has(postKey(other)) && sameThread(current, other));
        if (!child) break;
        clustered.push(child);
        seen.add(postKey(child));
        current = child;
      }
    });
    return lifted.concat(clustered);
  }

  function replySlice(post) {
    const bucket = replyBucket(post);
    if (bucket.loading) return { loading: true, shown: [], more: false, spam: false, missing: false };
    const fetched = bucket.replies || [];
    const have = new Set(fetched.map(postKey));
    const extras = threadChildren(post).filter((child) => !have.has(postKey(child)));
    const all = fetched.concat(extras);
    if (!all.length) return { loading: false, shown: [], more: false, spam: false, missing: !!bucket.missing };
    const ui = STATE.replyUi[postKey(post)] || {};
    const clean = all.filter((reply) => !reply.spam);
    const junk = all.filter((reply) => reply.spam && isDirect(post, reply));
    const pool = ui.spam ? clean.concat(junk) : clean;
    let directs = pool.filter((reply) => isDirect(post, reply));
    const sort = replySortMode();
    let shown;
    if (sort === "recent") shown = directs.slice().sort(byRecent);
    else if (sort === "liked") shown = directs.slice().sort(byLikes);
    else shown = orderReplies(post, directs);
    return { loading: false, shown: shown, pool: clean, more: false, spam: !ui.spam && junk.length > 0, missing: false };
  }

  function isDirect(focus, reply) {
    const to = String((reply.replyingTo || {}).id || "");
    if (!to) return true;
    return to === postKey(focus) || to === String(focus.id || "");
  }

  function childPool(reply, siblings) {
    const count = Number((reply.stats || {}).replies || 0);
    if (!(count > 0)) return siblings;
    const bucket = replyBucket(reply);
    if (bucket.loading || bucket.missing || !(bucket.replies || []).length) return siblings;
    const seen = new Set((bucket.replies || []).map(postKey));
    const extra = (siblings || []).filter((item) => item && !seen.has(postKey(item)));
    return bucket.replies.concat(extra);
  }

  function inlineChildren(reply, pool) {
    const out = [];
    const used = new Set();
    let cursor = reply;
    for (let guard = 0; guard < 3; guard++) {
      const next = (pool || []).find((other) => other && !other.spam && !used.has(postKey(other)) && sameThread(cursor, other));
      if (!next) break;
      out.push(next);
      used.add(postKey(next));
      cursor = next;
    }
    return out;
  }

  function inlineOp(reply, pool, rootHandle) {
    const root = String(rootHandle || "").toLowerCase();
    const mine = String(reply.handle || "").toLowerCase();
    if (!root || root === mine) return null;
    const id = postKey(reply);
    return (pool || []).find((other) => {
      if (!other || other.spam) return false;
      if (String(other.handle || "").toLowerCase() !== root) return false;
      const to = String((other.replyingTo || {}).id || "");
      return to === id || to === String(reply.id || "");
    }) || null;
  }

  function repliesLink(reply, shown) {
    if (reply && reply._community) return "";
    const total = Number((reply.stats || {}).replies || 0);
    if (!(total > shown)) return "";
    const label = shown ? "Show more replies" : "Show replies";
    return `<a class="show-replies" data-act="stop" href="${esc(statusHash(reply))}">${label}</a>`;
  }

  function freshLabel(at) {
    const t = typeof at === "number" ? at : Date.parse(at || "");
    if (!isFinite(t) || t <= 0) return "Updating…";
    const mins = Math.max(0, Math.floor((Date.now() - t) / 60000));
    if (mins < 1) return "Updated just now";
    return "Updated " + mins + " min ago";
  }

  function replySortMode() {
    return STATE.replySort === "recent" || STATE.replySort === "liked" ? STATE.replySort : "relevant";
  }

  function byRecent(a, b) {
    return String(b.date || "").localeCompare(String(a.date || "")) || fxNum((b.stats || {}).likes) - fxNum((a.stats || {}).likes);
  }

  function byLikes(a, b) {
    return fxNum((b.stats || {}).likes) - fxNum((a.stats || {}).likes) || String(b.date || "").localeCompare(String(a.date || ""));
  }

  function replySortTabs() {
    const sort = replySortMode();
    const tab = (id, label) => `<button class="tab${sort === id ? " on" : ""}" type="button" data-act="reply-sort" data-sort="${id}" role="tab" aria-selected="${sort === id ? "true" : "false"}"><span>${label}</span></button>`;
    return `<div class="tabs reply-tabs" role="tablist">${tab("relevant", "Relevant")}${tab("recent", "Recent")}${tab("liked", "Liked")}</div>`;
  }

  function replyTools(post) {
    const bucket = STATE.replies[postKey(post)] || {};
    return `<div class="reply-tools"><span class="reply-fresh">${esc(freshLabel(bucket.fetchedAt))}</span></div>${replySortTabs()}`;
  }

  function replyList(post) {
    const tools = replyTools(post);
    const slice = replySlice(post);
    if (slice.loading) return tools + `<div class="reply-empty">Loading replies…</div>`;
    if (!slice.shown.length && !slice.more && !slice.spam) {
      return tools + `<div class="reply-empty">${slice.missing ? "Replies aren’t available for this post." : "No replies yet."}</div>`;
    }
    const id = postKey(post);
    const root = originalHandle(post);
    const html = slice.shown.map((reply) => {
      const pool = childPool(reply, slice.pool);
      let inline = inlineChildren(reply, pool);
      if (!inline.length) {
        const op = inlineOp(reply, pool, root);
        if (op) inline = [op];
      }
      const cards = [reply].concat(inline);
      return cards.map((item, index) => card(item, "reply", {
        focus: index === 0 ? post : cards[index - 1],
        continues: index < cards.length - 1
      })).join("") + repliesLink(reply, inline.length);
    }).join("");
    const more = slice.more ? `<button class="more-replies" type="button" data-act="more-replies" data-id="${esc(id)}">Show more replies</button>` : "";
    const spam = slice.spam ? `<button class="more-replies spam" type="button" data-act="spam-replies" data-id="${esc(id)}">Show probable spam</button>` : "";
    return tools + html + more + spam;
  }

  function composer(bridge) {
    return `<div class="composer${bridge ? " bridge" : ""}">
      <span class="ava initials">Y</span>
      <div class="composer-main">
        <div class="composer-placeholder">Post your reply</div>
        <div class="composer-bar"><button class="reply-send" type="button" disabled>Reply</button></div>
      </div>
    </div>`;
  }

  function tombstoneCard(post) {
    const face = authorFace(post);
    const when = post.date ? `<span class="dot">·</span><a class="time" href="${esc(statusHash(post))}">${esc(relTime(post.date))}</a>` : "";
    return `<article class="post tombstone">
      <div class="post-row">
        ${avatar(face.avatar, post.author || post.handle)}
        <div class="post-main">
          <div class="byline">
            <a class="name" href="${esc(userHash(post.platform, post.handle))}" data-card="${esc((post.platform || "x") + ":" + (post.handle || ""))}">${esc(post.author || post.handle || "Post")}${badge(face.verified)}</a>
            ${post.handle ? `<a class="handle" href="${esc(userHash(post.platform, post.handle))}" data-card="${esc((post.platform || "x") + ":" + post.handle)}">@${esc(post.handle)}</a>` : ""}
            ${when}
            ${sourceBadge(post.platform)}
          </div>
          <div class="unavailable">This post is unavailable.</div>
        </div>
      </div>
    </article>`;
  }

  function pollHtml(post) {
    const poll = post && post.poll;
    if (!poll || !Array.isArray(poll.choices)) return "";
    const choices = poll.choices.filter((choice) => choice && choice.text);
    if (!choices.length) return "";
    const total = Number(poll.totalVotes);
    const rows = choices.map((choice) => {
      let pct = choice.percent != null ? Number(choice.percent) : null;
      if ((pct == null || !isFinite(pct)) && choice.votes != null && isFinite(total) && total > 0) pct = (Number(choice.votes) / total) * 100;
      const has = pct != null && isFinite(pct);
      const bar = has ? `<span class="poll-bar" style="width:${Math.max(0, Math.min(100, pct))}%"></span>` : "";
      const label = has ? `<span class="poll-pct">${esc(String(Math.round(pct)))}%</span>` : "";
      return `<div class="poll-choice">${bar}<span class="poll-label">${esc(choice.text)}</span>${label}</div>`;
    }).join("");
    const votes = isFinite(total) && total >= 0 && poll.totalVotes != null ? `<div class="poll-total">${esc(formatCount(total))} votes</div>` : "";
    return `<div class="poll">${rows}${votes}</div>`;
  }

  function card(post, mode, opts) {
    if (post && post.tombstone) return tombstoneCard(post);
    opts = opts || {};
    const hideRepost = mode === "author" || mode === "status";
    const repost = !hideRepost && post.repostedBy ? `<div class="repost-line">${icon("repost")}<a data-card="${esc("x:" + (post.repostedBy.handle || ""))}" href="${esc(userHash("x", post.repostedBy.handle))}">${esc(post.repostedBy.name || post.repostedBy.handle)} reposted</a></div>` : "";
    const showReply = mode === "reply" ? relevantReply(post, opts.focus) : !!(post.replyingTo && post.replyingTo.handle);
    const reply = showReply ? `<div class="replying">Replying to <a data-act="stop" data-card="${esc((post.platform || "x") + ":" + post.replyingTo.handle)}" href="${esc(userHash(post.platform || "x", post.replyingTo.handle))}">@${esc(post.replyingTo.handle)}</a></div>` : "";
    const menu = STATE.menu === post.id ? `<div class="menu" data-act="stop"><button data-act="copy" data-url="${esc(sitePermalink(statusHash(post)))}">Copy link</button><a data-act="stop" target="_blank" rel="noopener noreferrer" href="${esc(post.url || "#")}">View on ${esc(PLATFORM[post.platform] || "web")}</a></div>` : "";
    const continues = !!opts.continues;
    const face = authorFace(post);
    const eager = !!opts.eager;
    const dest = post.watch ? watchHash(post) : statusHash(post);
    const who = post.profileHandle || post.handle;
    const avaLink = `<a href="${esc(userHash(post.platform, who))}" data-card="${esc(post.platform + ":" + who)}">${avatar(face.avatar, post.author || post.handle)}</a>`;
    const avaCol = continues ? `<div class="ava-col">${avaLink}<div class="thread-line"></div></div>` : avaLink;
    const open = ` data-open="${esc(dest)}"`;
    const threadLink = mode !== "status" && mode !== "reply" && threadChildren(post).length
      ? `<a class="show-thread" href="${esc(statusHash(post))}" data-act="stop">Show this thread</a>` : "";
    const hydrate = post.stub ? ` data-hydrate="${esc(postIdentity(post))}"` : "";
    return `<article class="post${continues ? " continues" : ""}${mode === "reply" ? " reply-card" : ""}" data-post="${esc(post.id)}" data-date="${esc(post.date || "")}"${open}${hydrate}>
      ${repost}
      <div class="post-row">
        ${avaCol}
        <div class="post-main">
          <div class="byline">
            <a class="name" href="${esc(userHash(post.platform, who))}" data-card="${esc(post.platform + ":" + who)}">${esc(post.author || post.handle)}${badge(face.verified)}</a>
            ${post.handle ? `<a class="handle" href="${esc(userHash(post.platform, who))}" data-card="${esc(post.platform + ":" + who)}">@${esc(post.handle)}</a>` : ""}
            <span class="dot">·</span>
            <a class="time" href="${esc(dest)}">${esc(relTime(post.date))}</a>
            ${sourceBadge(post.platform)}
            <button class="more-btn" data-act="menu" data-id="${esc(post.id)}" aria-label="More">${icon("more")}</button>
          </div>
          ${reply}
          <div class="post-text">${textHtml(post, post.id, false)}</div>
          ${pollHtml(post)}
          ${mediaHtml(post.media, eager)}
          ${quoteCard(post.quoted)}
          ${threadLink}
          ${actionBar(post)}
        </div>
      </div>
      ${menu}
    </article>`;
  }

  function emptyBlock(title, body) {
    return `<div class="empty"><h2>${esc(title)}</h2><p>${esc(body)}</p></div>`;
  }

  function parseRoute() {
    const hash = location.hash || "#/";
    const qAt = hash.indexOf("?");
    const query = qAt >= 0 ? new URLSearchParams(hash.slice(qAt + 1)) : new URLSearchParams();
    const path = (qAt >= 0 ? hash.slice(0, qAt) : hash).replace(/^#/, "") || "/";
    const parts = path.split("/").filter(Boolean).map((part) => {
      try { return decodeURIComponent(part); } catch (err) { return part; }
    });
    if (!parts.length || parts[0] === "home") return { name: "home", tab: parts[1] === "following" ? "following" : parts[1] === "tab" ? "list:" + parts[2] : "foryou", query };
    if (parts[0] === "following") return { name: "home", tab: "following", query };
    if (parts[0] === "subscriptions") return { name: "subscriptions", channel: query.get("c") || "", query };
    if (parts[0] === "watch") {
      const spec = parts.slice(1).join("/");
      const cut = spec.indexOf(":");
      if (cut > 0) return { name: "watch", platform: spec.slice(0, cut), id: spec.slice(cut + 1), query };
    }
    if (parts[0] === "tab" && parts[1]) return { name: "home", tab: "list:" + parts[1], query };
    if (parts[0] === "status" && parts.length === 1) return { name: "sources", query };
    if (parts[0] === "u" && parts[1] && parts[2]) {
      const platform = parts[1] === "twitter" ? "x" : parts[1];
      return { name: "user", platform: platform, handle: parts[2], query };
    }
    const names = ["explore", "notifications", "messages", "feeds", "lists", "bookmarks", "settings", "incoming"];
    if (names.includes(parts[0]) && parts.length === 1) return { name: parts[0], query };
    if (parts[0] === "lists" && parts[1]) return { name: "list", id: parts[1], query };
    let platform = "x";
    let handle = "";
    let rest = [];
    if (parts[0].startsWith("@")) {
      handle = parts[0].slice(1);
      rest = parts.slice(1);
    } else if (["x", "threads", "instagram", "rss", "youtube"].includes(parts[0])) {
      platform = parts[0];
      handle = parts[1] || "";
      rest = parts.slice(2);
    } else {
      return { name: "home", tab: "foryou", query };
    }
    if (rest[0] === "status" && rest[1]) return { name: "status", platform, handle, id: rest.slice(1).join("/"), query };
    return { name: "profile", platform, handle, query };
  }

  function navItem(href, name, label, on) {
    return `<a class="nav-item${on ? " on" : ""}" href="${href}">${icon(on && name === "home" ? "homeOn" : name)}<span class="nav-label">${label}</span></a>`;
  }

  function nav(route) {
    const name = route.name;
    return `<header class="nav">
      <div class="nav-scroll">
        <a class="logo" href="#/" aria-label="Home">${icon("logo")}</a>
        ${navItem("#/", "home", "Home", name === "home")}
        ${navItem("#/explore", "search", "Explore", name === "explore")}
        ${navItem("#/notifications", "bell", "Notifications", name === "notifications")}
        ${navItem("#/messages", "mail", "Messages", name === "messages")}
        ${navItem("#/feeds", "spark", "Feeds", name === "feeds")}
        ${navItem("#/lists", "lists", "Lists", name === "lists" || name === "list")}
        ${navItem("#/bookmarks", "bookmark", "Bookmarks", name === "bookmarks")}
        ${navItem("#/subscriptions", "subs", "Subscriptions", name === "subscriptions")}
        ${navItem("#/settings", "more", "More", name === "settings")}
        <button class="post-btn" data-act="compose"><span class="post-label">Post</span><svg class="post-ico" viewBox="0 0 24 24"><path d="${PATH.feather}"/></svg></button>
      </div>
      <button class="account-pill" data-act="drawer" aria-label="Account menu">
        <span class="ava initials">Y</span>
        <span class="account-meta"><b>You</b><span>@reader</span></span>
        <span class="dots">${icon("more")}</span>
      </button>
    </header>`;
  }

  function followSuggestions() {
    return feeds().filter((f) => f.id && !isFollowed(f.id)).sort((a, b) => (b.configured ? 1 : 0) - (a.configured ? 1 : 0));
  }

  function sidebar() {
    const people = followSuggestions().slice(0, 3);
    const rows = people.map((f) => `<div class="who-row">
      <a class="who-main" href="${esc(userHash(f.platform, f.channelId || f.handle))}" data-card="${esc(f.id)}">
        ${avatar(f.avatar, f.name)}
        <span class="who-copy"><span class="name">${esc(f.name)}${badge(f.verifiedType)}</span><span class="handle">@${esc(f.handle)} ${sourceBadge(f.platform)}</span></span>
      </a>
      ${followButtonClean(f.id)}
    </div>`).join("");
    return `<aside class="side">
      <form class="side-search" data-act="search-form">
        <label class="search"><span class="sr">${icon("search")}</span><input id="side-q" type="search" placeholder="Search" aria-label="Search"></label>
      </form>
      ${people.length ? `<section class="card"><h2>Who to follow</h2>${rows}<a class="show-more-row" href="#/feeds">Show more</a></section>` : ""}
      <div class="fineprint"><span>Preview snapshot</span><a href="https://github.com/owner-account/rss-feeds">GitHub</a><span>Not affiliated with X</span></div>
    </aside>`;
  }

  function bottom(route) {
    const item = (href, name, label, on) => `<a href="${href}" class="${on ? "on" : ""}" aria-label="${label}">${icon(name)}</a>`;
    return `<nav class="bottom-nav" aria-label="Primary">
      ${item("#/", route.name === "home" ? "homeOn" : "home", "Home", route.name === "home")}
      ${item("#/explore", "search", "Search", route.name === "explore")}
      ${item("#/feeds", "spark", "Feeds", route.name === "feeds")}
      ${item("#/notifications", "bell", "Notifications", route.name === "notifications")}
      ${item("#/messages", "mail", "Messages", route.name === "messages")}
    </nav>
    <button class="fab" data-act="compose" aria-label="Post">${icon("plus")}</button>`;
  }

  function homeHeader(tab) {
    const lists = STATE.settings.lists.filter((l) => l.pinned);
    const tabBtn = (id, label, on) => `<button class="tab${on ? " on" : ""}" data-act="htab" data-tab="${esc(id)}" role="tab" aria-selected="${on ? "true" : "false"}"><span>${esc(label)}</span></button>`;
    return `<div class="topbar tall">
      <div class="mhead">
        <button class="m-ava" data-act="drawer" aria-label="Menu"><span class="ava initials">Y</span></button>
        <a class="m-logo" href="#/" aria-label="Home">${icon("logo")}</a>
        <a class="m-icon" href="#/settings" aria-label="Settings">${icon("spark")}</a>
      </div>
      <div class="tabs" role="tablist">
        ${tabBtn("foryou", "For you", tab === "foryou")}
        ${tabBtn("following", "Following", tab === "following")}
        ${lists.map((l) => tabBtn("list:" + l.id, l.name, tab === "list:" + l.id)).join("")}
      </div>
    </div>`;
  }

  function listMembersPosts(list) {
    const ids = new Set(list.members || []);
    return posts().filter((p) => ids.has(p.feedId) || ids.has((p.platform || "x") + ":" + p.handle)).sort(byStamp);
  }

  function homeView(route) {
    const tab = route.tab || "foryou";
    let list = posts().slice().sort(byStamp);
    if (tab === "following") {
      const followed = new Set(STATE.settings.follows);
      list = list.filter((p) => followed.has(p.feedId) || followed.has((p.platform || "x") + ":" + p.handle));
    }
    if (tab.startsWith("list:")) {
      const found = STATE.settings.lists.find((l) => l.id === tab.slice(5));
      list = found ? listMembersPosts(found) : [];
    }
    list = list.filter(inTimeline);
    const body = list.length ? list.map((p, i) => card(p, null, { eager: i === 0 })).join("") : emptyBlock(
      tab === "following" ? "Nothing to see here — yet" : tab.startsWith("list:") ? "No posts in this List" : "No posts yet",
      tab === "following" ? "When you follow accounts, their posts show up here." : tab.startsWith("list:") ? "Posts from members of this List will show up here." : "Posts from your feeds will show up here."
    );
    return homeHeader(tab) + body + archiveSentinel();
  }

  function pageHead(title, extra, back, action) {
    return `<div class="topbar tall"><div class="mhead">
        <button class="m-ava" data-act="drawer" aria-label="Menu"><span class="ava initials">Y</span></button>
        <a class="m-logo" href="#/" aria-label="Home">${icon("logo")}</a>
        <a class="m-icon" href="#/settings" aria-label="Settings">${icon("spark")}</a>
      </div>
      <div class="page-head">${back ? `<button class="icon-btn" data-act="back" aria-label="Back">${icon("back")}</button>` : ""}<div class="head-text grow"><h1>${esc(title)}</h1>${extra || ""}</div>${action || ""}</div></div>`;
  }

  function liveKey(platform, handle) {
    return (platform || "x") + ":" + String(handle || "").replace(/^@/, "").toLowerCase();
  }

  function blankLive(platform, handle) {
    return {
      platform: platform || "x",
      handle: String(handle || "").replace(/^@/, ""),
      loading: false,
      settled: false,
      fetchedAt: 0,
      profile: null,
      posts: [],
      replies: [],
      media: [],
      videos: [],
      community: [],
      cursor: {},
      paging: "",
      error: "",
      limited: false,
      saved: false,
      source: ""
    };
  }

  function rememberLive(post) {
    const id = String((post && (post.statusId || post.id)) || "");
    if (id) STATE.shared[id] = post;
  }

  function rememberedPerson(platform, handle) {
    const h = String(handle || "").replace(/^@/, "").toLowerCase();
    if (!h) return null;
    const pool = posts().slice();
    Object.keys(STATE.replies || {}).forEach((key) => {
      const bucket = STATE.replies[key] || {};
      (bucket.replies || []).forEach((row) => pool.push(row));
      commentRows(bucket.doc).forEach((row) => pool.push(row));
    });
    return pool.find((post) => post && (post.platform || "x") === platform && String(post.handle || "").toLowerCase() === h) || null;
  }

  function catalogFeed(profile) {
    if (!profile) return null;
    return feedById(profile.id) || findFeed(profile.platform, profile.handle) || findFeed(profile.platform, profile.displayHandle) || (profile.channelId ? feeds().find((feed) => feed.channelId === profile.channelId) : null) || null;
  }

  function needsSyncNote(profile) {
    const feed = catalogFeed(profile);
    return !feed || !feed.configured;
  }

  function liveFollowId(profile) {
    const feed = catalogFeed(profile);
    if (feed && feed.id) return feed.id;
    return (profile.platform || "x") + ":" + (profile.handle || "");
  }

  function liveProfileById(id) {
    const wanted = String(id || "");
    const rows = STATE.liveUsers || {};
    const keys = Object.keys(rows);
    for (let i = 0; i < keys.length; i++) {
      const profile = rows[keys[i]] && rows[keys[i]].profile;
      if (!profile) continue;
      if (profile.id === wanted || keys[i] === wanted.toLowerCase() || liveFollowId(profile) === wanted) return profile;
    }
    return null;
  }

  function profileStub(id) {
    const cut = String(id || "").indexOf(":");
    if (cut < 1) return null;
    return { id: id, platform: id.slice(0, cut), handle: id.slice(cut + 1), name: id.slice(cut + 1), bio: "" };
  }

  function fxLivePost(status) {
    const wrapped = status && status.tweet && typeof status.tweet === "object" ? status.tweet : status;
    const post = fxFromStatus(wrapped);
    if (!post) return null;
    const by = fxPerson(wrapped.reposted_by || wrapped.retweeted_by);
    if (by && by.handle) {
      post.repostedBy = by;
      post.kind = "repost";
    }
    if (wrapped.quote && typeof wrapped.quote === "object") {
      const quoted = fxFromStatus(wrapped.quote);
      if (quoted) {
        post.quoted = quoted;
        if (post.kind === "post") post.kind = "quote";
      }
    }
    return post;
  }

  function fxOwned(post, handle) {
    const h = String(handle || "").replace(/^@/, "").toLowerCase();
    if (!h || !post) return false;
    if (post.repostedBy && String(post.repostedBy.handle || "").toLowerCase() === h) return true;
    return String(post.handle || "").toLowerCase() === h;
  }

  function takeFx(posts, kind) {
    if (kind === "replies") return (posts || []).filter((post) => post.kind === "reply");
    if (kind === "media") return (posts || []).filter((post) => (post.media || []).length);
    return (posts || []).filter((post) => post.kind !== "reply");
  }

  function fxUserProfile(user) {
    let website = user.website || "";
    if (website && typeof website === "object") website = website.url || "";
    website = String(website || "");
    const home = user.url || ("https://x.com/" + user.screen_name);
    if (/^(https?:\/\/)?(www\.)?(x|twitter)\.com\//i.test(website)) website = "";
    return {
      id: "x:" + user.screen_name,
      platform: "x",
      handle: user.screen_name,
      name: user.name || user.screen_name,
      avatar: upgradeAvatar(user.avatar_url || ""),
      banner: user.banner_url || "",
      bio: user.description || "",
      location: user.location || "",
      website: website,
      joined: isoDate(user.joined || ""),
      following: user.following != null ? user.following : null,
      followers: user.followers != null ? user.followers : null,
      postsCount: user.tweets != null ? user.tweets : (user.statuses != null ? user.statuses : null),
      verifiedType: fxVerified(user),
      url: home
    };
  }

  function fxHeader(handle) {
    if (LIVE.fxDown) return Promise.resolve(null);
    const once = () => fetchJson(FX + "/" + encodeURIComponent(handle)).then((data) => {
      const user = data && (data.user || data.profile);
      if (!user || !user.screen_name) return null;
      return fxUserProfile(user);
    }).catch((err) => ({ error: String((err && (err.status || err.message)) || err) }));
    return once().then((profile) => (profile && profile.handle ? profile : once()));
  }

  function fxTimeline(handle, kind, cursor) {
    if (LIVE.fxDown) return Promise.resolve(null);
    let path = "/2/profile/" + encodeURIComponent(handle) + (kind === "media" ? "/media" : "/statuses");
    const query = ["count=40"];
    if (kind === "replies") query.push("with_replies=1");
    if (cursor) query.push("cursor=" + encodeURIComponent(cursor));
    return fetchJson(FX + path + "?" + query.join("&")).then((data) => {
      const posts = [];
      let profile = null;
      const h = String(handle || "").toLowerCase();
      ((data && data.results) || []).forEach((item) => {
        if (!item || typeof item !== "object") return;
        const author = item.author;
        if (!profile && author && String(author.screen_name || "").toLowerCase() === h) profile = fxUserProfile(author);
        const by = item.reposted_by || item.retweeted_by;
        if (!profile && by && String(by.screen_name || "").toLowerCase() === h) profile = fxUserProfile(by);
        const post = fxLivePost(item);
        if (post && fxOwned(post, handle)) posts.push(post);
      });
      const bottom = data && data.cursor && data.cursor.bottom;
      return { posts: posts, cursor: bottom || "", profile: profile };
    }).catch(() => null);
  }

  function fxPages(handle, kind, cursor, left) {
    return fxTimeline(handle, kind, cursor).then((pack) => {
      if (!pack) return null;
      const posts = takeFx(pack.posts, kind);
      const nextCursor = pack.cursor === cursor ? "" : pack.cursor;
      if (posts.length || !pack.cursor || left <= 0 || pack.cursor === cursor) return { posts: posts, cursor: nextCursor, profile: pack.profile || null };
      return fxPages(handle, kind, pack.cursor, left - 1).then((more) => {
        if (!more) return { posts: posts, cursor: "", profile: pack.profile || null };
        return { posts: posts.concat(more.posts), cursor: more.cursor, profile: pack.profile || more.profile || null };
      });
    });
  }

  function parseNitterRss(xml, handle) {
    if (!xml || String(xml).indexOf("<item") < 0 || typeof DOMParser === "undefined") return [];
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    if (!doc || doc.querySelector("parsererror")) return [];
    const out = [];
    const items = doc.getElementsByTagName("item");
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const link = (item.getElementsByTagName("link")[0] && item.getElementsByTagName("link")[0].textContent) || "";
      const title = ((item.getElementsByTagName("title")[0] && item.getElementsByTagName("title")[0].textContent) || "").trim();
      const desc = (item.getElementsByTagName("description")[0] && item.getElementsByTagName("description")[0].textContent) || "";
      const published = (item.getElementsByTagName("pubDate")[0] && item.getElementsByTagName("pubDate")[0].textContent) || "";
      const status = String(link).match(/\/([A-Za-z0-9_]{1,30})\/status\/(\d+)/);
      if (!status) continue;
      const authorHandle = status[1];
      const statusId = status[2];
      const rt = title.match(/^RT by @([A-Za-z0-9_]{1,30})\s*:/i);
      const holder = document.createElement("div");
      holder.innerHTML = desc;
      const text = (holder.textContent || "").replace(/\s+/g, " ").trim();
      const media = [];
      holder.querySelectorAll("img").forEach((img) => {
        const src = img.getAttribute("src") || "";
        if (src && !/profile_images|avatar/i.test(src)) media.push({ type: "photo", url: src, poster: src });
      });
      const reply = /^R to @/i.test(title);
      const post = {
        id: statusId,
        statusId: statusId,
        platform: "x",
        kind: rt ? "repost" : reply ? "reply" : "post",
        author: rt ? authorHandle : handle,
        handle: authorHandle || handle,
        text: text || title,
        date: isoDate(published),
        url: "https://x.com/" + (authorHandle || handle) + "/status/" + statusId,
        media: media,
        stats: {}
      };
      if (rt) post.repostedBy = { name: rt[1], handle: rt[1], avatar: "" };
      if (fxOwned(post, handle) || (post.repostedBy && String(post.repostedBy.handle).toLowerCase() === handle.toLowerCase())) out.push(post);
    }
    return out;
  }

  function nitterPosts(handle) {
    const bases = NITTER_RSS.filter((base) => !LIVE.dead[base]);
    if (!bases.length) return Promise.resolve(null);
    return new Promise((resolve) => {
      let pending = bases.length;
      let done = false;
      const finish = (posts) => {
        if (done) return;
        done = true;
        resolve(posts && posts.length ? posts : null);
      };
      const timer = setTimeout(() => finish(null), 2500);
      bases.forEach((base) => {
        const url = base.replace(/\/$/, "") + "/" + encodeURIComponent(handle) + "/rss";
        fetch(url, { cache: "no-cache", signal: AbortSignal.timeout(2000) }).then((res) => {
          if (!res.ok) throw new Error(String(res.status));
          return res.text();
        }).then((xml) => {
          const posts = parseNitterRss(xml, handle);
          if (posts.length) {
            clearTimeout(timer);
            finish(posts);
          }
        }).catch(() => {
          LIVE.dead[base] = true;
        }).finally(() => {
          pending -= 1;
          if (!pending) {
            clearTimeout(timer);
            finish(null);
          }
        });
      });
    });
  }

  function ivBest(list) {
    let best = "";
    let width = -1;
    (list || []).forEach((thumb) => {
      if (!thumb || !thumb.url) return;
      const w = Number(thumb.width || 0);
      if (w >= width) {
        best = thumb.url;
        width = w;
      }
    });
    if (String(best).indexOf("//") === 0) best = "https:" + best;
    return best;
  }

  function ytProfileFromChannel(data, requested) {
    const id = data.authorId || requested;
    const known = feeds().find((feed) => feed.platform === "youtube" && (feed.channelId === id || String(feed.handle || "").toLowerCase() === String(requested || "").toLowerCase()));
    const joined = Number(data.joined) > 1000000000 ? ivIso(data.joined) : "";
    return {
      id: known && known.id ? known.id : "youtube:" + id,
      platform: "youtube",
      handle: id,
      displayHandle: known && known.handle ? known.handle : "",
      channelId: id,
      name: data.author || (known && known.name) || id,
      avatar: ivBest(data.authorThumbnails) || (known && known.avatar) || "",
      banner: ivBest(data.authorBanners) || (known && known.banner) || "",
      bio: data.description || (known && known.bio) || "",
      location: "",
      website: "",
      joined: joined,
      following: null,
      followers: data.subCount != null ? data.subCount : null,
      postsCount: null,
      verifiedType: data.authorVerified ? "blue" : "",
      url: "https://www.youtube.com/channel/" + id
    };
  }

  function ivVideoPost(video, profile) {
    const id = video && (video.videoId || video.id);
    if (!id) return null;
    const poster = ivBest(video.videoThumbnails) || video.thumbnail || "";
    return {
      id: id,
      statusId: id,
      platform: "youtube",
      kind: "post",
      watch: true,
      author: (profile && profile.name) || video.author || "",
      handle: (profile && profile.displayHandle) || "",
      profileHandle: (profile && (profile.channelId || profile.handle)) || "",
      avatar: (profile && profile.avatar) || "",
      verifiedType: profile && profile.verifiedType,
      title: video.title || "",
      text: video.title || "",
      description: video.description || "",
      date: ivIso(video.published),
      url: "https://www.youtube.com/watch?v=" + id,
      media: [{ type: "video", url: "", poster: poster, duration: video.lengthSeconds }],
      stats: { views: video.viewCount }
    };
  }

  function ivCommunityPost(item, profile) {
    const id = item && item.commentId;
    if (!id) return null;
    return {
      id: id,
      statusId: id,
      platform: "youtube",
      kind: "community",
      author: (profile && profile.name) || item.author || "",
      handle: (profile && profile.displayHandle) || "",
      profileHandle: (profile && (profile.channelId || profile.handle)) || "",
      avatar: (profile && profile.avatar) || ivBest(item.authorThumbnails),
      verifiedType: profile && profile.verifiedType,
      text: item.content || "",
      date: ivIso(item.published),
      url: "https://www.youtube.com/channel/" + (profile && profile.channelId ? profile.channelId : ""),
      media: [],
      stats: { likes: item.likeCount, replies: item.replyCount }
    };
  }

  function ivVideoPosts(data, profile) {
    const list = (data && (data.videos || data.latestVideos)) || [];
    const out = [];
    list.forEach((video) => {
      const post = ivVideoPost(video, profile);
      if (post) out.push(post);
    });
    return out;
  }

  function limitedProfile(platform, handle) {
    const knownFeed = findFeed(platform, handle);
    const knownPost = rememberedPerson(platform, handle);
    const known = knownFeed || knownPost || {};
    return {
      id: knownFeed && knownFeed.id ? knownFeed.id : platform + ":" + handle,
      platform: platform,
      handle: handle,
      name: known.name || known.author || handle,
      avatar: known.avatar || "",
      banner: known.banner || "",
      bio: known.bio || "",
      location: known.location || "",
      website: "",
      joined: known.joined || "",
      following: known.following != null ? known.following : null,
      followers: known.followers != null ? known.followers : null,
      postsCount: null,
      verifiedType: known.verifiedType || "",
      url: externalProfile({ platform: platform, handle: handle, url: known.url || "" })
    };
  }

  function absorbSaved(row) {
    if ((row.posts || []).length) return;
    const feed = catalogFeed(row.profile);
    if (!feed) return;
    const saved = postsFor(feed).filter((post) => post.kind !== "reply");
    if (!saved.length) return;
    row.posts = saved;
    row.saved = true;
  }

  function loadXLive(row, handle) {
    return Promise.all([fxHeader(handle), nitterPosts(handle)]).then((pair) => {
      const header = pair[0];
      const nitter = pair[1];
      const postsJob = nitter && nitter.length
        ? Promise.resolve({ posts: nitter.filter((post) => post.kind !== "reply"), cursor: "", source: "nitter" })
        : fxPages(handle, "posts", "", 2).then((pack) => ({ posts: (pack && pack.posts) || [], cursor: (pack && pack.cursor) || "", source: "fxtwitter" }));
      const repliesJob = nitter && nitter.some((post) => post.kind === "reply")
        ? Promise.resolve({ posts: nitter.filter((post) => post.kind === "reply"), cursor: "" })
        : fxPages(handle, "replies", "", 1);
      const mediaJob = nitter && nitter.some((post) => (post.media || []).length)
        ? Promise.resolve({ posts: nitter.filter((post) => (post.media || []).length), cursor: "" })
        : fxPages(handle, "media", "", 1);
      return Promise.all([postsJob, repliesJob, mediaJob]).then((packs) => {
        const fromPosts = (packs[0] && packs[0].profile) || (packs[1] && packs[1].profile) || (packs[2] && packs[2].profile);
        row.profile = (header && header.handle ? header : null) || fromPosts || limitedProfile("x", handle);
        if (!header || !header.handle) row.error = fromPosts ? "" : "thin";
        if (header && header.error) row.errorDetail = header.error;
        row.limited = false;
        row.source = packs[0].source || "";
        row.posts = packs[0].posts || [];
        row.cursor.posts = packs[0].cursor || "";
        row.replies = (packs[1] && packs[1].posts) || [];
        row.cursor.replies = (packs[1] && packs[1].cursor) || "";
        row.media = (packs[2] && packs[2].posts) || [];
        row.cursor.media = (packs[2] && packs[2].cursor) || "";
        absorbSaved(row);
        row.posts.concat(row.replies, row.media).forEach(rememberLive);
        row.fetchedAt = Date.now();
      });
    });
  }

  function loadYtChannel(handle) {
    const id = String(handle || "").replace(/^@/, "");
    return rotate(ivBases(), "/api/v1/channels/" + encodeURIComponent(id), 4, "ivBase").then((data) => {
      if (data && data.authorId) return data;
      if (/^UC[\w-]{10,}$/.test(id)) return null;
      return rotate(ivBases(), "/api/v1/search?q=" + encodeURIComponent(id) + "&type=channel", 3, "ivBase").then((found) => {
        const list = (found && (found.results || found)) || [];
        const rows = Array.isArray(list) ? list : [];
        const hit = rows.find((item) => item && item.authorId && (String(item.author || "").toLowerCase() === id.toLowerCase() || String(item.authorUrl || "").toLowerCase().indexOf(id.toLowerCase()) >= 0));
        if (!hit) return null;
        return rotate(ivBases(), "/api/v1/channels/" + encodeURIComponent(hit.authorId), 4, "ivBase");
      });
    });
  }

  function loadYtLive(row, handle) {
    return loadYtChannel(handle).then((data) => {
      if (!data || !data.authorId) {
        row.profile = limitedProfile("youtube", handle);
        row.limited = true;
        row.error = "thin";
        row.fetchedAt = Date.now();
        return;
      }
      row.profile = ytProfileFromChannel(data, handle);
      row.videos = ivVideoPosts({ videos: data.latestVideos || [] }, row.profile);
      row.videos.forEach(rememberLive);
      const id = data.authorId;
      return Promise.all([
        rotate(ivBases(), "/api/v1/channels/" + encodeURIComponent(id) + "/videos", 4, "ivBase").catch(() => null),
        rotate(ivBases(), "/api/v1/channels/" + encodeURIComponent(id) + "/community", 4, "ivBase").catch(() => null)
      ]).then((pair) => {
        const page = pair[0];
        const extra = ivVideoPosts(page, row.profile);
        if (extra.length) {
          const seen = {};
          row.videos.forEach((post) => { seen[post.id] = true; });
          extra.forEach((post) => {
            if (seen[post.id]) return;
            seen[post.id] = true;
            row.videos.push(post);
            rememberLive(post);
          });
          row.cursor.videos = page.continuation || "";
        }
        const community = pair[1];
        row.community = ((community && community.comments) || []).map((item) => ivCommunityPost(item, row.profile)).filter((post) => post && post.text);
        row.cursor.community = (community && community.continuation) || "";
        row.community.forEach(rememberLive);
        row.fetchedAt = Date.now();
      });
    }).catch(() => {
      row.profile = limitedProfile("youtube", handle);
      row.limited = true;
      row.error = "thin";
      row.fetchedAt = Date.now();
    });
  }

  function loadLimited(row, platform, handle) {
    row.profile = limitedProfile(platform, handle);
    row.limited = true;
    row.fetchedAt = Date.now();
    return Promise.resolve();
  }

  function ensureLiveHeader(platform, handle) {
    const key = liveKey(platform, handle);
    const row = STATE.liveUsers[key] || (STATE.liveUsers[key] = blankLive(platform, handle));
    if (row.profile && row.fetchedAt && Date.now() - row.fetchedAt < COMMENT_TTL) return Promise.resolve(row);
    if (row.headerTask) return row.headerTask;
    const clean = String(handle || "").replace(/^@/, "");
    const job = platform === "youtube" ? loadYtChannel(clean).then((data) => (data && data.authorId ? ytProfileFromChannel(data, clean) : null))
      : (platform === "instagram" || platform === "threads") ? Promise.resolve(limitedProfile(platform, clean))
      : fxHeader(clean);
    row.headerTask = job.then((profile) => {
      if (profile) {
        row.profile = profile;
        if (!row.fetchedAt) row.fetchedAt = Date.now();
      }
      return row;
    }).catch(() => row).finally(() => { row.headerTask = null; });
    return row.headerTask;
  }

  function ensureLiveUser(platform, handle) {
    const key = liveKey(platform, handle);
    const row = STATE.liveUsers[key] || (STATE.liveUsers[key] = blankLive(platform, handle));
    if (row.pageTask) return row;
    if (row.settled && row.fetchedAt && Date.now() - row.fetchedAt < COMMENT_TTL) return row;
    row.loading = !row.profile;
    const clean = String(handle || "").replace(/^@/, "");
    const job = platform === "youtube" ? loadYtLive(row, clean)
      : (platform === "instagram" || platform === "threads") ? loadLimited(row, platform, clean)
      : loadXLive(row, clean);
    row.pageTask = job.then(() => {
      row.loading = false;
      row.settled = true;
      if (!row.fetchedAt) row.fetchedAt = Date.now();
      render();
      const hoverEl = document.querySelector("[data-card]:hover");
      if (hoverEl) showHover(hoverEl);
    }).catch(() => {
      row.loading = false;
      row.settled = true;
      row.fetchedAt = Date.now();
      render();
    }).finally(() => { row.pageTask = null; });
    return row;
  }

  function liveTabs(row) {
    if (!row || row.limited) return [];
    if ((row.platform || "") === "youtube") {
      const tabs = [];
      if ((row.videos || []).length || row.cursor.videos) tabs.push(["videos", "Videos"]);
      if ((row.community || []).length || row.cursor.community) tabs.push(["community", "Community"]);
      if (!tabs.length) tabs.push(["videos", "Videos"]);
      return tabs;
    }
    const tabs = [["posts", "Posts"]];
    if ((row.replies || []).length || row.cursor.replies) tabs.push(["replies", "Replies"]);
    if ((row.media || []).length || row.cursor.media) tabs.push(["media", "Media"]);
    return tabs;
  }

  function liveBucket(row, tab) {
    if (tab === "replies") return "replies";
    if (tab === "media") return "media";
    if (tab === "videos") return "videos";
    if (tab === "community") return "community";
    return "posts";
  }

  function loadMoreLive(route) {
    const row = STATE.liveUsers[liveKey(route.platform, route.handle)];
    if (!row || row.paging || row.saved) return;
    const tabs = liveTabs(row);
    const requested = route.query.get("tab") || "";
    const tab = tabs.some((pair) => pair[0] === requested) ? requested : (tabs[0] ? tabs[0][0] : "posts");
    const cursor = row.cursor[tab];
    if (!cursor) return;
    row.paging = tab;
    const finish = (pack) => {
      row.paging = "";
      const bucket = liveBucket(row, tab);
      const list = row[bucket] || (row[bucket] = []);
      if (pack && pack.posts && pack.posts.length) {
        const seen = {};
        list.forEach((post) => { seen[post.id] = true; });
        pack.posts.forEach((post) => {
          if (!post || seen[post.id]) return;
          seen[post.id] = true;
          list.push(post);
          rememberLive(post);
        });
      }
      row.cursor[tab] = pack && pack.cursor && pack.cursor !== cursor ? pack.cursor : "";
      render();
    };
    if (route.platform === "youtube" && tab === "videos") {
      const id = (row.profile && row.profile.channelId) || row.handle;
      rotate(ivBases(), "/api/v1/channels/" + encodeURIComponent(id) + "/videos?continuation=" + encodeURIComponent(cursor), 4, "ivBase").then((data) => {
        finish({ posts: ivVideoPosts(data, row.profile), cursor: (data && data.continuation) || "" });
      }).catch(() => finish(null));
      return;
    }
    if (route.platform === "youtube" && tab === "community") {
      const id = (row.profile && row.profile.channelId) || row.handle;
      rotate(ivBases(), "/api/v1/channels/" + encodeURIComponent(id) + "/community?continuation=" + encodeURIComponent(cursor), 4, "ivBase").then((data) => {
        const posts = ((data && data.comments) || []).map((item) => ivCommunityPost(item, row.profile)).filter((post) => post && post.text);
        finish({ posts: posts, cursor: (data && data.continuation) || "" });
      }).catch(() => finish(null));
      return;
    }
    fxPages(row.handle, tab === "posts" ? "posts" : tab, cursor, 1).then(finish);
  }

  function openLabel(platform) {
    if (platform === "instagram") return "Open on Instagram";
    if (platform === "threads") return "Open on Threads";
    if (platform === "youtube") return "View on YouTube";
    if (platform === "x") return "View on X";
    return "View on " + (PLATFORM[platform] || "web");
  }

  function userView(route) {
    const row = ensureLiveUser(route.platform, route.handle);
    const profile = row.profile || {
      id: route.platform + ":" + route.handle,
      platform: route.platform,
      handle: route.handle,
      name: route.handle,
      limited: route.platform === "instagram" || route.platform === "threads"
    };
    const tabs = liveTabs(row);
    const requested = route.query.get("tab") || "";
    const tab = tabs.some((pair) => pair[0] === requested) ? requested : (tabs[0] ? tabs[0][0] : "");
    const bucket = tab ? liveBucket(row, tab) : "";
    const list = bucket ? (row[bucket] || []) : [];
    const shown = profile.displayHandle || (profile.platform === "youtube" ? "" : profile.handle);
    const banner = profile.banner ? `<img class="pbanner" src="${esc(profile.banner)}" alt="" referrerpolicy="no-referrer">` : `<div class="pbanner"></div>`;
    const meta = [
      profile.location ? `<span>${icon("loc")}${esc(profile.location)}</span>` : "",
      profile.website ? `<a data-act="stop" href="${esc(profile.website)}" target="_blank" rel="noopener noreferrer">${icon("link")}${esc(String(profile.website).replace(/^https?:\/\//, ""))}</a>` : "",
      profile.joined ? `<span>${icon("cal")}${esc(joinedLabel(profile.joined))}</span>` : ""
    ].join("");
    const followerWord = profile.platform === "youtube" ? "Subscribers" : "Followers";
    const counts = (profile.following != null || profile.followers != null) ? `<div class="counts">
      ${profile.following != null ? `<div><b>${esc(formatCount(profile.following))}</b> <span>Following</span></div>` : ""}
      ${profile.followers != null ? `<div><b>${esc(formatCount(profile.followers))}</b> <span>${followerWord}</span></div>` : ""}
    </div>` : "";
    const count = profile.postsCount != null ? formatCount(profile.postsCount) + " posts" : "";
    const tabHtml = tabs.map((pair) => {
      const href = userHash(profile.platform, profile.channelId || profile.handle) + (pair[0] === tabs[0][0] ? "" : "?tab=" + pair[0]);
      return `<a class="tab${tab === pair[0] ? " on" : ""}" href="${esc(href)}"><span>${pair[1]}</span></a>`;
    }).join("");
    const note = needsSyncNote(profile) ? `<p class="pfollow-note">Follow saves this account on this device. Add it to feeds.config.json and sync before its posts join the home timeline.</p>` : "";
    const limited = row.limited ? `<p class="pfollow-note">Posts from this account can’t be loaded in the browser.</p>` : "";
    const saved = row.saved ? `<p class="pfollow-note">Showing saved posts. The live timeline didn’t load.</p>` : "";
    const fresh = row.fetchedAt ? `<p class="source-checked">${esc(freshLabel(row.fetchedAt))}</p>` : "";
    let body = "";
    if (!tabs.length) body = "";
    else if (row.loading && !list.length) body = `<div class="reply-empty">Loading…</div>`;
    else if (list.length) body = list.map((post) => card(post, post.repostedBy ? "" : "author")).join("");
    else body = emptyBlock(
      tab === "replies" ? "No replies yet" : tab === "media" ? "No media yet" : tab === "community" ? "No community posts yet" : tab === "videos" ? "No videos yet" : "No posts yet",
      row.error === "thin" && !row.saved ? "The live timeline didn’t load from the public sources." : "Nothing from this account is available in this tab."
    );
    const more = tab && row.cursor[tab] && !row.saved ? `<div id="live-more" class="live-more">${row.paging === tab ? "Loading…" : ""}</div>` : "";
    return `<div class="topbar profile-bar">
      <div class="page-head">
        <button class="icon-btn" data-act="back" aria-label="Back">${icon("back")}</button>
        <div class="head-text"><div class="pt-name">${esc(profile.name || profile.handle)}</div>${count ? `<div class="pt-count">${esc(count)}</div>` : ""}</div>
      </div>
    </div>
    ${banner}
    <div class="pinfo" data-live-error="${esc(row.errorDetail || row.error || "")}">
      <div class="pava-row">
        ${avatar(profile.avatar, profile.name, "pava")}
        <div class="pactions">
          <button class="icon-btn" type="button" data-act="share" data-kind="profile" data-id="${esc(profile.id || (profile.platform + ":" + profile.handle))}" aria-label="Share">${icon("share")}</button>
          ${followButtonClean(liveFollowId(profile), true)}
          <a class="outline" data-act="stop" target="_blank" rel="noopener noreferrer" href="${esc(externalProfile(profile))}">${esc(openLabel(profile.platform))}</a>
        </div>
      </div>
      <h2 class="pname">${esc(profile.name || profile.handle)}${badge(profile.verifiedType)}</h2>
      ${shown ? `<div class="phandle">@${esc(shown)}</div>` : ""}
      ${profile.bio ? `<div class="bio">${linkify(profile.bio, [], profile.platform)}</div>` : ""}
      ${meta ? `<div class="pmeta">${meta}</div>` : ""}
      ${counts}
      ${fresh}
      ${limited}
      ${saved}
      ${note}
    </div>
    ${tabs.length ? `<div class="tabs ptabs" role="tablist">${tabHtml}</div>` : ""}
    ${body}${more}`;
  }

  function profileView(route) {
    const feed = findFeed(route.platform, route.handle) || {
      id: route.platform + ":" + route.handle,
      platform: route.platform,
      handle: route.handle,
      name: route.handle,
      configured: false
    };
    if (feed.platform === "youtube") ensureYtSubs(feed);
    const youtube = feed.platform === "youtube";
    const tab = route.query.get("tab") || "posts";
    let list = postsFor(feed);
    if (youtube && tab === "videos") list = list.filter(isVideoPost);
    else if (youtube && tab === "community") list = list.filter((p) => p.kind === "community");
    else if (tab === "replies") list = list.filter((p) => p.kind === "reply");
    else if (tab === "media") list = list.filter((p) => (p.media || []).length);
    else list = list.filter((p) => p.kind !== "reply");
    const count = feed.postsCount != null ? formatCount(feed.postsCount) : formatCount(postsFor(feed).length);
    const banner = feed.banner ? `<img class="pbanner" src="${esc(feed.banner)}" alt="">` : `<div class="pbanner"></div>`;
    const meta = [
      feed.location ? `<span>${icon("loc")}${esc(feed.location)}</span>` : "",
      feed.website ? `<a href="${esc(feed.website)}" target="_blank" rel="noopener noreferrer">${icon("link")}${esc(String(feed.website).replace(/^https?:\/\//, ""))}</a>` : "",
      feed.joined ? `<span>${icon("cal")}${esc(joinedLabel(feed.joined))}</span>` : ""
    ].join("");
    const counts = (feed.following != null || feed.followers != null) ? `<div class="counts">
      ${feed.following != null ? `<div><b>${esc(formatCount(feed.following))}</b> <span>Following</span></div>` : ""}
      ${feed.followers != null ? `<div><b>${esc(formatCount(feed.followers))}</b> <span>Followers</span></div>` : ""}
    </div>` : "";
    const tabIds = youtube ? [["posts", "Posts"], ["videos", "Videos"], ["community", "Community"]] : [["posts", "Posts"], ["replies", "Replies"], ["media", "Media"]];
    const tabs = tabIds.map((pair) => {
      const id = pair[0];
      const href = profileHash(feed.platform, feed.handle) + (id === "posts" ? "" : "?tab=" + id);
      return `<a class="tab${tab === id ? " on" : ""}" href="${esc(href)}"><span>${pair[1]}</span></a>`;
    }).join("");
    return `<div class="topbar profile-bar">
      <div class="page-head">
        <button class="icon-btn" data-act="back" aria-label="Back">${icon("back")}</button>
        <div class="head-text"><div class="pt-name">${esc(feed.name || feed.handle)}</div><div class="pt-count">${esc(count)} posts</div></div>
      </div>
    </div>
    ${banner}
    <div class="pinfo">
      <div class="pava-row">
        ${avatar(feed.avatar, feed.name, "pava")}
        <div class="pactions">
          <button class="icon-btn" type="button" data-act="share" data-kind="profile" data-id="${esc(feed.id)}" aria-label="Share">${icon("share")}</button>
          ${followButtonClean(feed.id, true)}
          <a class="outline" target="_blank" rel="noopener noreferrer" href="${esc(externalProfile(feed))}">View on ${esc(PLATFORM[feed.platform] || "web")}</a>
        </div>
      </div>
      <h2 class="pname">${esc(feed.name || feed.handle)}${badge(feed.verifiedType)}</h2>
      <div class="phandle">@${esc(feed.handle)}</div>
      ${feed.bio ? `<div class="bio">${linkify(feed.bio, [], feed.platform)}</div>` : ""}
      ${meta ? `<div class="pmeta">${meta}</div>` : ""}
      ${counts}
    </div>
    <div class="tabs ptabs" role="tablist">${tabs}</div>
    ${list.length ? list.map((p) => {
      const byThis = p.repostedBy && (p.repostedBy.handle || "").toLowerCase() === (feed.handle || "").toLowerCase();
      return card(p, byThis ? "" : "author");
    }).join("") : emptyBlock(
      tab === "replies" ? "No replies yet" : tab === "media" ? "No media yet" : tab === "videos" ? "No videos yet" : tab === "community" ? "No community posts yet" : "No posts yet",
      tab === "replies" ? "Replies by this account will show up here." : tab === "community" ? "Community posts from this channel will show up here." : "Posts from this account will show up here."
    )}` + archiveSentinel();
  }

  function statusView(route) {
    let post = findPost(route.platform, route.handle, route.id);
    if (!post && (route.platform === "instagram" || route.platform === "threads" || route.platform === "youtube")) {
      post = expandStub({ p: route.platform, id: route.id, h: route.handle });
      if (post) STATE.shared[String(route.id)] = post;
    }
    if (post && post.tombstone) {
      return `<div class="topbar"><div class="page-head"><button class="icon-btn" data-act="back" aria-label="Back">${icon("back")}</button><h1 class="grow">Post</h1></div></div>` + tombstoneCard(post);
    }
    if (!post) {
      const key = String(route.id);
      if (STATE.sharedState[key] !== "miss") {
        if (STATE.sharedState[key] !== "loading") {
          STATE.sharedState[key] = "loading";
          loadSharedStatus(route);
        }
        return pageHead("Post", "", true) + `<div class="reply-empty">Loading…</div>`;
      }
      return pageHead("Post", "", true) + emptyBlock("Post unavailable", "This post isn’t in the current snapshot.");
    }
    STATE.focusId = postKey(post);
    const stats = post.stats || {};
    const chain = ancestorChain(post);
    const slice = replySlice(post);
    const threaded = !slice.loading && slice.shown.length > 0 && sameThread(post, slice.shown[0]);
    const replyLine = post.replyingTo && post.replyingTo.handle ? `<div class="replying" style="margin-top:12px">Replying to <a data-card="${esc((post.platform || "x") + ":" + post.replyingTo.handle)}" href="${esc(userHash(post.platform, post.replyingTo.handle))}">@${esc(post.replyingTo.handle)}</a></div>` : "";
    const body = `${replyLine}
        <div class="status-text">${textHtml(post, post.id, true)}</div>
        ${pollHtml(post)}
        ${mediaHtml(post.media)}
        ${quoteCard(post.quoted)}
        <div class="status-time">${esc(fullTime(post.date))}${post.url ? ` · <a target="_blank" rel="noopener noreferrer" href="${esc(post.url)}">View on ${esc(PLATFORM[post.platform] || "web")}</a>` : ""}</div>
        ${stats.views != null ? `<div class="status-views"><b>${esc(formatCount(stats.views))}</b> Views</div>` : `<div class="status-views"></div>`}
        ${actionBar(post)}`;
    const face = authorFace(post);
    const names = `<div>
            <a class="name" data-card="${esc((post.platform || "x") + ":" + (post.handle || ""))}" href="${esc(userHash(post.platform, post.handle))}">${esc(post.author || "")}${badge(face.verified)}</a>
            <a class="handle" data-card="${esc((post.platform || "x") + ":" + (post.handle || ""))}" href="${esc(userHash(post.platform, post.handle))}">@${esc(post.handle || "")}</a>
          </div>
          <span style="margin-left:auto">${sourceBadge(post.platform)}</span>`;
    const parented = chain.nodes.length > 0 ? " has-parent" : "";
    const article = threaded
      ? `<article class="status has-thread${parented}"><div class="status-thread"><div class="ava-col"><a data-card="${esc((post.platform || "x") + ":" + (post.handle || ""))}" href="${esc(userHash(post.platform, post.handle))}">${avatar(face.avatar, post.author)}</a><div class="thread-line"></div></div><div class="status-main"><div class="status-author">${names}</div>${body}</div></div></article>`
      : `<article class="status${parented}"><div class="status-author"><a data-card="${esc((post.platform || "x") + ":" + (post.handle || ""))}" href="${esc(userHash(post.platform, post.handle))}">${avatar(face.avatar, post.author)}</a>${names}</div>${body}</article>`;
    return `<div class="topbar"><div class="page-head"><button class="icon-btn" data-act="back" aria-label="Back">${icon("back")}</button><h1 class="grow">Post</h1></div></div>
      ${ancestorBlock(post, chain)}
      ${article}
      ${composer(threaded)}
      ${replyList(post)}`;
  }

  function exploreView(route) {
    const q = (route.query.get("q") || "").trim();
    const lq = q.toLowerCase();
    let body = emptyBlock("Search posts and accounts", "Try a name, @handle, or a word from a post.");
    if (lq) {
      const accounts = feeds().filter((f) => (f.name + " " + f.handle + " " + (f.bio || "")).toLowerCase().includes(lq));
      const found = posts().filter((p) => (p.text + " " + p.author + " " + p.handle + " " + ((p.quoted && p.quoted.text) || "")).toLowerCase().includes(lq)).sort(byStamp);
      const acct = accounts.length ? `<section class="card"><h2>Accounts</h2>${accounts.map(accountRow).join("")}</section>` : "";
      body = acct + (found.length ? found.map((p) => card(p)).join("") : emptyBlock("No results", "Nothing matched “" + q + "”."));
    }
    return `<div class="topbar explore-bar"><div class="page-head"><h1>Explore</h1></div>
      <form data-act="search-form" class="explore-form"><label class="search"><span>${icon("search")}</span><input id="explore-q" value="${esc(q)}" placeholder="Search" aria-label="Search"></label></form></div>${body}`;
  }

  function accountRow(f) {
    return `<div class="acct-row"><a class="who-main" href="${esc(userHash(f.platform, f.channelId || f.handle))}" data-card="${esc(f.id)}">${avatar(f.avatar, f.name)}<span class="who-copy"><span class="name">${esc(f.name)}${badge(f.verifiedType)}</span><span class="handle">@${esc(f.handle)}</span></span></a>${followButtonClean(f.id)}</div>`;
  }

  function feedsView() {
    const list = feeds().slice().sort((a, b) => Number(b.configured) - Number(a.configured) || (a.name || "").localeCompare(b.name || ""));
    return pageHead("Feeds") + (list.length ? `<div>${list.map(accountRow).join("")}</div>` : emptyBlock("No accounts", "Add sources in feeds.config.json."));
  }

  function listsView() {
    const pinned = STATE.settings.lists.filter((l) => l.pinned);
    const yours = STATE.settings.lists.filter((l) => !l.pinned);
    const row = (l) => `<div class="list-row"><a class="list-main" href="#/lists/${esc(l.id)}"><span class="color-chip" style="background:${esc(l.bannerColor || COLORS[0])}"></span><span class="list-copy"><span class="name">${esc(l.name)}</span><span class="meta">${(l.members || []).length} members</span></span></a><button class="icon-btn pin${l.pinned ? " on" : ""}" data-act="pin" data-id="${esc(l.id)}" aria-label="${l.pinned ? "Unpin" : "Pin"} list">${icon("pin")}</button></div>`;
    const section = (title, items) => items.length ? `<section class="list-section"><h2>${title}</h2>${items.map(row).join("")}</section>` : "";
    const create = `<button class="icon-btn" data-act="new-list" aria-label="Create list">${icon("plus")}</button>`;
    return pageHead("Lists", "", false, create) +
      (STATE.settings.lists.length ? section("Pinned Lists", pinned) + (yours.length ? section("Your Lists", yours) : "") : emptyBlock("Save posts into Lists", "Create a List to group the accounts you follow.")) +
      (!STATE.settings.lists.length ? `<div class="empty-action"><button class="save" data-act="new-list">Create a List</button></div>` : "");
  }

  function listView(route) {
    const list = STATE.settings.lists.find((l) => l.id === route.id);
    if (!list) return pageHead("List", "", true) + emptyBlock("List not found", "It may have been deleted.");
    const items = listMembersPosts(list).filter(inTimeline);
    return `<div class="topbar"><div class="page-head">
        <button class="icon-btn" data-act="back" aria-label="Back">${icon("back")}</button>
        <div class="head-text grow"><div class="pt-name">${esc(list.name)}</div><div class="pt-count">${(list.members || []).length} members</div></div>
        <button class="icon-btn pin${list.pinned ? " on" : ""}" data-act="pin" data-id="${esc(list.id)}" aria-label="Pin list">${icon("pin")}</button>
      </div></div>
      <div class="list-banner" style="background:${esc(list.bannerColor || COLORS[0])}"></div>
      <div class="list-body">
        <div class="list-tools"><div><h2>${esc(list.name)}</h2>${list.description ? `<div class="bio">${esc(list.description)}</div>` : ""}<div class="phandle">${(list.members || []).length} Members</div></div>
        <button class="outline" data-act="edit-list" data-id="${esc(list.id)}">Edit List</button></div>
        <button class="show-more" data-act="members" data-id="${esc(list.id)}">Manage members</button>
      </div>
      ${items.length ? items.map((p) => card(p)).join("") : emptyBlock("No posts in this List", "Add members to see their posts here.")}` + archiveSentinel();
  }

  function bookmarkedPosts() {
    const ids = STATE.settings.bookmarks || {};
    const saved = STATE.settings.savedPosts || {};
    const fromFeed = posts().filter((p) => ids[p.id]);
    const seen = {};
    fromFeed.forEach((p) => { seen[p.id] = true; });
    const extra = Object.keys(ids).filter((id) => ids[id] && !seen[id] && saved[id]).map((id) => saved[id]);
    return fromFeed.concat(extra).sort(byStamp);
  }

  function bookmarksView() {
    const list = bookmarkedPosts();
    return pageHead("Bookmarks", `<div class="subhead">@reader</div>`) + (list.length ? list.map((p) => card(p)).join("") : emptyBlock("Save posts for later", "Bookmark posts to easily find them again in the future."));
  }

  function notesView(title, headline, body) {
    return pageHead(title) + emptyBlock(headline, body);
  }

  function isStandalone() {
    return matchMedia("(display-mode: standalone)").matches || matchMedia("(display-mode: window-controls-overlay)").matches || navigator.standalone === true;
  }

  function installControl() {
    if (isStandalone()) return "";
    return `<button class="primary" type="button" data-act="install">Install app</button>`;
  }

  function settingsView() {
    const appearance = (STATE.settings && STATE.settings.appearance) || "lightsout";
    const themeBtn = (id, label) => `<button class="outline${appearance === id ? " on" : ""}" type="button" data-act="theme" data-theme="${id}">${label}</button>`;
    const notifyOn = !!(STATE.settings && STATE.settings.notify && typeof Notification !== "undefined" && Notification.permission === "granted");
    return pageHead("Settings", "", true) + `<div class="modal-body">
      <p class="phandle">Follows, Lists, likes, and bookmarks stay in this browser.</p>
      <h2>Appearance</h2>
      <div class="theme-row">
        ${themeBtn("auto", "Auto")}
        ${themeBtn("default", "Default")}
        ${themeBtn("dim", "Dim")}
        ${themeBtn("lightsout", "Lights out")}
      </div>
      ${installControl()}
      <button class="primary" type="button" data-act="notify">${notifyOn ? "Notifications on" : "Notify me about new posts"}</button>
      <button class="primary" data-act="export">Export settings</button>
      <label class="primary import-btn">Import settings<input id="import-file" data-act="import" type="file" accept="application/json" hidden></label>
    </div>`;
  }

  function drawer() {
    if (!STATE.drawer) return "";
    return `<div class="drawer-back" data-act="close-drawer"><div class="drawer" data-act="stop">
      <div style="padding:16px 20px;display:flex;gap:12px;align-items:center"><span class="ava initials">Y</span><div><b>You</b><div class="phandle">@reader</div></div></div>
      <a href="#/lists">${icon("lists")} Lists</a>
      <a href="#/bookmarks">${icon("bookmark")} Bookmarks</a>
      <a href="#/subscriptions">${icon("subs")} Subscriptions</a>
      <a href="#/feeds">${icon("spark")} Feeds</a>
      <a href="#/settings">${icon("more")} Settings</a>
      ${isStandalone() ? "" : `<button class="linky" type="button" data-act="install">${icon("plus")} Install app</button>`}
    </div></div>`;
  }

  function modal() {
    if (STATE.confirm) {
      return `<div class="modal-back"><div class="modal" role="dialog" style="max-width:320px;margin-top:20vh;padding:8px 0 16px">
        <div class="modal-body"><h2>Delete this List?</h2><p class="phandle">This can’t be undone.</p>
        <button class="primary" data-act="confirm-delete" style="background:#f4212e">Delete</button>
        <button class="outline" data-act="close-modal" style="margin-left:8px">Cancel</button></div></div></div>`;
    }
    if (!STATE.modal) return "";
    if (STATE.modal === "install") {
      const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
      const steps = ios
        ? `<div class="install-step"><span>1</span> Tap Share in Safari</div><div class="install-step"><span>2</span> Choose Add to Home Screen</div><div class="install-step"><span>3</span> Tap Add</div>`
        : `<p>Use the install icon in the address bar, or open the browser menu and choose Install app.</p>`;
      return `<div class="modal-back" data-act="close-modal"><div class="modal" role="dialog" data-act="stop">
        <div class="modal-head"><button class="icon-btn" data-act="close-modal" aria-label="Close">${icon("close")}</button><h2>Install app</h2></div>
        <div class="modal-body install-sheet">${steps}</div>
      </div></div>`;
    }
    if (STATE.modal === "compose") {
      return `<div class="modal-back" data-act="close-modal"><div class="modal" role="dialog" data-act="stop">
        <div class="modal-head"><button class="icon-btn" data-act="close-modal" aria-label="Close">${icon("close")}</button><div class="grow"></div></div>
        <div class="modal-body" style="display:flex;gap:12px">
          <span class="ava initials">Y</span>
          <div style="flex:1"><textarea id="compose-text" placeholder="What is happening?!" style="width:100%;min-height:120px;background:transparent;border:0;resize:vertical;font-size:20px;outline:none"></textarea>
          <div style="display:flex;justify-content:flex-end"><button id="compose-post" class="save" data-act="compose-post" disabled>Post</button></div>
          <p class="phandle">This reader doesn’t publish. Posts come from your feeds.</p></div>
        </div></div></div>`;
    }
    if (STATE.modal === "list") {
      const d = STATE.draft;
      return `<div class="modal-back"><div class="modal" role="dialog">
        <div class="modal-head"><button class="icon-btn" data-act="close-modal" aria-label="Close">${icon("close")}</button><h2>${d.id ? "Edit List" : "Create a new List"}</h2><button class="save" data-act="save-list" ${d.name && d.name.trim() ? "" : "disabled"}>Save</button></div>
        <div class="modal-body">
          <label class="field"><span>Name</span><input id="list-name" data-field="name" maxlength="50" value="${esc(d.name || "")}"></label>
          <label class="field"><span>Description</span><textarea id="list-desc" data-field="description" maxlength="160">${esc(d.description || "")}</textarea></label>
          <div class="field"><span>Banner</span><div class="swatches">${COLORS.map((c) => `<button class="swatch${d.bannerColor === c ? " on" : ""}" style="background:${c}" data-act="color" data-color="${c}" aria-label="Banner color"></button>`).join("")}</div></div>
          ${d.id ? `<button class="danger" data-act="ask-delete">Delete List</button>` : ""}
        </div></div></div>`;
    }
    if (STATE.modal === "members") {
      const list = STATE.settings.lists.find((l) => l.id === STATE.draft.id);
      if (!list) return "";
      const q = (STATE.draft.q || "").toLowerCase();
      const rows = feeds().filter((f) => !q || (f.name + " " + f.handle).toLowerCase().includes(q)).map((f) => {
        const on = (list.members || []).includes(f.id);
        return `<div class="acct-row">${avatar(f.avatar, f.name)}<span class="who-copy"><span class="name">${esc(f.name)}</span><span class="handle">@${esc(f.handle)}</span></span><button class="follow${on ? " following" : ""}" data-act="${on ? "member-remove" : "member-add"}" data-id="${esc(f.id)}">${on ? "<span class='f'>Member</span><span class='u'>Remove</span>" : "Add"}</button></div>`;
      }).join("");
      return `<div class="modal-back"><div class="modal" role="dialog">
        <div class="modal-head"><button class="icon-btn" data-act="close-modal" aria-label="Close">${icon("close")}</button><h2>Manage members</h2></div>
        <div class="modal-body"><input id="member-q" class="member-search" data-field="q" placeholder="Search accounts" value="${esc(STATE.draft.q || "")}">${rows || emptyBlock("No accounts", "Accounts appear here after feeds.json loads.")}</div>
      </div></div>`;
    }
    return "";
  }

  function shell(main, route) {
    const wide = route.name === "subscriptions" || route.name === "watch";
    const tall = route.name === "home" || wide || ["feeds", "lists", "bookmarks", "settings", "notifications", "messages"].includes(route.name);
    const top = route.name === "explore" ? 124 : tall ? 106 : 53;
    return `<div class="app${wide ? " wide" : ""}">${nav(route)}<main class="center" style="--top:${top}px">${main}</main>${wide ? "" : sidebar()}</div>${bottom(route)}${drawer()}${shareSheet()}${modal()}`;
  }

  function watchHash(post) {
    return "#/watch/" + (post.platform || "x") + ":" + (post.statusId || post.id);
  }

  function isVideoPost(post) {
    if (!post || post.kind === "reply" || post.kind === "community") return false;
    if (post.platform === "youtube") return true;
    return (post.media || []).some((item) => item && (item.type === "video" || item.type === "animated_gif"));
  }

  function followedPost(post) {
    const ids = STATE.settings.follows;
    return ids.includes(post.feedId) || ids.includes((post.platform || "x") + ":" + post.handle);
  }

  function feedOf(post) {
    return feedById(post.feedId) || findFeed(post.platform, post.handle) || {
      id: (post.platform || "x") + ":" + (post.handle || ""),
      platform: post.platform,
      handle: post.handle,
      name: post.author || post.handle,
      avatar: post.avatar
    };
  }

  function authorFace(post) {
    const feed = feedOf(post);
    return {
      avatar: post.avatar || feed.avatar || "",
      verified: post.verifiedType || feed.verifiedType || ""
    };
  }

  function clock(seconds) {
    seconds = Math.floor(Number(seconds));
    if (!isFinite(seconds) || seconds < 0) return "";
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    const pad = (n) => (n < 10 ? "0" + n : String(n));
    return h ? h + ":" + pad(m) + ":" + pad(s) : m + ":" + pad(s);
  }

  function videoMeta(post) {
    const views = post.stats && post.stats.views != null ? formatCount(post.stats.views) + " views" : "";
    const when = relTime(post.date);
    return [views, when].filter(Boolean).join(" • ");
  }

  function dayBucket(iso) {
    const date = new Date(iso || "");
    if (isNaN(date.getTime())) return "Older";
    const now = new Date();
    const start = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
    const diff = Math.round((start(now) - start(date)) / 86400000);
    if (diff <= 0) return "Today";
    if (diff === 1) return "Yesterday";
    if (diff < 7) return "This week";
    if (date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear()) return "This month";
    return "Older";
  }

  function platMark(platform) {
    return `<span class="plat">${esc(PLATFORM[platform] || platform || "")}</span>`;
  }

  function ytCard(post, layout) {
    ensureYtMeta(post);
    const feed = feedOf(post);
    const media = (post.media || [])[0] || {};
    const duration = clock(media.duration);
    const title = post.title || post.text || "";
    return `<a class="yt-card${layout === "list" ? " row" : ""}" href="${esc(watchHash(post))}">
      <div class="yt-thumb">${media.poster || (media.type === "photo" ? media.url : "") ? `<img src="${esc(media.poster || media.url)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}<span class="plat">${esc(PLATFORM[post.platform] || "")}</span>${duration ? `<span class="yt-time">${esc(duration)}</span>` : ""}</div>
      <div class="yt-meta">
        ${avatar(post.avatar || feed.avatar, feed.name || post.author, "yt-ava")}
        <div class="yt-copy">
          <h3 class="yt-title">${esc(title)}</h3>
          <div class="yt-by">${esc(feed.name || post.author || post.handle || "")}${badge(feed.verifiedType || post.verifiedType)}</div>
          <div class="yt-sub">${esc(videoMeta(post))}</div>
        </div>
      </div>
    </a>`;
  }

  function subsView(route) {
    const layout = STATE.subsLayout === "list" ? "list" : "grid";
    const toggles = `<div class="yt-toggle"><button class="${layout === "grid" ? "on" : ""}" data-act="subs-layout" data-layout="grid" aria-label="Grid">${icon("grid")}</button><button class="${layout === "list" ? "on" : ""}" data-act="subs-layout" data-layout="list" aria-label="List">${icon("rows")}</button></div>`;
    const head = pageHead("Subscriptions", "", false, toggles);
    const channels = feeds().filter((feed) => STATE.settings.follows.includes(feed.id) && (feed.platform === "youtube" || posts().some((post) => isVideoPost(post) && (post.feedId === feed.id || (post.platform + ":" + post.handle) === feed.id))));
    const strip = `<div class="yt-strip"><a class="yt-ch${route.channel ? "" : " on"}" href="#/subscriptions"><span class="yt-all">All</span><span>All</span></a>${channels.map((feed) => `<a class="yt-ch${route.channel === feed.id ? " on" : ""}" href="#/subscriptions?c=${encodeURIComponent(feed.id)}">${avatar(feed.avatar, feed.name, "ch")}<span>${esc(feed.name || feed.handle)}</span></a>`).join("")}</div>`;
    let list = posts().filter((post) => isVideoPost(post) && followedPost(post)).sort(byStamp);
    if (route.channel) list = list.filter((post) => post.feedId === route.channel || (post.platform + ":" + post.handle) === route.channel);
    channels.forEach(ensureYtSubs);
    list.forEach(ensureYtMeta);
    if (!STATE.settings.follows.length) return head + strip + emptyBlock("No videos yet", "Follow accounts to see their videos here.");
    if (!list.length) return head + strip + emptyBlock("No videos yet", "Videos from accounts you follow will show up here.");
    const shorts = list.filter((post) => post.short);
    const rest = list.filter((post) => !post.short);
    const shelf = shorts.length ? `<section class="yt-sec shorts-sec"><h2>Shorts</h2><div class="shorts">${shorts.map((post) => {
      const media = (post.media || [])[0] || {};
      return `<a class="short-card" href="${esc(watchHash(post))}"><div class="yt-thumb">${media.poster ? `<img src="${esc(media.poster)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}${platMark(post.platform)}</div><h3 class="yt-title">${esc(post.title || post.text || "")}</h3></a>`;
    }).join("")}</div></section>` : "";
    const order = ["Today", "Yesterday", "This week", "This month", "Older"];
    const groups = {};
    rest.forEach((post) => {
      const name = dayBucket(post.date);
      (groups[name] || (groups[name] = [])).push(post);
    });
    const sections = order.filter((name) => groups[name] && groups[name].length).map((name) => `<section class="yt-sec"><h2>${name}</h2><div class="yt-grid">${groups[name].map((post) => ytCard(post, layout)).join("")}</div></section>`).join("");
    return `<div class="subs ${layout}">${head}${strip}${shelf}${sections}</div>`;
  }

  function watchComments(post) {
    const id = postKey(post);
    const file = post.platform === "youtube" ? "yt_" + id : id;
    const key = "watch:" + file;
    if (STATE.forceWatch === id) delete STATE.replies[key];
    if (STATE.replies[key]) return STATE.replies[key];
    STATE.replies[key] = { loading: true, doc: null, missing: false };
    const stamp = (doc) => {
      const parsed = doc && doc.fetchedAt ? Date.parse(doc.fetchedAt) : Date.now();
      return isFinite(parsed) ? parsed : Date.now();
    };
    const snap = () => snapshotDoc(file).then((doc) => {
      STATE.replies[key] = { loading: false, doc: doc, missing: false, fetchedAt: stamp(doc) };
      render();
    }).catch(() => {
      STATE.replies[key] = { loading: false, doc: null, missing: true, fetchedAt: Date.now() };
      render();
    });
    if (post.platform === "youtube") {
      loadYtComments(post).then((doc) => {
        if (!doc) {
          snap();
          return;
        }
        STATE.replies[key] = { loading: false, doc: doc, missing: false, fetchedAt: stamp(doc) };
        render();
      });
      return STATE.replies[key];
    }
    snap();
    return STATE.replies[key];
  }

  function ytComment(comment) {
    const count = comment.stats && comment.stats.replies != null ? Number(comment.stats.replies) : (comment.replies || []).length;
    const likes = comment.stats && comment.stats.likes ? formatCount(comment.stats.likes) : "";
    const when = comment.date ? relTime(comment.date) : (comment.timeLabel || "");
    const open = !!STATE.threadsOpen[comment.id];
    const kids = comment.replies || [];
    const toggle = count > 0 ? `<button class="yt-replies" type="button" data-act="yt-replies" data-id="${esc(comment.id)}">${open ? "Hide replies" : esc(formatCount(count) || String(count)) + " replies"}</button>` : "";
    const nested = open ? `<div class="yt-kids">${kids.length ? kids.map(ytComment).join("") : `<div class="reply-empty">Replies aren’t available.</div>`}</div>` : "";
    const href = comment.channelId ? userHash("youtube", comment.channelId) : "";
    const cardId = comment.channelId ? ` data-card="youtube:${esc(comment.channelId)}"` : "";
    const face = href ? `<a href="${esc(href)}"${cardId}>${avatar(comment.avatar, comment.author || comment.handle)}</a>` : avatar(comment.avatar, comment.author || comment.handle);
    const name = href ? `<a class="name" href="${esc(href)}"${cardId}>${esc(comment.author || comment.handle || "")}</a>` : esc(comment.author || comment.handle || "");
    return `<div class="yt-c">
      ${face}
      <div class="yt-c-main">
        <div class="yt-c-name">${name}${badge(comment.verifiedType)} <span>${esc(when)}</span></div>
        <p>${esc(comment.text || "")}</p>
        ${likes ? `<div class="yt-c-likes">${icon("thumb")}<span>${esc(likes)}</span></div>` : ""}
        ${toggle}
        ${nested}
      </div>
    </div>`;
  }

  function watchView(route) {
    const post = posts().find((item) => item.platform === route.platform && String(item.statusId || item.id) === String(route.id)) || STATE.shared[String(route.id)];
    if (!post) return pageHead("Watch", "", true) + emptyBlock("Video unavailable", "This video isn’t in the current snapshot.");
    const feed = feedOf(post);
    ensureYtMeta(post);
    ensureYtSubs(feed);
    const media = (post.media || []).find((item) => item && (item.type === "video" || item.type === "animated_gif")) || (post.media || [])[0] || {};
    const id = postKey(post);
    const alt = !!STATE.playerAlt[id];
    const embed = post.platform === "youtube" && !alt;
    let player;
    if (embed) {
      player = `<iframe src="https://www.youtube-nocookie.com/embed/${encodeURIComponent(post.statusId || post.id)}?rel=0" title="${esc(post.title || post.text || "Video")}" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`;
    } else if (post.platform === "youtube" && media.stream) {
      player = `<video src="${esc(media.stream)}" poster="${esc(media.poster || "")}" controls playsinline></video>`;
    } else if (media.url && !/youtube-nocookie\.com|\/embed\//.test(media.url)) {
      player = `<video src="${esc(media.url)}" poster="${esc(media.poster || "")}" controls playsinline></video>`;
    } else if (media.poster) {
      player = `<img src="${esc(media.poster)}" alt="">`;
    } else {
      player = "";
    }
    const switcher = post.platform === "youtube" && media.stream ? `<button class="text-btn" type="button" data-act="player-alt" data-id="${esc(id)}">${alt ? "YouTube player" : "Alternate player"}</button>` : "";
    const pip = !embed && /<video/.test(player) && document.pictureInPictureEnabled ? `<button class="text-btn" type="button" data-act="pip">${icon("pip")} Picture in picture</button>` : "";
    const subs = feed.platform === "youtube" && feed.followers != null ? formatCount(feed.followers) + " subscribers" : (feed.followers != null ? formatCount(feed.followers) + " followers" : "");
    const liked = !!STATE.settings.likes[post.id];
    const booked = !!STATE.settings.bookmarks[post.id];
    const disliked = !!STATE.disliked[post.id];
    const likeCount = post.stats && post.stats.likes != null ? formatCount(post.stats.likes) : "";
    const dislikeCount = post.stats && post.stats.dislikes != null ? formatCount(post.stats.dislikes) : "";
    const desc = post.description && post.description !== (post.title || post.text) ? post.description : "";
    const openDesc = !!STATE.expanded["desc:" + id];
    const bucket = watchComments(post);
    const sort = replySortMode();
    let comments = "";
    if (bucket.loading) comments = `<div class="reply-empty">Loading comments…</div>`;
    else if (bucket.missing || !bucket.doc) comments = `<div class="reply-empty">Comments aren’t available for this video.</div>`;
    else {
      const top = (bucket.doc.replies || []).slice();
      const newest = (bucket.doc.newest || []).slice();
      let rows = top;
      if (sort === "recent") {
        rows = newest.length ? newest.slice() : top.slice();
        if (!newest.length) rows.sort(byRecent);
      } else if (sort === "liked") {
        const seen = {};
        rows = [];
        top.concat(newest).forEach((row) => {
          const key = postKey(row);
          if (!key || seen[key]) return;
          seen[key] = true;
          rows.push(row);
        });
        rows.sort(byLikes);
      }
      const total = bucket.doc.commentCount != null ? bucket.doc.commentCount : rows.length;
      const stamped = bucket.fetchedAt || (bucket.doc && bucket.doc.fetchedAt);
      comments = (rows.length ? rows.map(ytComment).join("") : `<div class="reply-empty">No comments yet.</div>`);
      comments = `<h3>${esc(formatCount(total) || "0")} Comments</h3><div class="reply-tools"><span class="reply-fresh">${esc(freshLabel(stamped))}</span></div>${replySortTabs()}${comments}`;
    }
    const up = posts().filter((item) => isVideoPost(item) && followedPost(item) && postKey(item) !== id).sort(byStamp).slice(0, 16);
    const upHtml = up.length ? `<aside class="upnext"><h2>Up next</h2>${up.map((item) => {
      const thumb = ((item.media || [])[0] || {}).poster || "";
      return `<a class="up-row" href="${esc(watchHash(item))}"><div class="yt-thumb">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}${platMark(item.platform)}</div><div><h3 class="yt-title">${esc(item.title || item.text || "")}</h3><div class="yt-by">${esc(item.author || item.handle || "")}</div><div class="yt-sub">${esc(videoMeta(item))}</div></div></a>`;
    }).join("")}</aside>` : `<aside class="upnext"><h2>Up next</h2><p class="yt-sub">No other videos from accounts you follow.</p></aside>`;
    return `<div class="topbar"><div class="page-head"><button class="icon-btn" data-act="back" aria-label="Back">${icon("back")}</button><h1 class="grow">Watch</h1></div></div>
      <div class="watch">
        <div class="watch-main">
          <div class="player">${player}</div>
          ${switcher}${pip}
          <h1 class="watch-title">${esc(post.title || post.text || "")}</h1>
          <div class="watch-chan">
            <a data-card="${esc(feed.platform + ":" + (feed.channelId || feed.handle))}" href="${esc(userHash(feed.platform, feed.channelId || feed.handle))}">${avatar(post.avatar || feed.avatar, feed.name || post.author)}</a>
            <div class="watch-who"><a class="name" data-card="${esc(feed.platform + ":" + (feed.channelId || feed.handle))}" href="${esc(userHash(feed.platform, feed.channelId || feed.handle))}">${esc(feed.name || post.author || "")}${badge(feed.verifiedType || post.verifiedType)}</a><div class="yt-sub">${esc(subs)}</div></div>
            ${followButtonClean(feed.id, true)}
          </div>
          <div class="pills">
            <div class="pill-group">
              <button class="pill${liked ? " on" : ""}" type="button" data-act="like" data-id="${esc(post.id)}" aria-label="Like">${icon("thumb")}${likeCount ? `<span>${esc(likeCount)}</span>` : ""}</button>
              <button class="pill${disliked ? " on" : ""}" type="button" data-act="dislike" data-id="${esc(post.id)}" aria-label="Dislike">${icon("thumbDown")}${dislikeCount ? `<span>${esc(dislikeCount)}</span>` : ""}</button>
            </div>
            <button class="pill" type="button" data-act="share" data-kind="watch" data-id="${esc(post.id)}">${icon("share")}<span>Share</span></button>
            <button class="pill${booked ? " on" : ""}" type="button" data-act="bookmark" data-id="${esc(post.id)}">${icon(booked ? "bookmarkOn" : "bookmark")}<span>${booked ? "Saved" : "Save"}</span></button>
          </div>
          <div class="desc${openDesc || !desc ? "" : " clamped"}">
            <div class="yt-sub">${esc(videoMeta(post))}</div>
            <div class="desc-body">${linkify(desc || post.text || "", post.links, post.platform)}</div>
            ${desc ? `<button class="text-btn" type="button" data-act="more" data-key="desc:${esc(id)}">${openDesc ? "Show less" : "Show more"}</button>` : ""}
          </div>
          <section class="watch-comments">${comments}</section>
        </div>
        ${upHtml}
      </div>`;
  }

  function findComment(items, id) {
    const key = String(id);
    for (const item of items || []) {
      if (!item || typeof item !== "object") continue;
      if (String(item.id) === key || String(item.statusId || "") === key) return item;
      if (Array.isArray(item.replies)) {
        const nested = findComment(item.replies, key);
        if (nested) return nested;
      }
    }
    return null;
  }

  function commentRows(data) {
    if (Array.isArray(data)) return data;
    if (!data || typeof data !== "object") return [];
    return []
      .concat(Array.isArray(data.comments) ? data.comments : [])
      .concat(Array.isArray(data.replies) ? data.replies : [])
      .concat(Array.isArray(data.newest) ? data.newest : []);
  }

  function findAnyPost(id) {
    const key = String(id || "");
    if (!key) return null;
    if (STATE.shared[key]) return STATE.shared[key];
    const direct = posts().find((item) => item.id === key || postKey(item) === key);
    if (direct) return direct;
    const buckets = Object.keys(STATE.replies);
    for (let i = 0; i < buckets.length; i++) {
      const bucket = STATE.replies[buckets[i]] || {};
      const found = findComment(commentRows(bucket.doc).concat(bucket.replies || []), key);
      if (found) return found;
    }
    return null;
  }

  function shareContext() {
    const share = STATE.share;
    if (!share) return null;
    if (share.kind === "profile") {
      const feed = feedById(share.id) || liveProfileById(share.id) || profileStub(share.id);
      if (!feed || !feed.handle) return null;
      const original = externalProfile(feed);
      const routeHandle = feed.platform === "youtube" && feed.channelId ? feed.channelId : feed.handle;
      return {
        permalink: sitePermalink(userHash(feed.platform || "x", routeHandle)),
        original: original && original !== "#" ? original : "",
        title: feed.name || feed.handle || "",
        text: feed.bio || feed.name || "",
        platform: PLATFORM[feed.platform] || "web",
        via: "Share profile via…"
      };
    }
    const post = findAnyPost(share.id);
    if (!post) return null;
    const hash = share.kind === "watch" ? watchHash(post) : statusHash(post);
    return {
      permalink: sitePermalink(hash),
      original: post.url || "",
      title: post.title || post.author || "",
      text: post.text || post.title || "",
      platform: PLATFORM[post.platform] || "web",
      via: "Share post via…"
    };
  }

  function sharePlace(anchor, rows) {
    const width = 320;
    const height = rows * 48 + 16;
    let left = anchor.left;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
    if (left < 12) left = 12;
    const spaceBelow = window.innerHeight - anchor.bottom;
    const spaceAbove = anchor.top;
    const top = spaceBelow >= height || spaceBelow >= spaceAbove ? anchor.bottom + 6 : Math.max(12, anchor.top - height - 6);
    return `top:${Math.round(top)}px;left:${Math.round(left)}px`;
  }

  function shareSheet() {
    const ctx = shareContext();
    if (!ctx || !STATE.share) return "";
    const canNative = typeof navigator.share === "function";
    const original = ctx.original && ctx.original !== ctx.permalink ? ctx.original : "";
    const rows = 1 + (canNative ? 1 : 0) + (original ? 2 : 0);
    const place = STATE.share.anchor ? sharePlace(STATE.share.anchor, rows) : "top:72px;left:16px";
    const via = canNative ? `<button type="button" role="menuitem" data-act="native-share">${icon("share")} ${esc(ctx.via)}</button>` : "";
    const extra = original ? `<div class="share-rule"></div>
      <button type="button" role="menuitem" data-act="copy" data-copy="original" data-url="${esc(original)}">${icon("link")} Copy original link</button>
      <a role="menuitem" data-act="stop" target="_blank" rel="noopener noreferrer" href="${esc(original)}">${icon("external")} Open original on ${esc(ctx.platform)}</a>` : "";
    return `<div class="share-back" data-act="close-share"><div class="share-pop" data-act="stop" role="menu" aria-label="Share" style="${place}">
      <div class="share-grab" aria-hidden="true"></div>
      <button type="button" role="menuitem" data-act="copy" data-copy="site" data-url="${esc(ctx.permalink)}">${icon("link")} Copy link</button>
      ${via}
      ${extra}
    </div></div>`;
  }

  function lookupAncestor(id) {
    const key = String(id || "");
    if (!key || findAnyPost(key) || STATE.chain[key]) return;
    STATE.chain[key] = { loading: true, post: null, missing: false };
    const live = /^\d{8,}$/.test(key) ? fxStatusPost(key) : Promise.resolve(null);
    live.then((post) => {
      if (post) {
        STATE.chain[key] = { loading: false, post: post, missing: false };
        return;
      }
      return fetch("comments/lookup.json", { cache: "no-cache" })
        .then((res) => { if (!res.ok) throw new Error(String(res.status)); return res.json(); })
        .then((lookup) => {
          const stem = lookup && lookup[key];
          if (!stem) throw new Error("missing");
          return snapshotDoc(stem).then((data) => {
            const found = findComment(commentRows(data), key);
            if (!found) throw new Error("missing");
            STATE.chain[key] = { loading: false, post: found, missing: false };
          });
        });
    }).catch(() => { STATE.chain[key] = { loading: false, post: null, missing: true }; })
      .then(() => render());
  }

  function ancestorOf(id) {
    const known = findAnyPost(id);
    if (known) return { post: known, loading: false, missing: false };
    const slot = STATE.chain[String(id)];
    if (!slot) {
      lookupAncestor(id);
      return { post: null, loading: true, missing: false };
    }
    return slot;
  }

  function ancestorChain(focus) {
    const nodes = [];
    let current = focus;
    let loading = false;
    const seen = new Set([postKey(focus), String((focus && focus.id) || "")]);
    for (let guard = 0; guard < 12; guard++) {
      const parentId = String((current.replyingTo || {}).id || "");
      if (!parentId || seen.has(parentId)) break;
      seen.add(parentId);
      const slot = ancestorOf(parentId);
      if (slot.loading) {
        loading = true;
        break;
      }
      if (!slot.post) break;
      nodes.push(slot.post);
      current = slot.post;
    }
    nodes.reverse();
    return { nodes: nodes, loading: loading };
  }

  function originalHandle(focus) {
    const chain = ancestorChain(focus);
    if (chain.nodes.length && chain.nodes[0] && chain.nodes[0].handle) return chain.nodes[0].handle;
    return (focus && focus.handle) || "";
  }

  function ancestorCard(post) {
    const showReply = !!(post.replyingTo && post.replyingTo.handle);
    const reply = showReply ? `<div class="replying">Replying to <a data-act="stop" data-card="${esc((post.platform || "x") + ":" + post.replyingTo.handle)}" href="${esc(userHash(post.platform || "x", post.replyingTo.handle))}">@${esc(post.replyingTo.handle)}</a></div>` : "";
    const face = authorFace(post);
    return `<article class="ancestor" data-open="${esc(statusHash(post))}">
      <div class="ava-col"><a data-act="stop" data-card="${esc((post.platform || "x") + ":" + (post.handle || ""))}" href="${esc(userHash(post.platform, post.handle))}">${avatar(face.avatar, post.author || post.handle)}</a><div class="thread-line"></div></div>
      <div class="ancestor-main">
        <div class="byline">
          <a class="name" data-act="stop" data-card="${esc((post.platform || "x") + ":" + (post.handle || ""))}" href="${esc(userHash(post.platform, post.handle))}">${esc(post.author || post.handle)}${badge(face.verified)}</a>
          <a class="handle" data-act="stop" data-card="${esc((post.platform || "x") + ":" + (post.handle || ""))}" href="${esc(userHash(post.platform, post.handle))}">@${esc(post.handle || "")}</a>
          <span class="dot">·</span>
          <a class="time" data-act="stop" href="${esc(statusHash(post))}">${esc(relTime(post.date))}</a>
        </div>
        ${reply}
        <div class="post-text">${textHtml(post, "anc:" + postKey(post), false)}</div>
        ${mediaHtml(post.media)}
      </div>
    </article>`;
  }

  function ancestorBlock(focus, chain) {
    chain = chain || ancestorChain(focus);
    if (!chain.nodes.length && !chain.loading) return "";
    const id = postKey(focus);
    let html = "";
    if (chain.nodes.length > 3 && !STATE.threadMore[id]) {
      html = ancestorCard(chain.nodes[0]) +
        `<div class="ancestor-gap"><div class="ava-col"><div class="thread-line"></div></div><button class="ancestor-more" type="button" data-act="thread-more" data-id="${esc(id)}">Show more</button></div>` +
        ancestorCard(chain.nodes[chain.nodes.length - 1]);
    } else {
      html = chain.nodes.map(ancestorCard).join("");
    }
    if (chain.loading) html += `<div class="ancestor-loading">Loading…</div>`;
    return html;
  }

  function loadSharedStatus(route) {
    const key = String(route.id);
    const live = (route.platform || "x") === "x" ? hydrateX(key) : Promise.resolve(null);
    live.then((post) => {
      if (post && post.tombstone) {
        STATE.shared[key] = {
          id: key,
          statusId: key,
          platform: "x",
          handle: route.handle || "",
          author: route.handle || "",
          url: sourceUrl("x", route.handle || "", key),
          tombstone: true,
          text: ""
        };
        STATE.sharedState[key] = "ok";
        return;
      }
      if (post) {
        STATE.shared[key] = post;
        STATE.sharedState[key] = "ok";
        return;
      }
      return fetch("comments/lookup.json", { cache: "no-cache" })
        .then((res) => { if (!res.ok) throw new Error(String(res.status)); return res.json(); })
        .then((lookup) => {
          const stem = lookup && lookup[key];
          if (!stem) throw new Error("missing");
          return snapshotDoc(stem).then((data) => {
            const found = findComment(commentRows(data), key);
            if (!found) throw new Error("missing");
            STATE.shared[key] = found;
            STATE.sharedState[key] = "ok";
          });
        });
    }).catch(() => { STATE.sharedState[key] = "miss"; })
      .then(() => render());
  }

  function sharedAccount() {
    const raw = String((STATE.incoming && (STATE.incoming.url || STATE.incoming.text)) || "");
    const found = raw.match(/https?:\/\/[^\s]+/);
    const url = found ? found[0] : raw;
    const skip = { home: 1, share: 1, intent: 1, search: 1, i: 1, p: 1, reel: 1, tv: 1, stories: 1, watch: 1, shorts: 1 };
    let platform = "";
    let handle = "";
    const x = url.match(/(?:x|twitter)\.com\/([A-Za-z0-9_]{1,30})/);
    const ig = url.match(/instagram\.com\/([A-Za-z0-9_.]{1,30})/);
    const th = url.match(/threads\.(?:com|net)\/@([A-Za-z0-9_.]{1,30})/);
    const yt = url.match(/youtube\.com\/@([A-Za-z0-9_-]{1,40})/);
    if (x && !skip[x[1]]) { platform = "x"; handle = x[1]; }
    else if (ig && !skip[ig[1]]) { platform = "instagram"; handle = ig[1]; }
    else if (th && !skip[th[1]]) { platform = "threads"; handle = th[1]; }
    else if (yt) { platform = "youtube"; handle = yt[1]; }
    return { url: url, platform: platform, handle: handle };
  }

  function incomingView() {
    const shared = sharedAccount();
    const feed = shared.handle ? findFeed(shared.platform || "x", shared.handle) : null;
    const q = shared.handle || "";
    const matches = q ? feeds().filter((item) => (item.name + " " + item.handle).toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
    return pageHead("Add account", "", true) + `<div class="modal-body">
      <p>${esc((STATE.incoming && (STATE.incoming.text || STATE.incoming.url)) || shared.url || "")}</p>
      ${shared.handle ? `<p class="phandle">${esc(PLATFORM[shared.platform] || shared.platform)} · @${esc(shared.handle)}</p>` : `<p class="phandle">Search for an account, or follow one that’s already in your feeds.</p>`}
      ${feed ? followButtonClean(feed.id, true) : (shared.handle ? `<p class="phandle">@${esc(shared.handle)} isn’t in the catalog yet. Add the account in feeds.config.json, then sync.</p>` : "")}
      <form data-act="search-form" class="explore-form"><label class="search"><span>${icon("search")}</span><input id="explore-q" value="${esc(q)}" placeholder="Search accounts" aria-label="Search accounts"></label></form>
      ${matches.map(accountRow).join("")}
    </div>`;
  }

  function sourcesView() {
    const head = pageHead("Sources", "", true);
    if (!LIVE.statusLoaded) {
      loadStatus().then(() => render());
      return head + `<div class="reply-empty">Checking sources…</div>`;
    }
    const doc = LIVE.status;
    if (!doc || !(doc.sources || []).length) return head + emptyBlock("No status yet", "The sync publishes status.json with the site. This copy doesn’t have one.");
    const rows = (doc.sources || []).map((row) => {
      const up = !!row.up;
      return `<div class="source-row"><span class="source-state ${up ? "up" : "down"}">${up ? "Up" : "Down"}</span><div><div class="source-name">${esc((row.group || "") + " · " + (row.id || ""))}</div><div class="source-detail">${esc(row.detail || "")}</div></div></div>`;
    }).join("");
    return head + `<p class="source-checked">${esc(freshLabel(doc.checkedAt))}</p>` + rows;
  }

  function view(route) {
    if (STATE.loading) {
      return `<div class="topbar"><div class="page-head"><h1>Home</h1></div></div>` + [0, 1, 2].map(() => `<div class="skel"><div class="av"></div><div style="flex:1"><i></i><i style="width:80%"></i><i style="width:60%"></i></div></div>`).join("");
    }
    if (STATE.error) {
      return pageHead("Home") + `<div class="error-box"><h2>Couldn’t load posts</h2><p>feeds.json didn’t load. Check that the file is next to this page.</p><button class="retry" data-act="reload">Retry</button></div>`;
    }
    const params = new URLSearchParams(location.search);
    if (params.get("empty") === "1" && route.name === "home") return homeHeader("foryou") + emptyBlock("No posts yet", "When the accounts you follow post, their updates will show up here.");
    if (route.name === "home") return homeView(route);
    if (route.name === "profile") return profileView(route);
    if (route.name === "user") return userView(route);
    if (route.name === "status") return statusView(route);
    if (route.name === "explore") return exploreView(route);
    if (route.name === "feeds") return feedsView();
    if (route.name === "lists") return listsView();
    if (route.name === "list") return listView(route);
    if (route.name === "bookmarks") return bookmarksView();
    if (route.name === "subscriptions") return subsView(route);
    if (route.name === "watch") return watchView(route);
    if (route.name === "settings") return settingsView();
    if (route.name === "incoming") return incomingView();
    if (route.name === "notifications") return notesView("Notifications", "Nothing to see here — yet", "From likes to reposts and a whole lot more, this is where all the action happens.");
    if (route.name === "messages") return notesView("Messages", "Welcome to your inbox", "Private conversations aren’t part of this reader.");
    if (route.name === "sources") return sourcesView();
    return homeView({ tab: "foryou", query: new URLSearchParams() });
  }

  let lastKey = "";
  function routeScrollKey() {
    const route = parseRoute();
    if (route.name === "home") return "home:" + (route.tab || "foryou");
    return location.hash || "#/";
  }

  function render(opts) {
    const route = parseRoute();
    const nextKey = routeScrollKey();
    const routeChanged = !!STATE.scrollKey && STATE.scrollKey !== nextKey;
    if (route.name === "status") {
      const sid = String(route.id || "");
      if (STATE.openReply !== sid) {
        STATE.openReply = sid;
        STATE.forceReply = sid;
      }
    } else STATE.openReply = "";
    if (route.name === "watch") {
      const sid = String(route.id || "");
      if (STATE.openWatch !== sid) {
        STATE.openWatch = sid;
        STATE.forceWatch = sid;
      }
    } else STATE.openWatch = "";
    if (route.name !== "status") STATE.focusId = "";
    const reset = opts && opts.reset;
    const y = reset ? 0 : window.scrollY;
    const focus = document.activeElement;
    const focusId = focus && focus.id;
    const caret = focus && typeof focus.selectionStart === "number" ? focus.selectionStart : null;
    document.getElementById("app").innerHTML = shell(view(route), route);
    const liveName = route.name === "user" ? ((STATE.liveUsers[liveKey(route.platform, route.handle)] || {}).profile || {}).name : "";
    document.title = (route.name === "home" ? "Home" : route.name === "status" ? "Post" : route.name === "user" ? (liveName || route.handle || "Profile") : route.name === "incoming" ? "Add account" : route.name[0].toUpperCase() + route.name.slice(1)) + " / Feeds";
    if (opts && Object.prototype.hasOwnProperty.call(opts, "y")) window.scrollTo(0, opts.y);
    else if (reset) window.scrollTo(0, 0);
    else window.scrollTo(0, y);
    if (focusId) {
      const el = document.getElementById(focusId);
      if (el) {
        el.focus();
        if (caret != null && el.setSelectionRange) {
          try { el.setSelectionRange(caret, caret); } catch (err) { /* ignore */ }
        }
      }
    }
    document.querySelectorAll(".topbar").forEach((el) => el.classList.toggle("is-hidden", STATE.headerHidden && window.innerWidth < 500));
    STATE.scrollKey = nextKey;
    lastKey = location.hash;
    if (routeChanged) {
      const center = document.querySelector(".center");
      if (center) center.classList.add("route-in");
    }
    watchHydration();
    syncMediaSession();
  }

  function toast(message) {
    const el = document.getElementById("toast");
    el.hidden = false;
    el.textContent = message;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 1800);
  }

  function openListModal(list) {
    STATE.draft = list ? { id: list.id, name: list.name, description: list.description || "", bannerColor: list.bannerColor || COLORS[0] } : { name: "", description: "", bannerColor: COLORS[0] };
    STATE.modal = "list";
    render();
  }

  function onAct(el) {
    const act = el.dataset.act;
    if (act === "stop") return;
    if (act === "back") {
      if (history.length > 1) history.back();
      else location.hash = "#/";
      return;
    }
    if (act === "reload") { boot(); return; }
    if (act === "drawer") { STATE.drawer = true; render(); return; }
    if (act === "close-drawer") { STATE.drawer = false; render(); return; }
    if (act === "compose") { STATE.modal = "compose"; render(); return; }
    if (act === "close-modal") { STATE.modal = null; STATE.confirm = null; render(); return; }
    if (act === "compose-post") { STATE.modal = null; render(); toast("Posts come from your feeds"); return; }
    if (act === "htab") {
      const tab = el.dataset.tab;
      if (tab === "foryou") location.hash = "#/";
      else if (tab === "following") location.hash = "#/following";
      else if (tab.startsWith("list:")) location.hash = "#/tab/" + tab.slice(5);
      return;
    }
    if (act === "follow") {
      const id = el.dataset.id;
      const i = STATE.settings.follows.indexOf(id);
      if (i >= 0) STATE.settings.follows.splice(i, 1);
      else {
        STATE.settings.follows.push(id);
        const known = feedById(id) || liveProfileById(id);
        const configured = known && (known.configured || (catalogFeed(known) && catalogFeed(known).configured));
        if (!configured) toast("Saved on this device. Add it to feeds.config.json and sync for the home timeline.");
      }
      saveSettings();
      render();
      return;
    }
    if (act === "subs-layout") {
      STATE.subsLayout = el.dataset.layout === "list" ? "list" : "grid";
      render();
      return;
    }
    if (act === "player-alt") {
      const id = el.dataset.id;
      STATE.playerAlt[id] = !STATE.playerAlt[id];
      render();
      return;
    }
    if (act === "dislike") {
      const id = el.dataset.id;
      STATE.disliked[id] = !STATE.disliked[id];
      render();
      return;
    }
    if (act === "reply-sort") {
      const next = el.dataset.sort;
      STATE.replySort = next === "recent" || next === "liked" ? next : "relevant";
      render();
      return;
    }
    if (act === "yt-replies") {
      const id = el.dataset.id;
      STATE.threadsOpen[id] = !STATE.threadsOpen[id];
      render();
      return;
    }
    if (act === "like" || act === "bookmark" || act === "repost") {
      const bucket = act === "like" ? "likes" : act === "bookmark" ? "bookmarks" : "reposts";
      const id = el.dataset.id;
      if (STATE.settings[bucket][id]) {
        delete STATE.settings[bucket][id];
        if (act === "bookmark" && STATE.settings.savedPosts) delete STATE.settings.savedPosts[id];
      } else {
        STATE.settings[bucket][id] = true;
        if (act === "bookmark") rememberBookmark(id);
      }
      saveSettings();
      render();
      return;
    }
    if (act === "install") {
      STATE.drawer = false;
      if (STATE.installPrompt) {
        const prompt = STATE.installPrompt;
        STATE.installPrompt = null;
        Promise.resolve()
          .then(() => prompt.prompt())
          .then(() => prompt.userChoice)
          .then(() => render())
          .catch(() => { STATE.modal = "install"; render(); });
        render();
        return;
      }
      STATE.modal = "install";
      render();
      return;
    }
    if (act === "theme") {
      STATE.settings.appearance = el.dataset.theme || "lightsout";
      saveSettings();
      applyTheme();
      render();
      return;
    }
    if (act === "notify") {
      enableNotifications();
      return;
    }
    if (act === "pip") {
      const video = document.querySelector(".player video");
      if (video && document.pictureInPictureEnabled) {
        const done = document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture();
        Promise.resolve(done).catch(() => {});
      }
      return;
    }
    if (act === "more") {
      const key = el.dataset.key;
      if (String(key || "").indexOf("desc:") === 0) STATE.expanded[key] = !STATE.expanded[key];
      else STATE.expanded[key] = true;
      render();
      return;
    }
    if (act === "menu") { STATE.menu = STATE.menu === el.dataset.id ? null : el.dataset.id; render(); return; }
    if (act === "share") {
      const kind = el.dataset.kind || "post";
      const id = el.dataset.id;
      const key = kind + ":" + id;
      STATE.menu = null;
      if (STATE.share && STATE.share.key === key) {
        STATE.share = null;
        render();
        return;
      }
      const rect = el.getBoundingClientRect();
      STATE.share = { key: key, kind: kind, id: id, anchor: { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right } };
      render();
      return;
    }
    if (act === "close-share") { STATE.share = null; render(); return; }
    if (act === "native-share") {
      const ctx = shareContext();
      const finish = () => { STATE.share = null; render(); };
      if (ctx && typeof navigator.share === "function") {
        navigator.share({ title: ctx.title, text: ctx.text, url: ctx.permalink }).then(finish).catch(finish);
        return;
      }
      finish();
      return;
    }
    if (act === "copy") {
      const ctx = shareContext();
      const url = el.dataset.copy === "original" && ctx ? ctx.original : (el.dataset.url || (ctx ? ctx.permalink : location.href));
      const write = navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(url) : Promise.reject();
      write.catch(() => {
        const area = document.createElement("textarea");
        area.value = url;
        document.body.appendChild(area);
        area.select();
        try { document.execCommand("copy"); } catch (err) { /* ignore */ }
        area.remove();
      });
      STATE.menu = null;
      STATE.share = null;
      render();
      toast("Copied to clipboard");
      return;
    }
    if (act === "open-status") {
      const post = posts().find((p) => p.id === el.dataset.id);
      if (post) location.hash = statusHash(post);
      return;
    }
    if (act === "thread-more") {
      STATE.threadMore[el.dataset.id] = true;
      render();
      return;
    }
    if (act === "more-replies" || act === "spam-replies") {
      const id = el.dataset.id;
      const ui = STATE.replyUi[id] || {};
      if (act === "more-replies") ui.more = true;
      else ui.spam = true;
      STATE.replyUi[id] = ui;
      render();
      return;
    }
    if (act === "play") {
      const video = el.parentElement && el.parentElement.querySelector("video");
      if (video) {
        video.controls = true;
        video.play().catch(() => toast("Video unavailable"));
        el.remove();
      }
      return;
    }
    if (act === "new-list") { openListModal(null); return; }
    if (act === "edit-list") {
      const list = STATE.settings.lists.find((l) => l.id === el.dataset.id);
      if (list) openListModal(list);
      return;
    }
    if (act === "color") { STATE.draft.bannerColor = el.dataset.color; render(); return; }
    if (act === "save-list") {
      const name = (STATE.draft.name || "").trim();
      if (!name) return;
      if (STATE.draft.id) {
        const list = STATE.settings.lists.find((l) => l.id === STATE.draft.id);
        if (list) {
          list.name = name;
          list.description = STATE.draft.description || "";
          list.bannerColor = STATE.draft.bannerColor;
        }
      } else {
        STATE.settings.lists.unshift({
          id: "lst_" + Date.now().toString(36),
          name,
          description: STATE.draft.description || "",
          bannerColor: STATE.draft.bannerColor || COLORS[0],
          members: [],
          pinned: false,
          created: new Date().toISOString()
        });
      }
      saveSettings();
      STATE.modal = null;
      render();
      return;
    }
    if (act === "ask-delete") { STATE.confirm = STATE.draft.id; render(); return; }
    if (act === "confirm-delete") {
      STATE.settings.lists = STATE.settings.lists.filter((l) => l.id !== STATE.confirm);
      saveSettings();
      STATE.confirm = null;
      STATE.modal = null;
      location.hash = "#/lists";
      return;
    }
    if (act === "pin") {
      const list = STATE.settings.lists.find((l) => l.id === el.dataset.id);
      if (list) list.pinned = !list.pinned;
      saveSettings();
      render();
      return;
    }
    if (act === "members") {
      STATE.draft = { id: el.dataset.id, q: "" };
      STATE.modal = "members";
      render();
      return;
    }
    if (act === "member-add" || act === "member-remove") {
      const list = STATE.settings.lists.find((l) => l.id === STATE.draft.id);
      if (list) {
        list.members = list.members || [];
        if (act === "member-add" && !list.members.includes(el.dataset.id)) list.members.push(el.dataset.id);
        if (act === "member-remove") list.members = list.members.filter((id) => id !== el.dataset.id);
        saveSettings();
      }
      render();
      return;
    }
    if (act === "export") {
      const blob = new Blob([JSON.stringify({ version: 1, follows: STATE.settings.follows, lists: STATE.settings.lists, likes: STATE.settings.likes, bookmarks: STATE.settings.bookmarks, reposts: STATE.settings.reposts, savedPosts: STATE.settings.savedPosts || {}, appearance: STATE.settings.appearance || "lightsout", notify: !!STATE.settings.notify }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "rss-feeds-settings.json";
      a.click();
      return;
    }
  }

  document.addEventListener("click", (event) => {
    const actEl = event.target.closest("[data-act]");
    if (actEl) {
      if (actEl.dataset.act !== "stop" && actEl.tagName !== "A") event.preventDefault();
      if (actEl.dataset.act !== "stop") event.stopPropagation();
      onAct(actEl);
      return;
    }
    if (event.target.closest("a, button, video, input, textarea, label")) return;
    const post = event.target.closest("[data-href], [data-open]");
    if (!post) return;
    if (post.dataset.href) window.open(post.dataset.href, "_blank", "noopener,noreferrer");
    else location.hash = post.dataset.open;
  });

  document.addEventListener("input", (event) => {
    const el = event.target;
    if (el.id === "compose-text") {
      const btn = document.getElementById("compose-post");
      if (btn) btn.disabled = !el.value.trim();
      return;
    }
    if (el.dataset && el.dataset.field) {
      STATE.draft[el.dataset.field] = el.value;
      if (el.dataset.field === "name") {
        const save = document.querySelector("[data-act='save-list']");
        if (save) save.disabled = !el.value.trim();
      }
      if (el.dataset.field === "q") render();
    }
  });

  document.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-act='search-form']");
    if (!form) return;
    event.preventDefault();
    const input = form.querySelector("input");
    const q = (input && input.value || "").trim();
    location.hash = "#/explore" + (q ? "?q=" + encodeURIComponent(q) : "");
  });

  document.addEventListener("change", (event) => {
    if (event.target.id !== "import-file" || !event.target.files[0]) return;
    const file = event.target.files[0];
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result));
        if (!data || !Array.isArray(data.follows) || !Array.isArray(data.lists)) throw new Error("bad");
        STATE.settings.follows = data.follows;
        STATE.settings.lists = data.lists;
        STATE.settings.likes = data.likes || {};
        STATE.settings.bookmarks = data.bookmarks || {};
        STATE.settings.reposts = data.reposts || {};
        STATE.settings.savedPosts = data.savedPosts || STATE.settings.savedPosts || {};
        if (data.appearance) STATE.settings.appearance = data.appearance;
        if (data.notify === true && typeof Notification !== "undefined" && Notification.permission === "granted") STATE.settings.notify = true;
        STATE.settings.initialized = true;
        saveSettings();
        render();
        toast("Settings imported");
      } catch (err) {
        toast("Couldn’t read that file");
      }
    };
    reader.readAsText(file);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && (STATE.modal || STATE.drawer || STATE.menu || STATE.share)) {
      STATE.modal = null;
      STATE.drawer = false;
      STATE.menu = null;
      STATE.share = null;
      STATE.confirm = null;
      render();
    }
  });

  document.addEventListener("error", (event) => {
    const img = event.target;
    if (!img || (img.tagName !== "IMG" && img.tagName !== "VIDEO")) return;
    if (img.dataset.fallback === "avatar") {
      const span = document.createElement("span");
      span.className = img.className.replace("ava", "ava initials");
      if (!span.className.includes("initials")) span.className += " initials";
      span.textContent = img.dataset.initials || "?";
      img.replaceWith(span);
      return;
    }
    const next = img.dataset.refresh || "";
    if (next && img.dataset.tried !== "1") {
      img.dataset.tried = "1";
      img.removeAttribute("data-refresh");
      if (img.tagName === "IMG") img.src = next;
      else img.src = next;
      return;
    }
    const tile = img.closest(".tile") || img.closest(".media") || img.closest(".yt-thumb");
    if (tile) {
      tile.classList.add("broken");
      img.remove();
    }
  }, true);

  let lastY = 0;
  window.addEventListener("scroll", () => {
    if (window.innerWidth >= 500) {
      STATE.headerHidden = false;
      return;
    }
    const y = window.scrollY;
    if (y > lastY + 8 && y > 70) STATE.headerHidden = true;
    else if (y < lastY - 8 || y < 40) STATE.headerHidden = false;
    lastY = y;
    document.querySelectorAll(".topbar").forEach((el) => el.classList.toggle("is-hidden", STATE.headerHidden));
  }, { passive: true });

  let hoverTimer = 0;
  document.addEventListener("mouseover", (event) => {
    const el = event.target.closest("[data-card]");
    if (!el || window.innerWidth < 1000) return;
    clearTimeout(hoverTimer);
    hoverTimer = setTimeout(() => showHover(el), 450);
  });
  document.addEventListener("mouseout", (event) => {
    const from = event.target.closest("[data-card], .hcard");
    const to = event.relatedTarget && event.relatedTarget.closest && event.relatedTarget.closest("[data-card], .hcard");
    if (from && !to) {
      clearTimeout(hoverTimer);
      setTimeout(() => {
        if (!document.querySelector(".hcard:hover") && !document.querySelector("[data-card]:hover")) {
          document.getElementById("hover").innerHTML = "";
        }
      }, 200);
    }
  });

  function paintHover(el, profile) {
    const rect = el.getBoundingClientRect();
    const box = document.getElementById("hover");
    if (!box || !profile) return;
    const handle = profile.displayHandle || (profile.platform === "youtube" ? "" : profile.handle);
    const id = liveFollowId(profile);
    box.innerHTML = `<div class="hcard"><div class="hbanner" style="background:${profile.banner ? "url(" + encodeURI(profile.banner) + ") center/cover" : "#333639"}"></div><div class="hbody"><div class="pava-row">${avatar(profile.avatar, profile.name, "pava")}${followButtonClean(id)}</div><div class="name" style="font-weight:800;margin-top:8px">${esc(profile.name || profile.handle || "")}${badge(profile.verifiedType)}</div>${handle ? `<div class="phandle">@${esc(handle)}</div>` : ""}${profile.bio ? `<div class="hbio">${esc(profile.bio)}</div>` : ""}${(profile.following != null || profile.followers != null) ? `<div class="counts">${profile.following != null ? `<div><b>${esc(formatCount(profile.following))}</b> <span>Following</span></div>` : ""}${profile.followers != null ? `<div><b>${esc(formatCount(profile.followers))}</b> <span>${profile.platform === "youtube" ? "Subscribers" : "Followers"}</span></div>` : ""}</div>` : ""}</div></div>`;
    const left = Math.min(rect.left, window.innerWidth - 320);
    box.style.left = Math.max(8, left) + "px";
    box.style.top = (rect.bottom + 8) + "px";
  }

  function showHover(el) {
    const id = el.dataset.card || "";
    const cut = id.indexOf(":");
    if (cut < 1) return;
    const platform = id.slice(0, cut);
    const handle = id.slice(cut + 1);
    if (!handle) return;
    const feed = feedById(id) || findFeed(platform, handle);
    const live = STATE.liveUsers[liveKey(platform, handle)];
    const profile = (live && live.profile) || feed;
    if (!profile) {
      paintHover(el, { platform: platform, handle: handle, name: handle, id: platform + ":" + handle });
      ensureLiveHeader(platform, handle).then(() => {
        const current = document.querySelector("[data-card]:hover");
        if (current) showHover(current);
      });
      return;
    }
    paintHover(el, profile);
  }

  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  let routing = false;
  window.addEventListener("scroll", () => {
    if (routing || !STATE.scrollKey) return;
    SCROLLS[STATE.scrollKey] = window.scrollY;
  }, { passive: true });
  document.addEventListener("click", (event) => {
    const hit = event.target && event.target.closest && event.target.closest("a[href^='#'], [data-act='htab']");
    if (hit && STATE.scrollKey) SCROLLS[STATE.scrollKey] = window.scrollY;
  }, true);
  window.addEventListener("hashchange", () => {
    routing = true;
    STATE.modal = null;
    STATE.drawer = false;
    STATE.menu = null;
    STATE.share = null;
    STATE.headerHidden = false;
    render({ y: SCROLLS[routeScrollKey()] || 0 });
    routing = false;
  });

  function resolvedTheme() {
    const mode = (STATE.settings && STATE.settings.appearance) || "lightsout";
    if (mode === "auto") return matchMedia("(prefers-color-scheme: light)").matches ? "default" : "lightsout";
    return THEME_COLORS[mode] ? mode : "lightsout";
  }

  function applyTheme() {
    const theme = resolvedTheme();
    document.documentElement.setAttribute("data-theme", theme);
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", THEME_COLORS[theme]);
  }

  function slimPost(post) {
    if (!post) return null;
    const media = (post.media || []).slice(0, 4).map((item) => ({ type: item.type, url: item.url || "", poster: item.poster || "", alt: item.alt || "" }));
    return {
      id: post.id,
      statusId: post.statusId || post.id,
      platform: post.platform,
      handle: post.handle,
      author: post.author,
      avatar: post.avatar || "",
      text: post.text || "",
      title: post.title || "",
      date: post.date || "",
      url: post.url || "",
      feedId: post.feedId || "",
      kind: post.kind || "post",
      media: media,
      stats: post.stats || {}
    };
  }

  function rememberBookmark(id) {
    const post = findAnyPost(id);
    const slim = slimPost(post);
    if (!slim) return;
    STATE.settings.savedPosts = STATE.settings.savedPosts || {};
    STATE.settings.savedPosts[id] = slim;
    const urls = [];
    if (slim.avatar) urls.push(slim.avatar);
    (slim.media || []).forEach((item) => {
      if (item.url) urls.push(item.url);
      if (item.poster) urls.push(item.poster);
    });
    const worker = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (worker) worker.postMessage({ type: "cache-bookmark", urls: urls });
  }

  function followedSince(post, since) {
    if (!post || !STATE.settings) return false;
    if (!followedPost(post)) return false;
    return (Date.parse(post.date || "") || 0) > since;
  }

  function updateBadge(count) {
    if (!navigator.setAppBadge) return;
    const op = count > 0 ? navigator.setAppBadge(count) : (navigator.clearAppBadge ? navigator.clearAppBadge() : Promise.resolve());
    Promise.resolve(op).catch(() => {});
  }

  function showPill(show) {
    const el = document.getElementById("new-posts");
    if (el) el.hidden = !show;
  }

  async function fetchFeeds(fresh) {
    const headers = fresh ? { "X-Feed-Refresh": "1" } : {};
    const init = fresh ? { cache: "no-store", headers: headers } : { credentials: "omit" };
    const res = await fetch("feeds.json", init);
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  async function refreshFeeds(apply) {
    try {
      const doc = await fetchFeeds(true);
      if (!doc || !Array.isArray(doc.posts)) return;
      const current = {};
      ((STATE.data && STATE.data.posts) || []).forEach((post) => { current[post.id] = true; });
      const added = doc.posts.filter((post) => !current[post.id]);
      if (apply || !STATE.data) {
        STATE.data = doc;
        STATE.error = null;
        STATE.pendingFeed = null;
        showPill(false);
        render();
        return;
      }
      if (!added.length) return;
      STATE.pendingFeed = doc;
      showPill(true);
      const since = Number(localStorage.getItem("rss-feeds-seen-at") || 0);
      const fresh = doc.posts.filter((post) => followedSince(post, since));
      if (document.hidden) updateBadge(fresh.length || added.length);
      if (document.hidden && STATE.settings && STATE.settings.notify && typeof Notification !== "undefined" && Notification.permission === "granted" && fresh.length) {
        try { new Notification("New posts", { body: fresh.length + " new posts from accounts you follow", icon: "icons/icon-192.png", tag: "feeds" }); } catch (err) { /* permission can change */ }
      }
    } catch (err) { /* keep the posts already on screen */ }
  }

  function syncMediaSession() {
    if (!navigator.mediaSession) return;
    const route = parseRoute();
    if (route.name !== "watch") {
      navigator.mediaSession.metadata = null;
      return;
    }
    const post = posts().find((item) => item.platform === route.platform && String(item.statusId || item.id) === String(route.id)) || STATE.shared[String(route.id)];
    if (!post) return;
    const poster = ((post.media || [])[0] || {}).poster;
    const artwork = [{ src: new URL("icons/icon-512.png", location.href).href, sizes: "512x512", type: "image/png" }];
    if (poster) artwork.unshift({ src: poster, sizes: "1280x720", type: "image/jpeg" });
    try {
      navigator.mediaSession.metadata = new MediaMetadata({
        title: post.title || String(post.text || "").slice(0, 80) || "Video",
        artist: post.author || post.handle || "Feeds",
        artwork: artwork
      });
      const video = document.querySelector(".player video");
      const setHandler = (name, fn) => { try { navigator.mediaSession.setActionHandler(name, fn); } catch (err) { /* this action is not supported */ } };
      setHandler("play", () => { if (video) video.play(); });
      setHandler("pause", () => { if (video) video.pause(); });
    } catch (err) { /* metadata is optional */ }
  }

  function setOffline(offline) {
    const el = document.getElementById("offline");
    if (!el) return;
    const was = !el.hidden;
    el.hidden = !offline;
    if (was && !offline) toast("You're back online");
  }

  function consumeShareTarget() {
    const params = new URLSearchParams(location.search);
    if (!params.has("url") && !params.has("text") && !params.has("title")) return;
    STATE.incoming = { title: params.get("title") || "", text: params.get("text") || "", url: params.get("url") || "" };
    const hash = location.hash && location.hash !== "#/" && location.hash !== "#/home" ? location.hash : "#/incoming";
    history.replaceState(null, "", location.pathname + hash);
  }

  async function enableNotifications() {
    if (typeof Notification === "undefined") { toast("Notifications aren’t available"); return; }
    let permission = Notification.permission;
    if (permission !== "granted") permission = await Notification.requestPermission();
    STATE.settings.notify = permission === "granted";
    saveSettings();
    if (STATE.settings.notify) registerPeriodic();
    render();
    toast(STATE.settings.notify ? "Notifications on" : "Notifications stay off");
  }

  function registerPeriodic() {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.ready.then((reg) => {
      if (!reg.periodicSync) return;
      return reg.periodicSync.register("feeds", { minInterval: 30 * 60 * 1000 });
    }).catch(() => {});
  }

  function syncWorkerState() {
    const worker = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!worker || !STATE.settings) return;
    worker.postMessage({
      type: "state",
      seen: Number(localStorage.getItem("rss-feeds-seen-at") || 0),
      follows: STATE.settings.follows || []
    });
  }

  let swStarted = false;
  function registerSW() {
    if (!("serviceWorker" in navigator) || swStarted) return;
    swStarted = true;
    navigator.serviceWorker.register("sw.js").then(() => {
      syncWorkerState();
      if (STATE.settings && STATE.settings.notify && typeof Notification !== "undefined" && Notification.permission === "granted") registerPeriodic();
    }).catch(() => {});
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event.data || {};
      if (data.type === "data" && /feeds\.json$/.test(data.url || "")) refreshFeeds(false);
      if (data.type === "feeds-updated") refreshFeeds(false);
    });
  }

  let shellBound = false;
  function bindShell() {
    if (shellBound) return;
    shellBound = true;
    window.addEventListener("online", () => setOffline(false));
    window.addEventListener("offline", () => setOffline(true));
    setOffline(!navigator.onLine);
    window.addEventListener("beforeinstallprompt", (event) => {
      event.preventDefault();
      STATE.installPrompt = event;
      render();
    });
    window.addEventListener("appinstalled", () => { STATE.installPrompt = null; render(); });
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
      if (STATE.settings && STATE.settings.appearance === "auto") applyTheme();
    });
    document.getElementById("new-posts").addEventListener("click", () => {
      if (!STATE.pendingFeed) { showPill(false); return; }
      STATE.data = STATE.pendingFeed;
      STATE.pendingFeed = null;
      showPill(false);
      localStorage.setItem("rss-feeds-seen-at", String(Date.now()));
      updateBadge(0);
      const worker = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (worker) worker.postMessage({ type: "seen" });
      render({ y: 0 });
    });
    let pullStart = 0;
    let pulling = false;
    document.addEventListener("touchstart", (event) => {
      if (window.scrollY > 2 || event.touches.length !== 1) { pulling = false; return; }
      pullStart = event.touches[0].clientY;
      pulling = true;
    }, { passive: true });
    document.addEventListener("touchmove", (event) => {
      if (!pulling) return;
      const dy = event.touches[0].clientY - pullStart;
      const el = document.getElementById("pull");
      if (dy > 8 && window.scrollY <= 2) {
        el.classList.add("on");
        el.classList.toggle("ready", dy > 70);
      } else el.classList.remove("on", "ready");
    }, { passive: true });
    document.addEventListener("touchend", () => {
      const el = document.getElementById("pull");
      const ready = el.classList.contains("ready");
      pulling = false;
      el.classList.remove("on", "ready");
      if (ready) {
        refreshOpenComments();
        refreshFeeds(true);
      }
    }, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        localStorage.setItem("rss-feeds-seen-at", String(Date.now()));
        updateBadge(0);
        const worker = navigator.serviceWorker && navigator.serviceWorker.controller;
        if (worker) worker.postMessage({ type: "seen" });
        refreshFeeds(false);
        const route = parseRoute();
        if (route.name === "status" || route.name === "watch") {
          const id = String(route.id || "");
          const bucket = STATE.replies[id] || STATE.replies["watch:yt_" + id] || STATE.replies["watch:" + id];
          if (!bucket || !bucket.fetchedAt || Date.now() - bucket.fetchedAt >= COMMENT_TTL) refreshOpenComments();
        }
      }
    });
  }

  function refreshOpenComments() {
    const route = parseRoute();
    if (route.name === "status" && route.id) {
      const id = String(route.id);
      STATE.openReply = "";
      STATE.forceReply = id;
      delete STATE.replies[id];
      cacheDrop("fx:conv:" + id);
      render();
    }
    if (route.name === "watch" && route.id) {
      const id = String(route.id);
      STATE.openWatch = "";
      STATE.forceWatch = id;
      delete STATE.replies["watch:yt_" + id];
      delete STATE.replies["watch:" + id];
      cacheDrop("yt:doc:" + id);
      render();
    }
  }

  async function boot() {
    consumeShareTarget();
    bindShell();
    registerSW();
    STATE.loading = true;
    STATE.error = null;
    loadStatus();
    STATE.settings = loadSettings();
    applyTheme();
    render();
    const params = new URLSearchParams(location.search);
    try {
      if (params.get("error") === "1") throw new Error("forced");
      STATE.data = await fetchFeeds(false);
      STATE.settings = loadSettings();
      applyTheme();
      STATE.loading = false;
      saveSettings();
      render({ reset: true });
      loadNewestShard().then(() => revealArchive());
      const since = Number(localStorage.getItem("rss-feeds-seen-at") || 0);
      const fresh = (STATE.data.posts || []).filter((post) => followedSince(post, since));
      const periodic = "serviceWorker" in navigator && "periodicSync" in ServiceWorkerRegistration.prototype;
      if (since && fresh.length && STATE.settings.notify && !periodic && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try { new Notification("New posts", { body: fresh.length + " new posts from accounts you follow", icon: "icons/icon-192.png", tag: "feeds" }); } catch (err) { /* already handled by the pill when a later refresh arrives */ }
      }
      if (document.visibilityState === "visible") {
        localStorage.setItem("rss-feeds-seen-at", String(Date.now()));
        updateBadge(0);
      } else if (fresh.length) updateBadge(fresh.length);
    } catch (err) {
      STATE.loading = false;
      STATE.error = err;
      render({ reset: true });
    }
  }

  boot();
})();
