/* X-style reader. Timelines come from feeds.json plus monthly archive stubs on the data branch. X replies, YouTube comments, and old-post details load live in the browser. */
(function () {
  // Keys stay on the rss-feeds- prefix. Storage is per origin, so the Pages
  // path can change without dropping saved follows. Do not rename them.
  const KEY = "rss-feeds-settings-v1";
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  const COLORS = ["#1d9bf0", "#7856ff", "#f91880", "#00ba7c", "#ff7a00", "#333639"];
  const PLATFORM = { x: "X", threads: "Threads", instagram: "Instagram", rss: "RSS", youtube: "YouTube", vk: "VK", discord: "Discord", telegram: "Telegram" };

  const PATH = {
    home: "M21.591 7.146L12.52 1.157c-.316-.21-.724-.21-1.04 0l-9.071 5.99c-.26.173-.409.456-.409.757v13.183c0 .502.418.913.929.913h6.638v-7.075h4.874v7.075h6.639c.51 0 .928-.41.928-.913V7.904c0-.301-.158-.584-.408-.758zM20 20.044h-4.153v-7.075h-7.694v7.075H4V8.31l8-5.31 8 5.31v11.734z",
    homeOn: "M21.591 7.146L12.52 1.157c-.316-.21-.724-.21-1.04 0l-9.071 5.99c-.26.173-.409.456-.409.757v13.183c0 .502.418.913.929.913H9.14a.93.93 0 0 0 .929-.913v-7.075h3.909v7.075c0 .502.417.913.928.913h5.653c.51 0 .929-.41.929-.913V7.904c0-.301-.158-.584-.408-.758z",
    search: "M10.25 3.75c-3.59 0-6.5 2.91-6.5 6.5s2.91 6.5 6.5 6.5c1.795 0 3.419-.726 4.596-1.904 1.178-1.177 1.904-2.801 1.904-4.596 0-3.59-2.91-6.5-6.5-6.5zm-8.5 6.5c0-4.694 3.806-8.5 8.5-8.5s8.5 3.806 8.5 8.5c0 1.986-.682 3.815-1.824 5.262l4.781 4.781-1.414 1.414-4.781-4.781c-1.447 1.142-3.276 1.824-5.262 1.824-4.694 0-8.5-3.806-8.5-8.5z",
    bell: "M19.993 9.042C19.48 5.017 16.054 2 11.996 2s-7.49 3.021-7.999 7.051L2.866 18H7.1c.463 2.282 2.481 4 4.9 4s4.437-1.718 4.9-4h4.236l-1.143-8.958zM12 20c-1.306 0-2.417-.835-2.829-2h5.658c-.412 1.165-1.523 2-2.829 2zm-6.866-4l.847-6.698C6.364 6.272 8.941 4 11.996 4s5.627 2.268 6.013 5.295L18.864 16H5.134z",
    bellOn: "M19.993 9.042C19.48 5.017 16.054 2 11.996 2s-7.49 3.021-7.999 7.051L2.866 18H7.1c.463 2.282 2.481 4 4.9 4s4.437-1.718 4.9-4h4.236l-1.143-8.958z",
    video: "M4 6.5C4 5.12 5.12 4 6.5 4h8c1.38 0 2.5 1.12 2.5 2.5v11c0 1.38-1.12 2.5-2.5 2.5h-8C5.12 20 4 18.88 4 17.5v-11zM15.2 8.4l4.3-2.2v11.6l-4.3-2.2V8.4z",
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
    vol: "M3 9v6h4l5 5V4L7 9H3zm13.5 3a4.5 4.5 0 0 0-2.5-4.03v8.05A4.5 4.5 0 0 0 16.5 12zM14 3.23v2.06a7 7 0 0 1 0 13.42v2.06a9 9 0 0 0 0-17.54z",
    volOff: "M16.5 12a4.5 4.5 0 0 0-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zM19 12c0 .94-.2 1.82-.54 2.64l1.51 1.51A8.8 8.8 0 0 0 21 12c0-4.28-2.99-7.86-7-8.77v2.06A7 7 0 0 1 19 12zM4.27 3 3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06a9 9 0 0 0 3.69-1.81L19.73 21 21 19.73 4.27 3zM12 4 9.91 6.09 12 8.18V4z",
    pin: "M16 3H8v2l1 5-3 3v2h5v6l1 1 1-1v-6h5v-2l-3-3 1-5V3z",
    loc: "M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5 2.5 2.5 0 0 1 12 11.5z",
    link: "M10.6 13.4a1 1 0 0 1 0-1.4l3.4-3.4a2.5 2.5 0 0 1 3.5 3.5l-1.8 1.8-1.4-1.4 1.8-1.8a.5.5 0 0 0-.7-.7l-3.4 3.4a.5.5 0 0 0 0 .7l.2.2-1.4 1.4-.2-.3zm2.8-2.8 1.4 1.4-3.4 3.4a.5.5 0 0 1-.7-.7l1.3-1.3-1.4-1.4-1.3 1.3a2.5 2.5 0 0 0 3.5 3.5l3.4-3.4a2.5 2.5 0 0 0-3.5-3.5l-.3.3z",
    external: "M10 6H5.5C4.12 6 3 7.12 3 8.5v10C3 19.88 4.12 21 5.5 21h10c1.38 0 2.5-1.12 2.5-2.5V14h-2v4.5c0 .28-.22.5-.5.5h-10a.5.5 0 0 1-.5-.5v-10c0-.28.22-.5.5-.5H10V6zm4 0V4h7v7h-2V7.41l-7.29 7.3-1.42-1.42L17.58 6H14z",
    cal: "M7 2h2v2h6V2h2v2h3v16H4V4h3V2zm13 6H4v10h16V8z",
    ig: "M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zm5 4.2A4.8 4.8 0 1 0 16.8 12 4.8 4.8 0 0 0 12 7.2zm6.3-.8a1.15 1.15 0 1 0 1.15 1.15A1.15 1.15 0 0 0 18.3 6.4zM12 9.3A2.7 2.7 0 1 1 9.3 12 2.7 2.7 0 0 1 12 9.3z",
    threads: "M12.2 3C7.8 3 4.6 6.2 4.6 10.8c0 2.3.8 4.3 2.2 5.8l-1 3.2 3.3-1.2c.9.3 1.9.5 2.9.5 4.5 0 7.8-3.2 7.8-7.6C19.8 6.4 16.6 3 12.2 3zm0 2.2c3.2 0 5.4 2.3 5.4 5.5 0 1.5-.5 2.8-1.4 3.8-.3-2.3-1.8-4-4-4.6.8-.4 1.3-1.1 1.3-2 0-1.3-1.1-2.2-2.6-2.2-1.7 0-2.9 1.1-3.1 2.7H6.2c.3-2.6 2.6-4.6 5.9-4.6-.1 0 .1 0 .1 1.4zm-.4 4.2c1.6.2 2.8 1.3 3.1 3-.6.5-1.4.8-2.3.8-1.5 0-2.6-.8-3-2 .7-.3 1.4-.6 2.2-.8z",
    rss: "M6 17.5A1.5 1.5 0 1 1 4.5 16 1.5 1.5 0 0 1 6 17.5zM4 11a7 7 0 0 1 7 7h-2a5 5 0 0 0-5-5v-2zm0-4a11 11 0 0 1 11 11h-2A9 9 0 0 0 4 9V7z",
    discord: "M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7A2.5 2.5 0 0 1 16.5 16H12l-4.2 3.2c-.5.4-1.3 0-1.3-.7V16H7.5A2.5 2.5 0 0 1 5 13.5v-7z",
    vk: "M3.2 6h3.1l2.7 6.6L11.7 6h3.1L10.4 15H7.6L3.2 6zm9.4 0H21v2.2h-5.2v1.6H20v2.1h-4.2v1.7H21V15h-8.4V6z",
    tg: "M2.01 21 23 12 2.01 3 2 10l15 2-15 2z",
    feather: "M22 3.2c-5.8 0-9.4 2.2-12 5.6C8.2 11.4 7.2 15 7 19h2.1c.2-2.6.8-4.8 2-6.2 1 .2 2.1.5 3.2.9l-2.1 3.1h2.2l1.5-2.2c1.7.4 3.4.7 5.2 1 .2-.7.4-1.4.5-2.1-.9-.2-1.7-.4-2.5-.6 2-1.5 3.8-3.5 5-5.9-.3 0-.6-.1-1-.1z",
    pip: "M4 6.5C4 5.12 5.12 4 6.5 4h11C18.88 4 20 5.12 20 6.5v11c0 1.38-1.12 2.5-2.5 2.5h-11C5.12 20 4 18.88 4 17.5v-11zM6.5 6A.5.5 0 0 0 6 6.5v11c0 .28.22.5.5.5h11a.5.5 0 0 0 .5-.5v-11a.5.5 0 0 0-.5-.5h-11zM10 12h8v6h-8v-6z",
    chevL: "M15.4 5.4 9.8 11l5.6 5.6-1.4 1.4L7 11l7-7z",
    chevR: "M8.6 5.4 14.2 11 8.6 16.6l1.4 1.4 7-7-7-7z",
    caret: "M7 9.2 12 14.2 17 9.2l1.2 1.2L12 16.6 5.8 10.4z",
    tick: "M9.2 16.2 4.5 11.5l1.4-1.4 3.3 3.3 7.9-7.9 1.4 1.4z",
    article: "M6 3.5C6 2.67 6.67 2 7.5 2h6.3L18 6.2V20.5c0 .83-.67 1.5-1.5 1.5h-9c-.83 0-1.5-.67-1.5-1.5v-17zM13 3.5V7h3.5L13 3.5zM8.5 11h7v1.6h-7V11zm0 3.4h7v1.6h-7v-1.6zm0 3.4h4.5V19H8.5v-1.2z",
    sliders: "M3 6h8v2H3V6zm12 0h6v2h-6V6zM3 11h4v2H3v-2zm8 0h10v2H11v-2zM3 16h10v2H3v-2zm14 0h4v2h-4v-2zM9 4h2v6H9V4zm6 5h2v6h-2V9zM11 14h2v6h-2v-6z"
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
    removeFeed: null,
    replies: {},
    liveUsers: {},
    replyUi: {},
    subsLayout: "grid",
    commentSort: {},
    threadsOpen: {},
    playerAlt: {},
    disliked: {},
    share: null,
    groupMenu: null,
    tabMenu: null,
    bellMenu: null,
    shared: {},
    sharedState: {},
    chain: {},
    threadMore: {},
    focusId: "",
    replySort: "relevant",
    forceReply: "",
    forceWatch: "",
    replyEpoch: {},
    ytDocs: {},
    pendingFeed: null,
    installPrompt: null,
    incoming: null,
    scrollKey: "",
    sound: false,
    scrolled: false,
    autoEl: null,
    subsHover: null,
    handoff: false,
    translated: {},
    originalShown: {},
    translateText: {},
    lang: {},
    langWait: {},
    histQ: "",
    histPlat: "",
    histClear: "",
    history: null
  };
  let previewAnchor = 0;
  const SCROLLS = {};
  const THEME_COLORS = { default: "#FFFFFF", dim: "#15202B", lightsout: "#000000" };

  const icon = (name) => name === "clock"
    ? `<svg class="clock" viewBox="0 0 24 24" aria-hidden="true">${LINE.clock}</svg>`
    : `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PATH[name] || ""}"/></svg>`;
  const LINE = {
    clock: `<circle cx="12" cy="12" r="8"/><path d="M12 8v4.5l2.8 1.7"/>`,
    rocket: `<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>`,
    posts: `<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>`,
    repost: `<path d="m17 2 4 4-4 4"/><path d="M3 11V10a4 4 0 0 1 4-4h14"/><path d="m7 22-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/>`,
    reply: `<path d="M9 17 4 12l5-5"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/>`,
    pencil: `<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z"/>`,
    pin: `<path d="M12 17v5"/><path d="M9 4h6l-1 6 3 3H7l3-3-1-6z"/>`,
    gear: `<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>`
  };
  const menuIcon = (name) => `<svg class="tab-ico" viewBox="0 0 24 24" aria-hidden="true">${LINE[name] || ""}</svg>`;

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
  function pagesDirectory() {
    let path = location.pathname || "/";
    if (/\/index\.html$/i.test(path)) path = path.slice(0, -"index.html".length);
    path = path.replace(/\/(?:s|u)\/[^/]+$/, "/");
    if (!path.endsWith("/")) path += "/";
    return path;
  }

  function githubRepo() {
    const fallback = "owner-account/SuperintelApp";
    const host = String(location.hostname || "");
    if (!/\.github\.io$/i.test(host)) return fallback;
    const owner = host.split(".")[0];
    const seg = pagesDirectory().split("/").filter(Boolean)[0];
    if (!owner || !seg || seg === "s" || seg === "u") return fallback;
    return owner + "/" + seg;
  }

  const GITHUB_REPO = githubRepo();
  const ARCHIVE_RAW = "https://raw.githubusercontent.com/" + GITHUB_REPO + "/data/archive/";
  const ARCHIVE_CDN = "https://cdn.jsdelivr.net/gh/" + GITHUB_REPO + "@data/archive/";
  const ARCHIVE_IA = "https://archive.org/download/sergi-rss-feeds-archive/archive/";
  const IA = { ready: false, files: [], byUrl: {}, posts: {} };

  function iaParts(url) {
    const match = String(url || "").match(/^https:\/\/(?:cors\.archive\.org\/cors|archive\.org\/(?:download|cors))\/([^/?#]+)\/([^?#]+)/i);
    if (!match) return null;
    try {
      return { id: match[1], file: decodeURIComponent(match[2]) };
    } catch (err) {
      return { id: match[1], file: match[2] };
    }
  }

  function iaDownloadUrl(url) {
    const parts = iaParts(url);
    if (!parts) return "";
    return "https://archive.org/download/" + parts.id + "/" + encodeURIComponent(parts.file).replace(/%2F/g, "/");
  }

  function iaCorsUrl(url) {
    const parts = iaParts(url);
    if (!parts) return "";
    return "https://cors.archive.org/cors/" + parts.id + "/" + encodeURIComponent(parts.file).replace(/%2F/g, "/");
  }

  function iaCandidates(url) {
    const raw = String(url || "");
    const list = [raw];
    if (/pbs\.twimg\.com\/media\//.test(raw) && /[?&]name=/.test(raw)) {
      list.push(raw.replace(/([?&]name=)[^&]+/, "$1orig"));
      list.push(raw.replace(/([?&]name=)[^&]+/, "$1large"));
    }
    return list;
  }

  function installIaManifest(doc) {
    IA.ready = true;
    IA.files = [];
    IA.byUrl = {};
    IA.posts = {};
    if (!doc || Number(doc.v) !== 1 || !Array.isArray(doc.files)) {
      retryWaitingImages();
      return;
    }
    doc.files.forEach((file) => {
      if (!file || !file.u || !file.a) return;
      IA.files.push(file);
      if (!IA.byUrl[file.u]) IA.byUrl[file.u] = file;
    });
    const posts = doc.posts || {};
    Object.keys(posts).forEach((key) => {
      const idxs = posts[key];
      if (!Array.isArray(idxs)) return;
      IA.posts[key] = idxs.map((index) => doc.files[index]).filter((file) => file && file.a);
    });
    retryWaitingImages();
  }

  function iaForUrl(url) {
    let found = "";
    iaCandidates(url).forEach((item) => {
      if (found) return;
      const file = IA.byUrl[item];
      if (file) found = iaDownloadUrl(file.a);
    });
    return found;
  }

  function nextIaUrl(img) {
    const origin = img.dataset.iaOrigin || img.getAttribute("src") || "";
    if (!img.dataset.iaOrigin) img.dataset.iaOrigin = origin;
    const step = img.dataset.iaStep || "";
    if (step === "") {
      const found = iaForUrl(origin);
      if (found && found !== img.src) {
        img.dataset.iaStep = "download";
        return found;
      }
    }
    if (step !== "cors") {
      const basis = iaForUrl(origin) || origin;
      const cors = iaCorsUrl(basis);
      if (cors && cors !== img.src) {
        img.dataset.iaStep = "cors";
        return cors;
      }
    }
    return "";
  }

  function useArchiveMedia(img) {
    if (!img || img.tagName !== "IMG") return false;
    if (!IA.ready) {
      img.dataset.iaWait = "1";
      return true;
    }
    const next = nextIaUrl(img);
    if (!next) return false;
    img.removeAttribute("srcset");
    img.referrerPolicy = "no-referrer";
    img.src = next;
    return true;
  }

  function retryWaitingImages() {
    document.querySelectorAll("img[data-ia-wait]").forEach((img) => {
      img.removeAttribute("data-ia-wait");
      if (useArchiveMedia(img)) return;
      finishMediaError(img);
    });
  }

  function finishMediaError(img) {
    if (!img || !img.isConnected) return;
    if (img.dataset.fallback === "avatar") {
      const span = document.createElement("span");
      span.className = String(img.className || "").replace("ava", "ava initials");
      if (span.className.indexOf("initials") < 0) span.className += " initials";
      span.textContent = img.dataset.initials || "?";
      img.replaceWith(span);
      return;
    }
    const tile = img.closest(".tile") || img.closest(".media") || img.closest(".yt-thumb");
    if (tile) tile.classList.add("broken");
    img.remove();
  }

  function archivedFromManifest(stub) {
    if (!stub) return null;
    const rows = IA.posts[postIdentity(stub)] || [];
    if (!rows.length) return null;
    let avatar = "";
    const media = [];
    rows.forEach((file) => {
      const playback = iaDownloadUrl(file.a);
      const cors = iaCorsUrl(file.a);
      if (!playback) return;
      if (file.k === "avatar") {
        avatar = playback;
        return;
      }
      if (file.k === "video" || file.k === "animated_gif") {
        media.push({
          type: file.k === "animated_gif" ? "animated_gif" : "video",
          url: playback,
          fallback: cors,
          poster: file.p ? iaForUrl(file.p) : ""
        });
        return;
      }
      media.push({ type: "photo", url: playback, fallback: cors });
    });
    if (!media.length && !avatar) return null;
    return Object.assign({}, stub, {
      stub: false,
      archived: true,
      tombstone: false,
      avatar: avatar || stub.avatar || "",
      media: media.length ? media : (stub.media || [])
    });
  }

  function applyIaPreview(doc) {
    const host = String(location.hostname || "");
    if (host !== "localhost" && host !== "127.0.0.1") return false;
    if (new URLSearchParams(location.search).get("ia-deleted") !== "1") return false;
    if (!doc || !Array.isArray(doc.posts)) return false;
    const dead = "https://example.invalid/deleted-source.jpg";
    const saved = "https://archive.org/download/3163616/3163616_thumb.jpg";
    installIaManifest({
      v: 1,
      files: [{ u: dead, a: saved, k: "photo" }, { u: dead, a: saved, k: "avatar" }],
      posts: { "x:9001": [0, 1] }
    });
    if (!doc.posts.some((post) => post && String(post.id) === "9001")) {
      doc.posts.unshift({
        id: "9001",
        statusId: "9001",
        platform: "x",
        handle: "archived",
        author: "Deleted post",
        feedId: "x:archived",
        kind: "post",
        text: "This post was deleted at the source. The photo is loading from archive.org.",
        date: "2099-10-21T12:00:00Z",
        url: "https://x.com/archived/status/9001",
        media: [{ type: "photo", url: dead, alt: "Saved on archive.org" }],
        avatar: dead
      });
    }
    return true;
  }

  function canonicalId(post) {
    const platform = (post && post.platform) || "";
    const rawId = String((post && post.id) || "");
    if (rawId.indexOf("repost:") === 0) return rawId;
    let raw = String((post && (post.statusId || post.id)) || "");
    const url = String((post && post.url) || "");
    if (platform === "instagram") {
      const match = (url.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/) || raw.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/) || [])[1];
      if (match) return match;
    }
    if (platform === "threads") {
      const match = (url.match(/threads\.(?:com|net)\/(?:@[^/]+\/)?(?:post|t)\/([A-Za-z0-9_-]+)/) || raw.match(/threads\.(?:com|net)\/(?:@[^/]+\/)?(?:post|t)\/([A-Za-z0-9_-]+)/) || [])[1];
      if (match) return match;
    }
    if (platform === "youtube" || raw.indexOf("yt:video:") === 0) {
      if (raw.indexOf("yt:video:") === 0) raw = raw.split(":").pop();
      const found = (raw + " " + url).match(/(?:[?&]v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
      if (found) return found[1];
      if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw;
    }
    return raw;
  }

  function canonicalPostId(post) {
    return canonicalId(post);
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
    if (platform === "vk" && id) return "https://vk.com/wall" + id;
    if (platform === "telegram" && handle && id) return "https://t.me/" + handle + "/" + id;
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
    if (bridgeErrorPost({ text: row.t || "", id: String(row.id || ""), url: "" })) return null;
    const platform = String(row.p);
    const id = String(row.id);
    const handle = String(row.h || "");
    const community = row.k === "community";
    const url = community ? "https://www.youtube.com/post/" + id : sourceUrl(platform, handle, id);
    const author = String(row.a || handle);
    const avatar = /^https:\/\//.test(String(row.av || "")) ? String(row.av) : "";
    const channelId = /^UC[\w-]{10,}$/.test(String(row.c || "")) ? String(row.c) : "";
    const reposter = String(row.rb || "").replace(/^@/, "");
    const post = {
      id: id,
      statusId: id,
      platform: platform,
      handle: handle,
      author: author,
      feedId: reposter ? platform + ":" + reposter : platform + ":" + handle,
      kind: row.k || "post",
      text: row.t || "",
      date: row.d || "",
      url: url,
      media: community ? [] : stubMedia(platform, id, url),
      stub: true
    };
    if (avatar) post.avatar = avatar;
    if (channelId) post.channelId = channelId;
    if (reposter) {
      post.repostedBy = { handle: reposter, name: String(row.rn || reposter), platform: platform };
      if (!post.kind || post.kind === "post") post.kind = "repost";
    }
    if (row.rc) post.repostComment = String(row.rc);
    if (platform === "youtube" && ytVideoId(id)) post.watch = true;
    return post;
  }

  function deadMediaUrl(url) {
    return /instagram\.com\/(?:p|reel|tv)\/[^/?#]+\/media(?:\/|\?|$)/i.test(String(url || ""));
  }

  function samePostKey(post) {
    const blob = String((post && (post.url || post.statusId || post.id)) || "");
    const ig = blob.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/i);
    if (ig) return "instagram:" + ig[1].toLowerCase();
    const threads = blob.match(/threads\.(?:com|net)\/(?:@[^/]+\/post|t)\/([A-Za-z0-9_-]+)/i);
    if (threads) return "threads:" + threads[1].toLowerCase();
    const watch = blob.match(/(?:[?&]v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
    if (watch) return "youtube:" + watch[1];
    const prefixed = String((post && (post.statusId || post.id)) || "");
    if (prefixed.indexOf("yt:video:") === 0) return "youtube:" + prefixed.split(":").pop();
    if ((post && post.platform) === "youtube" && /^[A-Za-z0-9_-]{11}$/.test(prefixed)) return "youtube:" + prefixed;
    return "";
  }

  function mediaScore(post) {
    let score = 0;
    ((post && post.media) || []).forEach((item) => {
      if (!item) return;
      const poster = String(item.poster || "");
      const file = String(item.url || "");
      if (poster && !deadMediaUrl(poster)) score += 4;
      if (file && playableFile(file)) score += 4;
      else if (file && !deadMediaUrl(file)) score += 2;
    });
    return score;
  }

  function collapseSameUrl(list) {
    const best = {};
    list.forEach((post) => {
      const key = samePostKey(post);
      if (!key) return;
      const prev = best[key];
      if (!prev || mediaScore(post) > mediaScore(prev)) best[key] = post;
    });
    return list.filter((post) => {
      const key = samePostKey(post);
      const winner = key && best[key];
      if (!winner || winner === post) return true;
      if ((winner.kind || "post") !== (post.kind || "post")) return true;
      if ((winner.handle || "").toLowerCase() !== (post.handle || "").toLowerCase()) return true;
      return mediaScore(winner) <= mediaScore(post);
    });
  }

  function posts() {
    const full = (STATE.data && STATE.data.posts) || [];
    const seen = {};
    full.forEach((post) => { seen[postIdentity(post)] = true; });
    const extra = ARCHIVE.posts.filter((post) => !seen[postIdentity(post)]).map((post) => HYDRATED[postIdentity(post)] || post);
    return collapseSameUrl(full.concat(extra)).filter((post) => !bridgeErrorPost(post));
  }

  function httpsUrl(value) {
    const text = String(value || "");
    if (!/^https:\/\//.test(text) || text.length > 400) return "";
    return text;
  }

  function cleanBells(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    Object.keys(raw).forEach((key) => {
      if (!key || key.length > 120) return;
      const row = raw[key];
      if (!row || (row.mode !== "all" && row.mode !== "live")) return;
      const ids = [];
      (Array.isArray(row.ids) ? row.ids : [key]).forEach((item) => {
        const text = String(item || "");
        if (text && text.length < 120 && ids.indexOf(text) < 0 && ids.length < 12) ids.push(text);
      });
      const handles = [];
      (Array.isArray(row.handles) ? row.handles : []).forEach((item) => {
        const text = String(item || "").toLowerCase();
        if (text && text.length < 120 && handles.indexOf(text) < 0 && handles.length < 24) handles.push(text);
      });
      out[key] = {
        mode: row.mode,
        since: Number(row.since) || 0,
        ids: ids.length ? ids : [key],
        handles: handles,
        handle: String(row.handle || "").replace(/^@/, "").slice(0, 80),
        name: String(row.name || "").slice(0, 80)
      };
    });
    return out;
  }

  function cleanBellNotes(list) {
    if (!Array.isArray(list)) return [];
    const out = [];
    list.forEach((item) => {
      if (!item || !item.id || out.length >= 80) return;
      const hash = String(item.hash || "#/");
      out.push({
        id: String(item.id).slice(0, 160),
        at: Number(item.at) || 0,
        handle: String(item.handle || "").replace(/^@/, "").slice(0, 80),
        name: String(item.name || "").slice(0, 80),
        text: String(item.text || "").slice(0, 280),
        avatar: httpsUrl(item.avatar),
        image: httpsUrl(item.image),
        hash: hash.charAt(0) === "#" && hash.length < 300 ? hash : "#/"
      });
    });
    return out;
  }

  function loadSettings() {
    const configured = feeds().filter((f) => f.configured).map((f) => f.id);
    const fresh = () => ({ version: 1, initialized: true, follows: configured.slice(), seenFeeds: configured.slice(), seenDefaults: configured.slice(), lists: [], likes: {}, bookmarks: {}, reposts: {}, savedPosts: {}, appearance: "lightsout", notify: false, autoplay: "all", mutedWords: [], mutedAccounts: [], repostOff: [], groups: [], groupsOwn: false, subsGroup: "", followingSort: "recent", forYouReposts: true, forYouReplies: true, tabViews: {}, translateTo: "en", bells: {}, bellNotes: [], bellSeen: [], bellRead: 0, historyPause: { videos: false, articles: false } });
    try {
      const raw = localStorage.getItem(KEY);
      if (!raw) return fresh();
      const parsed = JSON.parse(raw);
      parsed.follows = Array.isArray(parsed.follows) ? parsed.follows : configured.slice();
      parsed.lists = Array.isArray(parsed.lists) ? parsed.lists : [];
      parsed.lists.forEach((list) => {
        if (!list || typeof list !== "object") return;
        if (list.sort !== "popular" && list.sort !== "recent") delete list.sort;
      });
      parsed.likes = parsed.likes || {};
      parsed.bookmarks = parsed.bookmarks || {};
      parsed.reposts = parsed.reposts || {};
      parsed.savedPosts = parsed.savedPosts || {};
      if (!parsed.appearance) parsed.appearance = "lightsout";
      if (parsed.notify !== true) parsed.notify = false;
      if (parsed.autoplay !== "wifi" && parsed.autoplay !== "never") parsed.autoplay = "all";
      parsed.mutedWords = Array.isArray(parsed.mutedWords) ? parsed.mutedWords : [];
      parsed.mutedAccounts = Array.isArray(parsed.mutedAccounts) ? parsed.mutedAccounts : [];
      parsed.repostOff = Array.isArray(parsed.repostOff) ? parsed.repostOff : [];
      parsed.groups = Array.isArray(parsed.groups) ? cleanGroups(parsed.groups) : [];
      parsed.groupsOwn = parsed.groupsOwn === true;
      parsed.subsGroup = typeof parsed.subsGroup === "string" ? parsed.subsGroup : "";
      parsed.followingSort = parsed.followingSort === "popular" ? "popular" : "recent";
      parsed.forYouReposts = parsed.forYouReposts !== false;
      parsed.forYouReplies = parsed.forYouReplies !== false;
      parsed.tabViews = cleanTabViews(parsed.tabViews);
      parsed.translateTo = window.FeedsTranslate ? window.FeedsTranslate.normalize(parsed.translateTo) : (parsed.translateTo || "en");
      parsed.bells = cleanBells(parsed.bells);
      parsed.bellNotes = cleanBellNotes(parsed.bellNotes);
      parsed.bellSeen = Array.isArray(parsed.bellSeen) ? parsed.bellSeen.map((id) => String(id)).slice(-500) : [];
      parsed.bellRead = Number(parsed.bellRead) || 0;
      parsed.historyPause = cleanHistoryPause(parsed.historyPause);
      if (!parsed.initialized) {
        parsed.follows = configured.slice();
        parsed.seenFeeds = configured.slice();
        parsed.seenDefaults = configured.slice();
        parsed.initialized = true;
      } else mergeDefaultFollows(parsed, configured);
      return parsed;
    } catch (err) {
      return fresh();
    }
  }

  function saveSettings() {
    localStorage.setItem(KEY, JSON.stringify(STATE.settings));
    syncWorkerState();
  }

  function feedHasPosts(id) {
    return posts().some((post) => post && post.feedId === id);
  }

  // seenDefaults is every default this device has already been offered.
  // A configured feed that appears later is followed once. Unfollow leaves
  // the id in the list, so the next load does not add it again.
  function mergeDefaultFollows(parsed, configured) {
    if (!configured.length || !posts().length) return;
    const follows = parsed.follows || [];
    if (!Array.isArray(parsed.seenDefaults)) {
      if (Array.isArray(parsed.seenFeeds)) {
        parsed.seenDefaults = parsed.seenFeeds.slice();
        // The first migration copied every configured id into seenFeeds and
        // followed only vk:vk. An empty feed in that list was never unfollowed.
        configured.forEach((id) => {
          if (follows.indexOf(id) >= 0 || feedHasPosts(id)) return;
          const at = parsed.seenDefaults.indexOf(id);
          if (at >= 0) parsed.seenDefaults.splice(at, 1);
        });
      } else {
        parsed.seenDefaults = follows.slice();
        configured.forEach((id) => {
          if (parsed.seenDefaults.indexOf(id) >= 0) return;
          if (id === "vk:vk") return;
          if (feedHasPosts(id)) parsed.seenDefaults.push(id);
        });
      }
    }
    configured.forEach((id) => {
      if (parsed.seenDefaults.indexOf(id) < 0) {
        parsed.seenDefaults.push(id);
        if (follows.indexOf(id) < 0) follows.push(id);
      }
    });
    parsed.follows = follows;
    parsed.seenFeeds = parsed.seenDefaults.slice();
  }

  function rememberUnfollow(id) {
    if (!STATE.settings || !id) return;
    if (!Array.isArray(STATE.settings.seenDefaults)) STATE.settings.seenDefaults = (STATE.settings.seenFeeds || []).slice();
    if (STATE.settings.seenDefaults.indexOf(id) < 0) STATE.settings.seenDefaults.push(id);
    STATE.settings.seenFeeds = STATE.settings.seenDefaults.slice();
  }

  function isFollowed(id) { return STATE.settings.follows.includes(id); }
  function feedById(id) { return feeds().find((f) => f.id === id); }

  function cleanGroups(list) {
    const out = [];
    const seen = {};
    (list || []).forEach((item) => {
      if (!item) return;
      const id = String(item.id || "").trim();
      const name = String(item.name || "").replace(/\s+/g, " ").trim().slice(0, 40);
      if (!/^[A-Za-z0-9_-]{1,40}$/.test(id) || !name || seen[id]) return;
      seen[id] = true;
      let icon = String(item.icon || "").trim();
      if (!/^https:\/\//.test(icon) || icon.length > 300) icon = "";
      const members = [];
      (item.members || []).forEach((member) => {
        const text = String(member || "").trim();
        if (!text || text.length > 80 || /[\s<>]/.test(text) || members.indexOf(text) >= 0) return;
        members.push(text);
      });
      out.push({ id: id, name: name, icon: icon, members: members.slice(0, 200) });
    });
    return out.slice(0, 40);
  }

  function groupsEqual(a, b) {
    return JSON.stringify(cleanGroups(a)) === JSON.stringify(cleanGroups(b));
  }

  function absorbSiteGroups(config) {
    if (!STATE.settings) return false;
    const site = cleanGroups(config && config.groups);
    if (!STATE.settings.groupsOwn) {
      const changed = !groupsEqual(STATE.settings.groups, site);
      STATE.settings.groups = site;
      if (changed) saveSettings();
      return changed;
    }
    if (groupsEqual(STATE.settings.groups, site)) {
      STATE.settings.groupsOwn = false;
      saveSettings();
    }
    return false;
  }

  function subsHash(groupId) {
    const id = String(groupId || "");
    const known = id && (STATE.settings.groups || []).some((group) => group.id === id);
    if (!known) return "#/subscriptions";
    return "#/subscriptions?group=" + encodeURIComponent(id);
  }

  function subsChannelHash(groupId, channelId) {
    const base = subsHash(groupId);
    const id = String(channelId || "");
    if (!id) return base;
    const cut = base.indexOf("?");
    const path = "#/subscriptions/" + encodeURIComponent(id);
    return cut < 0 ? path : path + base.slice(cut);
  }

  function profileHash(platform, handle) {
    if (!handle) return "#/";
    if ((platform || "x") === "x") return `#/@${encodeURIComponent(handle)}`;
    return `#/${encodeURIComponent(platform)}/${encodeURIComponent(handle)}`;
  }
  function userHash(platform, handle) {
    if (!handle) return "#/";
    return "#/u/" + encodeURIComponent(platform || "x") + "/" + encodeURIComponent(handle);
  }
  function catalogAccount(platform, handle) {
    const key = String(handle || "").replace(/^@/, "");
    if (!key) return null;
    const platformName = platform || "x";
    const lower = key.toLowerCase();
    return feeds().find((feed) => {
      if ((feed.platform || "x") !== platformName) return false;
      if (String(feed.handle || "").toLowerCase() === lower) return true;
      if (feed.channelId && feed.channelId === key) return true;
      if (feed.id === platformName + ":" + key) return true;
      return false;
    }) || null;
  }
  function accountHash(platform, handle) {
    if (window.FeedsPeople) {
      const merged = window.FeedsPeople.hashFor(platform, handle);
      if (merged) return merged;
    }
    const feed = catalogAccount(platform, handle);
    if (feed && feed.handle) return profileHash(feed.platform, feed.handle);
    return userHash(platform, handle);
  }
  function statusHash(post) {
    const platform = post.platform || "x";
    const handle = post.handle || "";
    const id = post.statusId || post.id;
    if (platform === "x") return `#/@${encodeURIComponent(handle)}/status/${encodeURIComponent(id)}`;
    return `#/${encodeURIComponent(platform)}/${encodeURIComponent(handle)}/status/${encodeURIComponent(id)}`;
  }


  function parseAccountInput(raw) {
    const text = String(raw || "").trim();
    if (!text || text.length > 300) return null;
    const prefixed = text.match(/^(x|threads|instagram|youtube|vk|rss|telegram):(\S+)$/i);
    if (prefixed) return { platform: prefixed[1].toLowerCase(), account: text };
    if (/^https?:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[A-Za-z0-9_]{1,15}\/?$/i.test(text)) return { platform: "x", account: text };
    if (/^@?[A-Za-z0-9_]{1,15}$/.test(text)) return { platform: "x", account: text.replace(/^@/, "") };
    if (/threads\.(?:com|net)\/@/i.test(text)) return { platform: "threads", account: text };
    if (/instagram\.com\/[A-Za-z0-9._]+/i.test(text)) return { platform: "instagram", account: text };
    if (/(?:youtube\.com|youtu\.be)\//i.test(text)) return { platform: "youtube", account: text };
    if (/vk\.com\/[A-Za-z0-9_.]+/i.test(text)) return { platform: "vk", account: text };
    if (/^(?:https?:\/\/)?(?:www\.)?(?:t\.me|telegram\.me)\/(?:s\/)?[A-Za-z][A-Za-z0-9_]{4,31}(?:\/\d+)?\/?$/i.test(text)) return { platform: "telegram", account: text };
    if (/^@?[A-Za-z][A-Za-z0-9_]{16,32}$/.test(text)) return { platform: "telegram", account: text.replace(/^@/, "") };
    if (/^https:\/\/\S+$/i.test(text)) return { platform: "rss", account: text };
    return null;
  }

  function followIssueUrl(kind, account, platform) {
    const template = kind === "unfollow" ? "unfollow-request.yml" : "follow-request.yml";
    const title = (kind === "unfollow" ? "Unfollow request: " : "Follow request: ") + platform + " " + account;
    const params = new URLSearchParams({ template: template, title: title, account: account, platform: platform });
    return "https://github.com/" + GITHUB_REPO + "/issues/new?" + params.toString();
  }

  function configuredFeed(id) {
    const direct = feedById(id);
    if (direct && direct.configured) return direct;
    const parts = String(id || "").split(":");
    const known = catalogAccount(parts[0], parts.slice(1).join(":"));
    return known && known.configured ? known : null;
  }

  function groupsIssueUrl() {
    const payload = JSON.stringify(cleanGroups(STATE.settings.groups));
    const params = new URLSearchParams({ template: "groups.yml", title: "Subscription groups", groups: payload });
    return "https://github.com/" + GITHUB_REPO + "/issues/new?" + params.toString();
  }

  function followIssueUrlForId(kind, id) {
    const feed = feedById(id) || configuredFeed(id);
    const platform = (feed && feed.platform) || String(id || "").split(":")[0] || "x";
    const handle = (feed && (feed.handle || feed.channelId)) || String(id || "").split(":").slice(1).join(":");
    const account = (feed && feed.url) || (platform + ":" + handle);
    return followIssueUrl(kind, account, platform);
  }

  function sitePermalink(hash) {
    const url = new URL(location.href);
    if (url.pathname.endsWith("/index.html")) url.pathname = url.pathname.slice(0, -"index.html".length);
    url.search = "";
    const clean = hash.startsWith("#") ? hash : "#" + hash;
    return url.origin + url.pathname + clean;
  }

  function shareRoot() {
    const url = new URL(location.href);
    let path = url.pathname;
    if (path.endsWith("/index.html")) path = path.slice(0, -"index.html".length);
    path = path.replace(/\/(?:s|u)\/[^/]+$/, "/");
    if (!path.endsWith("/")) path += "/";
    return url.origin + path;
  }

  function shareFileToken(post) {
    const raw = String((post && (post.statusId || post.id)) || "");
    if (/^[A-Za-z0-9_-]{1,120}$/.test(raw)) return raw;
    const canon = canonicalId(post);
    if (/^[A-Za-z0-9_-]{1,120}$/.test(canon)) return canon;
    const slug = String(canon || raw).replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
    return /^[A-Za-z0-9_-]{1,120}$/.test(slug) ? slug : "";
  }

  const PUBLISHED = { posts: new Set() };

  function notePublished(doc) {
    const next = new Set();
    ((doc && doc.posts) || []).forEach((post) => {
      const token = shareFileToken(post);
      if (!token) return;
      next.add((post.platform || "x") + ":" + token);
    });
    PUBLISHED.posts = next;
  }

  function postIsPublished(post) {
    const token = shareFileToken(post);
    if (!post || !token) return false;
    const platform = post.platform || "x";
    if (PUBLISHED.posts.has(platform + ":" + token)) return true;
    if ((ARCHIVE.posts || []).some((row) => row && row.p === platform && String(row.id) === token)) return true;
    return !!(post.stub && String(post.statusId || post.id) === token);
  }

  function profileIsPublished(feed) {
    if (!feed || !feed.handle) return false;
    const handle = String(feed.handle).replace(/^@/, "");
    if (!/^[A-Za-z0-9._-]{1,80}$/.test(handle)) return false;
    const platform = feed.platform || "x";
    return feeds().some((item) => (item.platform || "x") === platform && String(item.handle || "").replace(/^@/, "").toLowerCase() === handle.toLowerCase());
  }

  function sharePostUrl(post, kind) {
    const token = shareFileToken(post);
    if (!token || !postIsPublished(post)) return "";
    if (kind === "watch" && (post.platform || "") === "youtube" && /^[A-Za-z0-9_-]{11}$/.test(token)) return shareRoot() + "s/watch-" + token + ".html";
    return shareRoot() + "s/" + (post.platform || "x") + "-" + token + ".html";
  }

  function shareProfileUrl(feed) {
    if (!profileIsPublished(feed)) return "";
    const handle = String(feed.handle).replace(/^@/, "");
    return shareRoot() + "u/" + (feed.platform || "x") + "-" + handle + ".html";
  }

  function unpublishedNote(kind, platform, hasOriginal) {
    const name = PLATFORM[platform] || "the original site";
    const what = kind === "profile" ? "profile" : "post";
    if (hasOriginal) return "This " + what + " isn’t in the published snapshot, so the link opens on " + name + ".";
    return "This " + what + " isn’t in the published snapshot, so there is no preview page for it.";
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
      const key = (post.platform || "") + ":" + (post.kind === "repost" ? post.id : (post.statusId || post.id));
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

  const OPEN_KEY = "rss-feeds-opened-v1";
  const SNAP_KEY = "rss-feeds-timeline-v1";
  const QUEUE_KEY = "rss-feeds-bookmark-queue";

  function openedList() {
    if (STATE.opened) return STATE.opened;
    try { STATE.opened = JSON.parse(localStorage.getItem(OPEN_KEY) || "[]"); }
    catch (err) { STATE.opened = []; }
    if (!Array.isArray(STATE.opened)) STATE.opened = [];
    return STATE.opened;
  }

  function rememberOpened(post) {
    const slim = slimPost(post);
    if (!slim || !slim.id) return;
    slim.kind = post.kind || "post";
    if (post.repostedBy) slim.repostedBy = { handle: post.repostedBy.handle || "", name: post.repostedBy.name || "", avatar: post.repostedBy.avatar || "" };
    const list = openedList().filter((item) => item && item.id !== slim.id);
    list.unshift(slim);
    STATE.opened = list.slice(0, 24);
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(STATE.opened)); } catch (err) { /* the snapshot is optional */ }
  }

  function openedPost(id) {
    const key = String(id || "");
    return openedList().find((item) => item && (item.id === key || String(item.statusId || "") === key)) || null;
  }

  function loadTimelineSnap() {
    try {
      const doc = JSON.parse(localStorage.getItem(SNAP_KEY) || "null");
      if (!doc || !Array.isArray(doc.posts)) return null;
      return doc;
    } catch (err) { return null; }
  }

  function saveTimelineSnap(doc) {
    if (!doc || !Array.isArray(doc.posts)) return;
    const posts = doc.posts.slice(0, 40).map((post) => {
      const row = slimPost(post);
      if (!row) return null;
      row.kind = post.kind || "post";
      if (post.repostedBy) row.repostedBy = { handle: post.repostedBy.handle || "", name: post.repostedBy.name || "", avatar: post.repostedBy.avatar || "" };
      if (post.replyingTo) row.replyingTo = { handle: post.replyingTo.handle || "", id: post.replyingTo.id || "" };
      return row;
    }).filter(Boolean);
    const copy = { updated: doc.updated || "", feeds: doc.feeds || [], posts: posts };
    try {
      let text = JSON.stringify(copy);
      if (text.length > 400000) {
        copy.posts = copy.posts.slice(0, 20);
        text = JSON.stringify(copy);
      }
      localStorage.setItem(SNAP_KEY, text);
    } catch (err) { /* a full storage quota keeps the previous snapshot */ }
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
    const nested = commentInDocs(String(id));
    if (nested && nested.comment) {
      const comment = nested.comment;
      if (platform && comment.platform && comment.platform !== platform) return openedPost(id);
      if (h && (comment.handle || "").toLowerCase() !== h) return openedPost(id);
      return comment;
    }
    return openedPost(id);
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
    const name = platform === "instagram" ? "ig" : platform === "threads" ? "threads" : platform === "youtube" ? "subs" : platform === "vk" ? "vk" : platform === "telegram" ? "tg" : platform === "discord" ? "discord" : "rss";
    return `<span class="src" title="${esc(PLATFORM[platform] || "RSS")}">${icon(name)}</span>`;
  }

  function externalProfile(feed) {
    if (feed.url) return feed.url;
    if (feed.platform === "x") return "https://x.com/" + feed.handle;
    if (feed.platform === "threads") return "https://www.threads.com/@" + feed.handle;
    if (feed.platform === "instagram") return "https://www.instagram.com/" + feed.handle + "/";
    if (feed.platform === "youtube") return "https://www.youtube.com/@" + feed.handle;
    if (feed.platform === "vk") return "https://vk.com/" + feed.handle;
    if (feed.platform === "telegram") return "https://t.me/" + feed.handle;
    return feed.url || "#";
  }

  function mentionHref(user, platform) {
    if (platform === "instagram") return "https://www.instagram.com/" + user + "/";
    if (platform === "threads") return "https://www.threads.com/@" + user;
    if (platform === "telegram") return "https://t.me/" + user;
    return "https://x.com/" + user;
  }
  function hashHref(tag, platform, handle) {
    const clean = encodeURIComponent(tag);
    if (platform === "instagram") return "https://www.instagram.com/explore/tags/" + clean + "/";
    if (platform === "threads") return "https://www.threads.com/search?q=" + encodeURIComponent("#" + tag);
    if (platform === "vk") return "https://vk.com/feed?section=search&q=" + encodeURIComponent("#" + tag);
    if (platform === "telegram") return "https://t.me/s/" + encodeURIComponent(handle || "") + "?q=" + encodeURIComponent("#" + tag);
    return "https://x.com/hashtag/" + clean;
  }

  function linkify(text, links, platform, handle) {
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
        html += `<a class="entity" data-act="stop" data-card="${esc((platform || "x") + ":" + mention[1])}" href="${esc(accountHash(platform || "x", mention[1]))}">@${esc(mention[1])}</a>`;
        i += mention[0].length;
        continue;
      }
      const hash = src.slice(i).match(platform === "vk" || platform === "telegram" ? /^#([\p{L}\p{N}_]{1,50})/u : /^#([A-Za-z0-9_]{1,50})/);
      if (hash && (i === 0 || /\s/.test(src[i - 1]))) {
        html += `<a class="entity" data-act="stop" target="_blank" rel="noopener noreferrer" href="${esc(hashHref(hash[1], platform, handle))}">#${esc(hash[1])}</a>`;
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

  function discordEmojiHtml(html, emojis) {
    const map = {};
    (emojis || []).forEach((emoji) => {
      const name = emoji && /^[A-Za-z0-9_]{2,32}$/.test(emoji.name) ? emoji.name : "";
      const url = emoji && /^https:\/\/cdn\.discordapp\.com\/(?:emojis\/\d+\.(?:png|gif)|embed\/avatars\/\d\.png)(?:\?.*)?$/.test(String(emoji.url || "")) ? emoji.url : "";
      if (name && url) map[name] = url;
    });
    const names = Object.keys(map);
    if (!names.length) return html;
    return String(html || "").split(/(<[^>]+>)/).map((part) => {
      if (!part || part.charAt(0) === "<") return part;
      return part.replace(/:([A-Za-z0-9_]{2,32}):/g, (whole, name) => {
        if (!map[name]) return whole;
        return `<img class="discord-emoji" alt=":${esc(name)}:" src="${esc(map[name])}" referrerpolicy="no-referrer">`;
      });
    }).join("");
  }

  function withDiscordEmoji(post, html) {
    if (!post || post.platform !== "discord") return html;
    return discordEmojiHtml(html, post.emojis);
  }

  function safeRich(html) {
    const raw = String(html || "");
    if (!raw || /<\s*script\b|javascript:|onerror\s*=|onload\s*=/i.test(raw)) return "";
    return raw;
  }

  function textHtml(post, key, full) {
    if (window.FeedsTranslate) {
      const swapped = window.FeedsTranslate.textFor(key);
      if (swapped != null) return linkify(swapped, post.links || [], post.platform, post.handle);
    } else {
      const translated = STATE.translated[key];
      if (translated && !STATE.originalShown[key]) {
        return linkify(translated, [], post.platform, post.handle) + ` <button class="show-more" data-act="show-original" data-key="${esc(key)}">Show original</button>`;
      }
    }
    const text = post.text || "";
    const rich = safeRich(post.html);
    if (rich && (full || STATE.expanded[key] || text.length <= 280)) return rich;
    if (full || STATE.expanded[key] || text.length <= 280) return linkify(text, post.links, post.platform, post.handle);
    let cut = text.slice(0, 280);
    const sp = cut.lastIndexOf(" ");
    if (sp > 220) cut = cut.slice(0, sp);
    return linkify(cut, post.links, post.platform, post.handle) + ` <button class="show-more" data-act="more" data-key="${esc(key)}">Show more</button>`;
  }

  function readerLanguage() {
    return String(navigator.language || "en").toLowerCase().slice(0, 2) || "en";
  }

  function foreignScript(text) {
    const sample = String(text || "");
    const latin = (sample.match(/[A-Za-z]/g) || []).length;
    const other = (sample.match(/[\u0400-\u04FF\u0500-\u052F\u0590-\u05FF\u0600-\u06FF\u0370-\u03FF\u0E00-\u0E7F\u3040-\u30FF\u3400-\u9FFF\uAC00-\uD7AF]/g) || []).length;
    return other >= 8 && other > latin;
  }

  function translateTarget() {
    const code = STATE.settings && STATE.settings.translateTo;
    return String(code || "en").toLowerCase().slice(0, 2) || "en";
  }

  function offerTranslate(key, text) {
    const sample = String(text || "").trim();
    if (sample.length < 8) return false;
    if (STATE.translated[key] && !STATE.originalShown[key]) return false;
    /* Cyrillic (and other non-Latin scripts) stay offered when the target is
       English even if the phone language is Russian or the detector is missing. */
    if (foreignScript(sample) && translateTarget() === "en") return true;
    const known = STATE.lang[key];
    if (known === "yes") return true;
    if (known === "no") return false;
    return foreignScript(sample);
  }

  function textBlock(post, key, full, cls) {
    const sample = String(post.text || "").trim().slice(0, 5000);
    if (sample) STATE.translateText[key] = sample;
    STATE.translateLinks = STATE.translateLinks || {};
    STATE.translatePlatform = STATE.translatePlatform || {};
    STATE.translateFull = STATE.translateFull || {};
    STATE.translateLinks[key] = post.links || [];
    STATE.translatePlatform[key] = post.platform || "";
    STATE.translateFull[key] = !!full;
    if (window.FeedsTranslate) window.FeedsTranslate.prepare(key);
    const inner = withDiscordEmoji(post, textHtml(post, key, full));
    if (window.FeedsTranslate) return window.FeedsTranslate.block(post, key, cls, inner);
    const offer = offerTranslate(key, sample)
      ? `<button class="show-more translate-link" type="button" data-act="translate" data-key="${esc(key)}">Translate post</button>`
      : "";
    return `<div class="${cls || "post-text"}" data-tr="${esc(key)}">${inner}</div>${offer}`;
  }

  function bioBlock(entity) {
    if (!entity || !entity.bio) return "";
    const key = "bio:" + (entity.id || ((entity.platform || "x") + ":" + (entity.handle || "")));
    return textBlock({ text: entity.bio, platform: entity.platform, handle: entity.handle, links: [], kind: "bio", id: key }, key, true, "bio");
  }

  function scheduleDetect() {
    if (window.FeedsTranslate) { window.FeedsTranslate.scheduleDetect(); return; }
    if (typeof LanguageDetector === "undefined") return;
    const rows = [];
    const nodes = document.querySelectorAll("[data-tr]");
    for (let i = 0; i < nodes.length && rows.length < 40; i++) {
      const node = nodes[i];
      const key = node.dataset.tr;
      if (!key || STATE.lang[key] || STATE.langWait[key]) continue;
      const text = (node.innerText || "").trim();
      if (text.length < 8) continue;
      rows.push({ key: key, text: text.slice(0, 2000) });
    }
    if (!rows.length) return;
    rows.forEach((row) => { STATE.langWait[row.key] = true; });
    const generation = (STATE.langGen = (STATE.langGen || 0) + 1);
    detectLanguages(rows, generation);
  }

  async function detectLanguages(rows, generation) {
    try {
      if (!STATE.detector) STATE.detector = await LanguageDetector.create();
      let changed = false;
      const target = translateTarget();
      for (let i = 0; i < rows.length; i++) {
        if (STATE.langGen !== generation) return;
        const row = rows[i];
        const found = await STATE.detector.detect(row.text);
        const top = found && found[0];
        const code = top && top.detectedLanguage ? String(top.detectedLanguage).toLowerCase().slice(0, 2) : "";
        let decision = foreignScript(row.text) ? "yes" : "no";
        if (foreignScript(row.text) && target === "en") decision = "yes";
        else if (top && top.confidence >= 0.6 && code) decision = code === target ? "no" : "yes";
        const before = offerTranslate(row.key, row.text);
        STATE.lang[row.key] = decision;
        STATE.langWait[row.key] = false;
        if (offerTranslate(row.key, row.text) !== before) changed = true;
      }
      if (changed && STATE.langGen === generation) render();
    } catch (err) {
      rows.forEach((row) => { STATE.langWait[row.key] = false; });
    }
  }

  async function translateNow(key) {
    if (window.FeedsTranslate) return window.FeedsTranslate.translate(key);
    const sample = String(STATE.translateText[key] || "").slice(0, 5000);
    const target = translateTarget();
    if (!sample) return;
    try {
      if (typeof Translator !== "undefined" && typeof LanguageDetector !== "undefined") {
        if (!STATE.detector) STATE.detector = await LanguageDetector.create();
        const found = await STATE.detector.detect(sample);
        const top = found && found[0];
        let source = top && top.confidence >= 0.6 && top.detectedLanguage ? String(top.detectedLanguage).toLowerCase().slice(0, 2) : "";
        if (foreignScript(sample) && target === "en" && (!source || source === "en")) source = "ru";
        if (source && source !== target) {
          const availability = await Translator.availability({ sourceLanguage: source, targetLanguage: target });
          if (availability && availability !== "unavailable") {
            const pair = source + ":" + target;
            STATE.translators = STATE.translators || {};
            if (!STATE.translators[pair]) STATE.translators[pair] = await Translator.create({ sourceLanguage: source, targetLanguage: target });
            const out = await STATE.translators[pair].translate(sample);
            if (out && out !== sample) {
              STATE.translated[key] = out;
              STATE.originalShown[key] = false;
              render();
              return;
            }
          }
        }
      }
    } catch (err) { /* the browser translator is optional */ }
  }

  function formatDur(value) {
    let n = Number(value);
    if (!isFinite(n) || n <= 0) return "";
    if (n > 100000) n = Math.round(n / 1000);
    n = Math.round(n);
    const m = Math.floor(n / 60);
    const s = n % 60;
    return m + ":" + (s < 10 ? "0" : "") + s;
  }

  function youtubeId(post, media) {
    const blob = [media && media.videoId, media && media.url, post && post.url, post && post.statusId, post && post.id].join(" ");
    const match = blob.match(/(?:embed\/|watch\?v=|youtu\.be\/|shorts\/|[?&]v=)([A-Za-z0-9_-]{11})/);
    if (match) return match[1];
    const direct = String((media && media.videoId) || "");
    if (/^[A-Za-z0-9_-]{11}$/.test(direct)) return direct;
    if (post && post.platform === "youtube" && post.kind !== "community") {
      const id = String(post.statusId || post.id || "");
      if (/^[A-Za-z0-9_-]{11}$/.test(id)) return id;
    }
    return "";
  }

  function watchOn(platform) {
    if (platform === "instagram") return "Watch on Instagram";
    if (platform === "threads") return "Watch on Threads";
    if (platform === "youtube") return "Watch on YouTube";
    if (platform === "x") return "Watch on X";
    if (platform === "vk") return "Watch on VK";
    if (platform === "telegram") return "Watch on Telegram";
    return "Open original";
  }

  function originalOf(post, media) {
    if (post && post.url && !/youtube-nocookie\.com\/embed\//.test(post.url)) return post.url;
    const id = youtubeId(post, media);
    if (id) return "https://www.youtube.com/watch?v=" + id;
    return (post && post.url) || "";
  }

  function playPost(el) {
    const id = el && el.dataset.pid;
    if (!id) return null;
    const direct = posts().find((item) => item && (item.id === id || String(item.statusId || "") === id)) || STATE.shared[id] || null;
    if (direct) return direct;
    const list = posts();
    for (let i = 0; i < list.length; i++) {
      const quoted = list[i] && list[i].quoted;
      if (quoted && (quoted.id === id || String(quoted.statusId || "") === id)) return asPost(quoted, quoted.platform || list[i].platform || "x");
    }
    return null;
  }

  function posterList(post, media) {
    const out = [];
    const push = (url) => {
      const text = String(url || "").trim();
      if (!text || !/^https:\/\//i.test(text) || playableFile(text) || out.indexOf(text) >= 0) return;
      out.push(text);
    };
    push(media && media.poster);
    if (media && media.type !== "video" && media && media.type !== "animated_gif") push(media && media.url);
    else if (media && media.url && !playableFile(media.url)) push(media.url);
    const yt = youtubeId(post, media);
    if (yt) {
      push("https://i.ytimg.com/vi/" + yt + "/hqdefault.jpg");
      push("https://i.ytimg.com/vi/" + yt + "/mqdefault.jpg");
      push("https://i.ytimg.com/vi/" + yt + "/sddefault.jpg");
    }
    const avatar = upgradeAvatar((post && post.avatar) || "") || ((post && post.avatar) || "");
    push(avatar);
    const saved = [];
    out.forEach((url) => {
      const next = iaForUrl(url);
      if (next) saved.push(next);
      const cors = next ? iaCorsUrl(next) : "";
      if (cors) saved.push(cors);
    });
    saved.forEach(push);
    return { urls: out, avatar: avatar };
  }

  function posterImg(post, media, cls) {
    const pack = posterList(post, media);
    if (!pack.urls.length) return "";
    const first = pack.urls[0];
    const face = first === pack.avatar ? " face" : "";
    return `<img class="${cls}${face}" src="${esc(first)}" alt="" referrerpolicy="no-referrer" data-pi="0" data-avatar="${esc(pack.avatar)}" data-falls="${esc(JSON.stringify(pack.urls))}">`;
  }

  function advancePoster(img) {
    if (!img || !img.dataset) return false;
    let urls = [];
    try { urls = JSON.parse(img.dataset.falls || "[]"); } catch (err) { urls = []; }
    const next = Number(img.dataset.pi || 0) + 1;
    if (!urls[next]) return false;
    img.dataset.pi = String(next);
    img.classList.toggle("face", urls[next] === (img.dataset.avatar || ""));
    img.referrerPolicy = "no-referrer";
    img.src = urls[next];
    return true;
  }

  function playMedia(el, post) {
    const index = Number(el && el.dataset.mi);
    const list = (post && post.media) || [];
    return list[isFinite(index) ? index : 0] || list[0] || null;
  }

  function playerTile(post, media, index, preview) {
    const platform = (post && post.platform) || "";
    const yt = youtubeId(post, media);
    const dur = formatDur(media && media.duration);
    const gif = media && media.type === "animated_gif";
    const label = watchOn(yt ? "youtube" : platform);
    const href = originalOf(post, media);
    const mode = preview === "feed" || preview === "subs" ? preview : "";
    const chrome = mode === "feed" && !gif
      ? `<button class="vmute" type="button" data-act="mute" aria-label="Unmute" aria-pressed="false" hidden>${icon("volOff")}</button><span class="vleft" hidden></span>`
      : "";
    const round = media && media.round ? " round" : "";
    const progress = !gif && post ? videoProgress(post) : 0;
    const bar = progress > 0.02 ? `<span class="vprog" style="width:${Math.round(progress * 100)}%"></span>` : "";
    return `<div class="tile vplay${round}"${mode ? ` data-preview="${mode}"` : ""} data-act="play" data-pid="${esc((post && post.id) || "")}" data-mi="${index}">
      ${posterImg(post, media, "vposter")}
      ${bar}
      ${dur ? `<span class="vdur">${esc(dur)}</span>` : ""}
      ${gif ? `<span class="gif-badge">GIF</span>` : ""}
      <button class="play" type="button" data-act="play" aria-label="Play">${icon("play")}</button>
      <button class="vretry" type="button" data-act="video-retry" hidden>Retry</button>
      <a class="vfallback" data-act="stop" hidden target="_blank" rel="noopener noreferrer" href="${esc(href || "#")}"><span>${esc(label)}</span></a>
      ${chrome}
    </div>`;
  }

  function imageSrcset(url) {
    const raw = String(url || "");
    if (/pbs\.twimg\.com\/media\//.test(raw) && /[?&]name=/.test(raw)) {
      const small = raw.replace(/([?&]name=)[^&]+/, "$1small");
      const large = raw.replace(/([?&]name=)[^&]+/, "$1large");
      return ` srcset="${esc(small)} 680w, ${esc(large)} 1280w" sizes="(max-width: 500px) 92vw, 500px"`;
    }
    if (/i\.ytimg\.com\/vi\//.test(raw) && /default\.jpg/.test(raw)) {
      const mq = raw.replace(/\/(?:mq|hq|sd|maxres)default\.jpg/, "/mqdefault.jpg");
      const hq = raw.replace(/\/(?:mq|hq|sd|maxres)default\.jpg/, "/hqdefault.jpg");
      return ` srcset="${esc(mq)} 320w, ${esc(hq)} 480w" sizes="(max-width: 500px) 92vw, 480px"`;
    }
    return "";
  }

  function attachmentHtml(items) {
    return (items || []).filter((item) => item && (item.type === "file" || item.type === "audio")).map((item) => {
      const href = item.url || item.open || "#";
      const kind = item.type === "audio" ? "Voice" : "File";
      const extra = item.extra ? `<span class="file-extra">${esc(item.extra)}</span>` : "";
      return `<a class="file-card" data-act="stop" target="_blank" rel="noopener noreferrer" href="${esc(href)}"><span class="file-kind">${kind}</span><span class="file-title">${esc(item.title || kind)}</span>${extra}</a>`;
    }).join("");
  }

  function postCards(post) {
    const seen = {};
    const rows = [];
    const add = (link) => {
      if (!link || !link.url || seen[link.url] || isArticleLink(link, post)) return;
      seen[link.url] = true;
      const html = linkCard(link, post);
      if (html) rows.push(html);
    };
    add(post && post.link);
    ((post && post.cards) || []).forEach(add);
    return rows.join("");
  }

  function discordMeta(post) {
    if (!post || post.platform !== "discord") return "";
    const guild = post.guildId || "";
    const href = guild ? profileHash("discord", guild) : (post.url || "#");
    const channel = post.channelName ? `<a class="discord-channel" data-act="stop" href="${esc(href)}">#${esc(post.channelName)}</a>` : "";
    const thread = post.threadName ? `<span class="discord-thread">${esc(post.threadName)}</span>` : "";
    const bot = post.bot ? `<span class="discord-bot">Bot</span>` : "";
    if (!channel && !thread && !bot) return "";
    return `<div class="discord-meta">${channel}${thread}${bot}</div>`;
  }

  function audienceCounts(profile, word) {
    if (!profile) return "";
    const label = word || (profile.platform === "youtube" || profile.platform === "telegram" ? "Subscribers" : profile.platform === "discord" ? "Members" : "Followers");
    const bits = [];
    if (profile.following != null) bits.push(`<div><b>${esc(formatCount(profile.following))}</b> <span>Following</span></div>`);
    if (profile.followers != null) bits.push(`<div><b>${esc(formatCount(profile.followers))}</b> <span>${label}</span></div>`);
    if (profile.platform === "discord" && profile.online != null) bits.push(`<div><b>${esc(formatCount(profile.online))}</b> <span>Online</span></div>`);
    return bits.length ? `<div class="counts">${bits.join("")}</div>` : "";
  }

  function linkCard(link) {
    if (!link || !link.url) return "";
    const image = link.image ? `<img class="link-card-img" src="${esc(link.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "";
    const site = link.site ? `<span class="link-site">${esc(link.site)}</span>` : "";
    const title = `<span class="link-title">${esc(link.title || link.url)}</span>`;
    const description = link.description ? `<span class="link-desc">${esc(link.description)}</span>` : "";
    const id = arguments[1] && arguments[1].id ? ` data-id="${esc(arguments[1].id)}"` : "";
    return `<a class="link-card" data-act="open-link"${id} target="_blank" rel="noopener noreferrer" href="${esc(link.url)}">${image}<span class="link-card-copy">${site}${title}${description}</span></a>`;
  }

  function mediaHtml(items, eager, post) {
    const files = attachmentHtml(items);
    const list = (items || []).filter((m) => m && m.type !== "file" && m.type !== "audio" && (m.url || m.poster || m.videoId || m.type === "embed" || m.type === "placeholder" || m.type === "video" || m.type === "animated_gif")).slice(0, 4);
    if (!list.length) return files;
    if (list.length === 1 && list[0].type === "embed") {
      const embed = list[0];
      const open = embed.open ? `<a class="open-original" data-act="stop" target="_blank" rel="noopener noreferrer" href="${esc(embed.open)}">Open original</a>` : "";
      return `<div class="media m1 embed-media"><div class="tile embed-tile"><iframe src="${esc(embed.url)}" title="${esc(embed.title || "Post")}" loading="lazy"></iframe>${open}</div></div>` + files;
    }
    if (list.length === 1 && list[0].type === "placeholder") {
      return `<div class="media m1"><div class="tile broken"><a class="open-original" data-act="stop" target="_blank" rel="noopener noreferrer" href="${esc(list[0].url || "#")}">Open original</a></div></div>` + files;
    }
    const n = list.length;
    const cls = n === 1 ? "m1" : n === 2 ? "m2" : n === 3 ? "m3" : "m4";
    const tiles = list.map((m, index) => {
      if (m.type === "video" || m.type === "animated_gif" || youtubeId(post, m)) {
        return playerTile(post || { media: [m] }, m, index, "feed");
      }
      const alt = m.alt ? `<span class="alt-badge">ALT</span>` : "";
      const refresh = m.fallback ? ` data-refresh="${esc(m.fallback)}"` : "";
      const first = eager && index === 0;
      const src = m.url || m.poster || "";
      const loading = first ? "eager" : "lazy";
      const priority = first ? ` fetchpriority="high"` : "";
      return `<div class="tile" data-act="view" data-id="${esc((post && post.id) || "")}" data-mi="${index}"><img src="${esc(src)}"${imageSrcset(src)}${refresh} alt="${esc(m.alt || "")}" loading="${loading}" decoding="async"${priority} referrerpolicy="no-referrer">${alt}</div>`;
    }).join("");
    return `<div class="media ${cls}">${tiles}</div>` + files;
  }

  function fetchTimed(url, ms) {
    return fetch(url, { cache: "no-cache", signal: AbortSignal.timeout(ms || 5000) }).then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.json();
    });
  }

  function healthyIv() {
    return loadStatus().then(() => ivBases()).then((bases) => (bases || IV_SEEDS).filter((base) => base && !LIVE.dead[base]));
  }

  function pushSource(list, item) {
    if (!item || !item.url) return;
    if (list.some((row) => row.url === item.url)) return;
    list.push(item);
  }

  function youtubeSources(id) {
    const narrow = (window.innerWidth || 390) < 700;
    const itags = narrow ? ["18", "22"] : ["22", "18"];
    return healthyIv().then((bases) => {
      const out = [];
      let chain = Promise.resolve();
      bases.slice(0, 3).forEach((base) => {
        chain = chain.then(() => {
          if (out.length >= 4) return null;
          return fetchTimed(base + "/api/v1/videos/" + encodeURIComponent(id), 5000).then((data) => {
            itags.forEach((itag) => {
              pushSource(out, { kind: "mp4", url: base + "/latest_version?id=" + encodeURIComponent(id) + "&itag=" + itag + "&local=true" });
            });
            ((data && data.formatStreams) || []).forEach((row) => {
              const itag = String((row && row.itag) || "");
              if (itags.indexOf(itag) < 0 || !row.url) return;
              pushSource(out, { kind: "mp4", url: row.url });
            });
            if (data && data.hlsUrl) pushSource(out, { kind: "hls", url: data.hlsUrl });
          }).catch(() => {
            itags.forEach((itag) => {
              pushSource(out, { kind: "mp4", url: base + "/latest_version?id=" + encodeURIComponent(id) + "&itag=" + itag + "&local=true" });
            });
          });
        });
      });
      return chain.then(() => out);
    }).then((out) => {
      const pipedBases = PIPED_SEEDS.filter((base) => !LIVE.dead[base]).slice(0, 2);
      let chain = Promise.resolve();
      pipedBases.forEach((base) => {
        chain = chain.then(() => {
          if (out.length >= 6) return null;
          return fetchTimed(base + "/streams/" + encodeURIComponent(id), 5000).then((data) => {
            ((data && data.videoStreams) || []).forEach((row) => {
              if (!row || !row.url || row.videoOnly) return;
              const mime = String(row.mimeType || row.format || "");
              if (mime && !/mp4|webm/i.test(mime)) return;
              pushSource(out, { kind: "mp4", url: row.url });
            });
            if (data && data.hls) pushSource(out, { kind: "hls", url: data.hls });
          }).catch(() => null);
        });
      });
      return chain.then(() => {
        pushSource(out, { kind: "iframe", url: embedUrl(id, false) });
        return out.slice(0, 7);
      });
    });
  }

  function embedUrl(id, preview) {
    const base = "https://www.youtube-nocookie.com/embed/" + encodeURIComponent(id);
    const api = "&enablejsapi=1&origin=" + encodeURIComponent(location.origin) + "&widget_referrer=" + encodeURIComponent(location.origin + "/");
    if (preview) return base + "?autoplay=1&mute=1&playsinline=1&controls=0&rel=0" + api;
    return base + "?rel=0" + api;
  }

  function metaCode(post) {
    const blob = [(post && post.url) || "", (post && post.statusId) || "", (post && post.id) || ""].join(" ");
    const ig = blob.match(/instagram\.com\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/);
    if (ig) return ig[1];
    const threads = blob.match(/threads\.(?:com|net)\/(?:@[^/\s]+\/)?(?:post|t)\/([A-Za-z0-9_-]+)/);
    if (threads) return threads[1];
    const code = String((post && post.statusId) || "");
    if (code && !/^\d+$/.test(code) && /^[A-Za-z0-9_-]{5,}$/.test(code)) return code;
    return "";
  }

  function metaRefresh(post) {
    const code = metaCode(post);
    if (!code) return Promise.resolve(null);
    const platform = post.platform || "";
    const pages = platform === "threads"
      ? ["https://www.threads.net/t/" + code + "/embed", "https://www.threads.com/t/" + code]
      : ["https://www.instagram.com/reel/" + code + "/embed/captioned/", "https://www.instagram.com/p/" + code + "/embed/captioned/"];
    let chain = Promise.resolve(null);
    pages.forEach((page) => {
      chain = chain.then((found) => {
        if (found && found.url) return found;
        return fetch(page, { signal: AbortSignal.timeout(5000) }).then((res) => res.ok ? res.text() : "").then((html) => {
          if (!html || (html.indexOf("httpErrorPage") >= 0 && html.toLowerCase().indexOf(".mp4") < 0)) return found;
          const match = html.replace(/\\\//g, "/").match(/https:\/\/[^"'\\\s]+\.mp4[^"'\\\s]*/i);
          if (!match || !playableFile(match[0])) return found;
          return { url: match[0] };
        }).catch(() => found);
      });
    });
    return chain;
  }

  function vkRefresh(post, media) {
    const page = String((media && (media.open || media.url)) || (post && post.url) || "");
    const id = (page.match(/video(-?\d+_\d+)/) || [])[1];
    if (!id) return Promise.resolve(null);
    const pages = ["https://vk.com/video" + id, "https://m.vk.com/video" + id];
    let chain = Promise.resolve(null);
    pages.forEach((src) => {
      chain = chain.then((found) => {
        if (found && found.url) return found;
        return fetch(src, { signal: AbortSignal.timeout(5000) }).then((res) => res.ok ? res.text() : "").then((html) => {
          if (!html) return found;
          const match = html.replace(/\\\//g, "/").match(/https:\/\/[^"'\\\s]+\.mp4[^"'\\\s]*/i);
          if (!match || !playableFile(match[0]) || oePast(match[0])) return found;
          return { url: match[0] };
        }).catch(() => found);
      });
    });
    return chain;
  }

  function fileSources(post, media) {
    const out = [];
    const picked = pickMp4((media && media.variants) || []);
    [picked, media && media.url, media && media.fallback, media && media.hls].forEach((url) => {
      if (!url || !playableFile(url) || oePast(url)) return;
      pushSource(out, { kind: /\.m3u8(\?|$)/i.test(url) ? "hls" : "mp4", url: url });
    });
    [media && media.url, media && media.fallback].forEach((url) => {
      const saved = iaForUrl(url);
      if (saved && playableFile(saved)) pushSource(out, { kind: "mp4", url: saved });
      const cors = saved ? iaCorsUrl(saved) : "";
      if (cors && playableFile(cors)) pushSource(out, { kind: "mp4", url: cors });
    });
    return out;
  }

  function sourcesFor(post, media, depth) {
    const yt = youtubeId(post, media);
    if (yt) return youtubeSources(yt);
    const files = fileSources(post, media);
    if (files.length || depth) return Promise.resolve(files);
    const platform = (post && post.platform) || "";
    if (platform === "x") {
      const id = String((post && (post.statusId || post.id)) || "");
      if (!/^\d{6,}$/.test(id)) return Promise.resolve(files);
      return fxStatusPost(id).then((extra) => {
        const row = extra && (extra.media || []).find((item) => item && (item.type === "video" || item.type === "animated_gif"));
        if (!row) return files;
        return sourcesFor(post, row, 1);
      }).catch(() => files);
    }
    if (platform === "instagram" || platform === "threads") {
      return metaRefresh(post).then((fresh) => {
        if (fresh && fresh.url) pushSource(files, { kind: "mp4", url: fresh.url });
        return files;
      });
    }
    if (platform === "vk" && !files.length) {
      return vkRefresh(post, media).then((fresh) => {
        if (fresh && fresh.url) pushSource(files, { kind: /\.m3u8(\?|$)/i.test(fresh.url) ? "hls" : "mp4", url: fresh.url });
        return files;
      });
    }
    return Promise.resolve(files);
  }

  function loadHls() {
    if (window.Hls) return Promise.resolve(window.Hls);
    if (STATE.hlsP) return STATE.hlsP;
    STATE.hlsP = new Promise((resolve) => {
      const script = document.createElement("script");
      script.src = "https://cdn.jsdelivr.net/npm/hls.js@1.5.17/dist/hls.min.js";
      script.onload = () => resolve(window.Hls || null);
      script.onerror = () => resolve(null);
      document.head.appendChild(script);
    });
    return STATE.hlsP;
  }

  function clearPlayer(el) {
    if (el._stall) { clearTimeout(el._stall); el._stall = 0; }
    if (el._hls && el._hls.destroy) { try { el._hls.destroy(); } catch (err) { /* already gone */ } el._hls = null; }
    el.querySelectorAll("video, iframe").forEach((node) => node.remove());
  }

  function showVideoCard(el, post, media) {
    clearPlayer(el);
    if (el && el.dataset) delete el.dataset.want;
    el.classList.add("is-failed");
    el.classList.remove("is-playing", "is-shown");
    const mute = el.querySelector(".vmute");
    const left = el.querySelector(".vleft");
    if (mute) mute.hidden = true;
    if (left) left.hidden = true;
    if (!el.querySelector(".vposter")) {
      const src = (media && media.poster) || (media && media.url && !playableFile(media.url) ? media.url : "") || "";
      if (src) {
        const img = document.createElement("img");
        img.className = "vposter";
        img.alt = "";
        img.referrerPolicy = "no-referrer";
        img.src = src;
        el.prepend(img);
      }
    }
    const link = el.querySelector(".vfallback");
    if (link) {
      link.hidden = false;
      const href = originalOf(post, media);
      if (href) link.href = href;
    }
    const retry = el.querySelector(".vretry");
    if (retry) retry.hidden = false;
    const play = el.querySelector(".play");
    if (play) play.hidden = true;
  }

  function armStall(el, video, gen, fail) {
    if (el._stall) clearTimeout(el._stall);
    const started = video.currentTime;
    el._stall = setTimeout(() => {
      if (el._gen !== gen) return;
      if (video.currentTime > started + 0.2) return;
      fail();
    }, 5000);
    const clear = () => {
      if (video.currentTime > 0.2 && el._stall) { clearTimeout(el._stall); el._stall = 0; }
    };
    video.addEventListener("timeupdate", clear);
    video.addEventListener("playing", clear);
  }

  function playSource(el, source, post, media, opts, gen, advance) {
    if (el._gen !== gen) return;
    el._src = (el._src || 0) + 1;
    clearPlayer(el);
    if (!source) { showVideoCard(el, post, media); return; }
    if (source.kind === "iframe") {
      let url = source.url;
      if (opts.preview && /youtube-nocookie\.com\/embed\//.test(url || "")) {
        const id = (url.match(/embed\/([^?]+)/) || [])[1];
        if (id) url = embedUrl(decodeURIComponent(id), true);
      }
      const frame = document.createElement("iframe");
      frame.id = "ytf" + gen;
      if (/youtube-nocookie\.com|youtube\.com/.test(url || "")) {
        frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
        frame.referrerPolicy = "strict-origin-when-cross-origin";
      }
      frame.src = url;
      frame.title = (post && (post.title || post.text)) || "Video";
      frame.allow = "accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share";
      frame.allowFullscreen = !opts.preview;
      const nudge = () => {
        if (el._gen !== gen || !frame.contentWindow) return;
        const send = (func, args) => {
          try {
            frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: func, args: args || [], id: frame.id, channel: "widget" }), "*");
          } catch (err) { /* the embed answers with onReady */ }
        };
        try {
          frame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: frame.id, channel: "widget" }), "*");
        } catch (err) { /* cross-origin until the widget loads */ }
        send("addEventListener", ["onReady"]);
        send("addEventListener", ["onStateChange"]);
        if (opts.preview || opts.muted) {
          send("mute", []);
          send("playVideo", []);
        }
        if (!opts.preview && Number(opts.resume) > 3 && !el._ytSeeked) {
          el._ytSeeked = true;
          send("seekTo", [Number(opts.resume), true]);
        }
      };
      el._nudge = nudge;
      frame.addEventListener("load", () => {
        if (el._gen !== gen) return;
        if (!frame.src || frame.src === "about:blank") return;
        notePlay(el, "youtube-loaded");
        nudge();
        setTimeout(nudge, 250);
        setTimeout(nudge, 700);
      });
      el.appendChild(frame);
      el.classList.add("is-playing");
      el.classList.remove("is-failed");
      return;
    }
    const video = document.createElement("video");
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.setAttribute("referrerpolicy", "no-referrer");
    video.referrerPolicy = "no-referrer";
    video.controls = !opts.preview && !opts.loop;
    if (opts.muted || opts.preview) {
      video.muted = true;
      video.defaultMuted = true;
      video.setAttribute("muted", "");
    }
    if (opts.loop || (media && media.type === "animated_gif")) {
      video.loop = true;
      video.muted = true;
      video.defaultMuted = true;
      video.setAttribute("muted", "");
    }
    const poster = el.querySelector(".vposter") || el.querySelector("img");
    if (poster && poster.getAttribute("src") && !poster.classList.contains("face")) video.poster = poster.getAttribute("src");
    video.preload = opts.preview && visibleRatio(el) < 0.6 ? "metadata" : "auto";
    const token = el._src;
    const fail = () => {
      if (el._gen !== gen || el._src !== token) return;
      el._src += 1;
      advance();
    };
    video.addEventListener("error", fail);
    video.addEventListener("playing", () => {
      if (el._gen !== gen) return;
      if (video.currentTime > 0 || video.videoWidth > 0) markShown(el);
    });
    video.addEventListener("loadeddata", () => {
      if (el._gen !== gen) return;
      const img = el.querySelector(".vposter.face, .yt-thumb img.face");
      if (!img || !video.videoWidth) return;
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.min(video.videoWidth, 480);
        canvas.height = Math.max(1, Math.round(canvas.width * video.videoHeight / video.videoWidth));
        const ctx = canvas.getContext("2d");
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const sample = ctx.getImageData(0, 0, Math.min(8, canvas.width), Math.min(8, canvas.height)).data;
        let sum = 0;
        for (let i = 0; i < sample.length; i += 4) sum += sample[i] + sample[i + 1] + sample[i + 2];
        if (sum / (sample.length / 4) < 24) return;
        img.classList.remove("face");
        img.src = canvas.toDataURL("image/jpeg", 0.72);
      } catch (err) { /* a cross-origin file keeps the avatar */ }
    });
    video.addEventListener("timeupdate", () => {
      if (el._gen !== gen) return;
      if (!isFinite(video.duration) || video.duration <= 0) return;
      const label = clock(Math.max(0, Math.ceil(video.duration - video.currentTime)));
      const left = el.querySelector(".vleft");
      if (left && opts.preview) { left.hidden = false; left.textContent = label; }
      const badge = el.querySelector(".yt-time");
      if (badge && el.dataset.preview === "subs") badge.textContent = label;
      if (!opts.loop && !(media && media.type === "animated_gif") && video.currentTime >= 3) {
        const dur = isFinite(video.duration) ? video.duration : 0;
        noteVideo(post, { position: video.currentTime, duration: dur, progress: dur > 0 ? video.currentTime / dur : 0, touch: false });
      }
    });
    el.appendChild(video);
    el.classList.add("is-playing");
    video.addEventListener("play", () => {
      if (!navigator.mediaSession || video.muted) return;
      const poster = video.poster || "";
      const artwork = [{ src: new URL("icons/icon-512.png", location.href).href, sizes: "512x512", type: "image/png" }];
      if (poster) artwork.unshift({ src: poster, sizes: "1280x720", type: "image/jpeg" });
      try {
        navigator.mediaSession.metadata = new MediaMetadata({
          title: (post && (post.title || String(post.text || "").slice(0, 80))) || "Video",
          artist: (post && (post.author || post.handle)) || "SuperintelApp",
          artwork: artwork
        });
        navigator.mediaSession.setActionHandler("play", () => { video.play(); });
        navigator.mediaSession.setActionHandler("pause", () => { video.pause(); });
      } catch (err) { /* media session is optional */ }
    });
    const start = () => {
      if (opts.muted || opts.preview || opts.loop || (media && media.type === "animated_gif")) {
        video.muted = true;
        video.defaultMuted = true;
        video.setAttribute("muted", "");
      }
      video.playsInline = true;
      video.setAttribute("playsinline", "");
      video.setAttribute("webkit-playsinline", "");
      const at = Number(opts.resume) || 0;
      opts.resume = 0;
      if (at > 0.3) {
        const seek = () => { if (el._gen === gen) { try { video.currentTime = at; } catch (err) { /* not seekable yet */ } } };
        if (video.readyState >= 1) seek();
        else video.addEventListener("loadedmetadata", seek, { once: true });
      }
      armStall(el, video, gen, fail);
      const played = video.play();
      notePlay(el, "play-called");
      if (played && played.then) {
        played.then(() => notePlay(el, "play-started")).catch((err) => {
          const name = err && err.name ? err.name : "play-error";
          notePlay(el, "play-rejected:" + name);
          if (name !== "NotAllowedError") { fail(); return; }
          video.muted = true;
          video.defaultMuted = true;
          video.setAttribute("muted", "");
          video.setAttribute("playsinline", "");
          video.playsInline = true;
          const again = video.play();
          if (again && again.then) {
            again.then(() => notePlay(el, "play-started")).catch((err2) => {
              const low = /iPhone|iPad|iPod/i.test(navigator.userAgent) ? ":low-power-or-gesture" : "";
              notePlay(el, "play-blocked:" + ((err2 && err2.name) || "NotAllowedError") + low);
            });
          }
        });
      }
    };
    if (source.kind === "hls") {
      const native = video.canPlayType("application/vnd.apple.mpegurl");
      if (native) { video.src = source.url; start(); return; }
      loadHls().then((Hls) => {
        if (el._gen !== gen || el._src !== token) return;
        if (!Hls || !Hls.isSupported) { fail(); return; }
        const hls = new Hls();
        el._hls = hls;
        const wait = setTimeout(() => fail(), 5000);
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data && data.fatal) { clearTimeout(wait); fail(); }
        });
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (el._gen !== gen || el._src !== token) return;
          clearTimeout(wait);
          start();
        });
        hls.loadSource(source.url);
        hls.attachMedia(video);
      });
      return;
    }
    video.referrerPolicy = "no-referrer";
    video.src = source.url;
    start();
  }

  function stopWatchPlayback() {
    STATE.playing = null;
    document.querySelectorAll(".vplay").forEach((el) => {
      el._gen = (el._gen || 0) + 1;
      if (el._stall) { clearTimeout(el._stall); el._stall = 0; }
      if (el._hls && el._hls.destroy) { try { el._hls.destroy(); } catch (err) { /* already gone */ } el._hls = null; }
      el.classList.remove("is-playing", "is-shown");
    });
    document.querySelectorAll("video").forEach((video) => {
      try {
        video.pause();
        video.removeAttribute("src");
        video.load();
      } catch (err) { /* the element is going away */ }
    });
    document.querySelectorAll("iframe").forEach((frame) => {
      try { frame.src = "about:blank"; } catch (err) { /* the embed is going away */ }
    });
    if (document.pictureInPictureElement && document.exitPictureInPicture) {
      document.exitPictureInPicture().catch(() => {});
    }
    if (navigator.mediaSession) {
      try { navigator.mediaSession.playbackState = "paused"; } catch (err) { /* optional */ }
    }
  }

  function rememberPlayback() {
    if (STATE.handoff) { STATE.handoff = false; return; }
    const el = document.querySelector(".player.vplay.is-playing") || document.querySelector(".player.vplay[data-want='1']");
    if (!el) { STATE.playing = null; }
    else {
      const video = el.querySelector("video");
      STATE.playing = {
        pid: el.dataset.pid || "",
        mi: el.dataset.mi || "0",
        time: video ? video.currentTime : 0,
        muted: !!(video && video.muted),
        src: video ? (video.currentSrc || video.src || "") : "",
        iframe: !!el.querySelector("iframe")
      };
    }
    document.querySelectorAll(".vplay").forEach((node) => { node._gen = (node._gen || 0) + 1; });
  }

  function resumePlayback() {
    const saved = STATE.playing;
    STATE.playing = null;
    if (!saved) return;
    let el = null;
    document.querySelectorAll(".vplay").forEach((node) => {
      if (!el && node.dataset.pid === saved.pid && String(node.dataset.mi || "0") === String(saved.mi)) el = node;
    });
    if (!el) return;
    if (saved.iframe) {
      startPlayback(el, { muted: saved.muted, iframe: true });
      return;
    }
    if (saved.src) {
      const post = playPost(el) || {};
      const media = playMedia(el, post) || {};
      el.dataset.want = "1";
      const gen = (el._gen || 0) + 1;
      el._gen = gen;
      const kind = /\.m3u8(\?|$)/i.test(saved.src) ? "hls" : "mp4";
      playSource(el, { kind: kind, url: saved.src }, post, media, { muted: saved.muted, resume: saved.time }, gen, () => {
        delete el.dataset.want;
        startPlayback(el, { muted: saved.muted });
      });
      return;
    }
    startPlayback(el, { muted: saved.muted, resume: saved.time });
  }

  function startPlayback(el, opts) {
    if (!el) return;
    opts = opts || {};
    const previewing = !!(opts.preview || (el.dataset && el.dataset.preview && !el.classList.contains("player")));
    if (previewing) {
      opts.preview = true;
      const early = playMedia(el, playPost(el) || {}) || {};
      const gif = !!(opts.loop || early.type === "animated_gif");
      opts.loop = gif;
      opts.muted = gif || el.dataset.preview === "subs" || !STATE.sound;
    }
    if (el.classList.contains("is-playing")) {
      const video = el.querySelector("video");
      if (video) {
        video.muted = previewing ? !!opts.muted : (!!opts.muted || (video.muted && !!opts.muted));
        if (!previewing && !opts.muted) video.muted = false;
        if (opts.resume > 0.3) { try { video.currentTime = opts.resume; } catch (err) { /* ignore */ } }
      }
      return;
    }
    const post = playPost(el) || {};
    const media = playMedia(el, post) || {};
    if (!previewing && !(Number(opts.resume) > 0.3) && post.id) {
      const saved = histFind("videos", post.id);
      const pos = saved ? Number(saved.position) || 0 : 0;
      const dur = saved ? Number(saved.duration) || 0 : 0;
      if (pos > 3 && !(dur > 8 && pos > dur - 8)) opts.resume = pos;
    }
    const yt = youtubeId(post, media);
    el.dataset.want = "1";
    const gen = (el._gen || 0) + 1;
    el._gen = gen;
    const giveUp = () => recoverPreview(el, post, media, opts, gen);
    if (previewing && yt) {
      notePlay(el, "youtube-embed");
      const fileOf = (list) => (list || []).find((row) => row && row.kind !== "iframe" && row.url);
      const useFile = (file) => {
        playSource(el, file, post, media, opts, gen, () => {
          if (el._gen !== gen) return;
          playSource(el, { kind: "iframe", url: embedUrl(yt, true) }, post, media, opts, gen, giveUp);
        });
      };
      playSource(el, { kind: "iframe", url: embedUrl(yt, true) }, post, media, opts, gen, giveUp);
      sourcesFor(post, media, 0).then((list) => {
        if (el._gen === gen) el._sources = list;
      }).catch(() => {});
      setTimeout(() => {
        if (el._gen !== gen || el.classList.contains("is-shown")) return;
        const file = fileOf(el._sources);
        if (file) useFile(file);
      }, 1200);
      return;
    }
    if (opts.iframe && yt) {
      playSource(el, { kind: "iframe", url: embedUrl(yt, previewing) }, post, media, opts, gen, giveUp);
      return;
    }
    let jumped = false;
    const deadline = setTimeout(() => {
      if (!yt || el._gen !== gen || jumped) return;
      const video = el.querySelector("video");
      if (video && video.currentTime > 0.2) return;
      if (el.querySelector("iframe")) return;
      jumped = true;
      el._src = (el._src || 0) + 1;
      playSource(el, { kind: "iframe", url: embedUrl(yt, previewing) }, post, media, opts, gen, giveUp);
    }, 8000);
    el.classList.remove("is-failed");
    const link = el.querySelector(".vfallback");
    if (link) link.hidden = true;
    const retry = el.querySelector(".vretry");
    if (retry) retry.hidden = true;
    const known = el._sources && el._sources.length ? Promise.resolve(el._sources) : sourcesFor(post, media, 0);
    known.then((list) => {
      if (el._gen !== gen || jumped) { clearTimeout(deadline); return; }
      el._sources = list;
      let index = 0;
      const advance = () => {
        if (el._gen !== gen) return;
        index += 1;
        if (index >= list.length) { giveUp(); return; }
        playSource(el, list[index], post, media, opts, gen, advance);
      };
      if (!list.length) { giveUp(); return; }
      playSource(el, list[0], post, media, opts, gen, advance);
    }).catch(() => { if (el._gen === gen) giveUp(); });
  }

  function xRefresh(post) {
    const id = String((post && (post.statusId || post.id)) || "");
    if (!/^\d{6,}$/.test(id)) return Promise.resolve(null);
    return fxStatusPost(id).then((extra) => {
      const row = extra && (extra.media || []).find((item) => item && (item.type === "video" || item.type === "animated_gif"));
      const url = row && (pickMp4(row.variants || []) || row.url);
      if (!url || !playableFile(url) || oePast(url)) return null;
      return { url: url };
    }).catch(() => null);
  }

  function recoverPreview(el, post, media, opts, gen) {
    const platform = (post && post.platform) || "";
    const can = platform === "vk" || platform === "instagram" || platform === "threads" || platform === "x";
    if (!can || el._recovered) { notePlay(el, "no-source"); showVideoCard(el, post, media); return; }
    el._recovered = 1;
    el._sources = [];
    notePlay(el, "refresh-" + platform);
    const job = platform === "vk" ? vkRefresh(post, media) : platform === "x" ? xRefresh(post) : metaRefresh(post);
    job.then((fresh) => {
      if (el._gen !== gen) return;
      if (!fresh || !fresh.url || !playableFile(fresh.url) || oePast(fresh.url)) { showVideoCard(el, post, media); return; }
      const kind = /\.m3u8(\?|$)/i.test(fresh.url) ? "hls" : "mp4";
      playSource(el, { kind: kind, url: fresh.url }, post, media, opts, gen, () => showVideoCard(el, post, media));
    }).catch(() => { if (el._gen === gen) showVideoCard(el, post, media); });
  }

  function stopPlayback(el) {
    if (!el) return;
    el._gen = (el._gen || 0) + 1;
    if (el.dataset) delete el.dataset.want;
    clearPlayer(el);
    el.classList.remove("is-playing", "is-shown");
    const play = el.querySelector(".play");
    if (play && !el.classList.contains("is-failed")) play.hidden = false;
    const mute = el.querySelector(".vmute");
    const left = el.querySelector(".vleft");
    if (mute) mute.hidden = true;
    if (left) left.hidden = true;
  }

  function connectionInfo() {
    const conn = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
    return {
      type: conn && typeof conn.type === "string" ? conn.type : "",
      saveData: !!(conn && conn.saveData),
      effectiveType: conn && conn.effectiveType ? String(conn.effectiveType) : ""
    };
  }

  function autoplayBlockReason() {
    const mode = (STATE.settings && STATE.settings.autoplay) || "all";
    const chosen = mode === "wifi" || mode === "never" ? mode : "all";
    if (chosen === "never") return "setting-never";
    if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return "reduced-motion";
    const conn = connectionInfo();
    // An unknown navigator.connection and saveData are not Never.
    // Wi-Fi only pauses when the browser actually reports a cellular type.
    if (chosen === "wifi" && conn.type === "cellular") return "cellular";
    return "";
  }

  function autoplayAllowed() {
    return !autoplayBlockReason();
  }

  function scrollBounds() {
    const root = previewScrollRoot();
    if (root && root.getBoundingClientRect) {
      const rect = root.getBoundingClientRect();
      return { top: rect.top, left: rect.left, bottom: rect.bottom, right: rect.right, height: rect.height || 0, width: rect.width || 0 };
    }
    return { top: 0, left: 0, bottom: window.innerHeight || 0, right: window.innerWidth || 0, height: window.innerHeight || 0, width: window.innerWidth || 0 };
  }

  function visibleMetrics(el) {
    if (!el || !el.getBoundingClientRect) return { ratio: 0, cover: 0 };
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { ratio: 0, cover: 0 };
    const view = scrollBounds();
    const top = Math.max(rect.top, view.top);
    const bottom = Math.min(rect.bottom, view.bottom);
    const left = Math.max(rect.left, view.left);
    const right = Math.min(rect.right, view.right);
    const w = Math.max(0, right - left);
    const h = Math.max(0, bottom - top);
    return {
      ratio: (w * h) / (rect.width * rect.height),
      cover: view.height > 0 ? h / view.height : 0
    };
  }

  function visibleRatio(el) {
    return visibleMetrics(el).ratio;
  }

  function previewEligible(el) {
    const metrics = visibleMetrics(el);
    return metrics.ratio >= 0.6 || metrics.cover >= 0.6;
  }

  function autoplayDebugOn() {
    const blob = String(location.search || "") + "&" + String(location.hash || "");
    if (/[?&]debug=autoplay\b/.test(blob)) return true;
    try { return parseRoute().name === "sources"; } catch (err) { return false; }
  }

  function notePlay(el, reason) {
    const id = el && el.dataset ? (el.dataset.pid || "") : "";
    STATE.playLog = STATE.playLog || [];
    const last = STATE.playLog[STATE.playLog.length - 1];
    if (last && last.reason === reason && last.id === id) return;
    STATE.playLog.push({ t: Date.now(), id: id, reason: reason || "" });
    if (STATE.playLog.length > 40) STATE.playLog.shift();
    if (el && el.dataset && reason) el.dataset.why = reason;
    if (autoplayDebugOn()) paintAutoplayDebug();
  }

  function paintAutoplayDebug() {
    if (!autoplayDebugOn()) {
      const old = document.getElementById("autoplay-debug");
      if (old) old.remove();
      return;
    }
    let box = document.getElementById("autoplay-debug");
    if (!box) {
      box = document.createElement("aside");
      box.id = "autoplay-debug";
      box.setAttribute("aria-label", "Autoplay debug");
      document.body.appendChild(box);
    }
    const conn = connectionInfo();
    const lines = [];
    lines.push("autoplay " + ((STATE.settings && STATE.settings.autoplay) || "all") + " block=" + (autoplayBlockReason() || "no"));
    lines.push("connection type=" + (conn.type || "unknown") + " saveData=" + conn.saveData + " effective=" + (conn.effectiveType || "unknown"));
    lines.push("reduced=" + !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches));
    lines.push("sw=" + ((navigator.serviceWorker && navigator.serviceWorker.controller && navigator.serviceWorker.controller.scriptURL) || "none"));
    lines.push("chosen " + ((STATE.autoEl && STATE.autoEl.dataset && STATE.autoEl.dataset.pid) || "none"));
    document.querySelectorAll(".vplay[data-preview]").forEach((el) => {
      const metrics = visibleMetrics(el);
      if (metrics.ratio < 0.05 && metrics.cover < 0.05 && el !== STATE.autoEl) return;
      const video = el.querySelector("video");
      const frame = el.querySelector("iframe");
      const time = video ? video.currentTime.toFixed(1) : frame ? "iframe" : "-";
      const paused = video ? String(video.paused) : frame ? (el.classList.contains("is-shown") ? "playing" : "under-poster") : "-";
      lines.push((el.dataset.pid || "?") + " r=" + metrics.ratio.toFixed(2) + " c=" + metrics.cover.toFixed(2) + " t=" + time + " " + paused + " " + (el.dataset.why || ""));
    });
    (STATE.playLog || []).slice(-6).forEach((row) => lines.push(row.reason + " " + row.id));
    box.textContent = lines.join("\n");
  }

  function previewScrollRoot() {
    const sample = document.querySelector(".vplay[data-preview]");
    let node = sample && sample.parentElement;
    while (node && node !== document.body && node !== document.documentElement) {
      const style = getComputedStyle(node);
      if ((style.overflowY === "auto" || style.overflowY === "scroll") && node.scrollHeight > node.clientHeight + 24) return node;
      node = node.parentElement;
    }
    return null;
  }

  function bindPreviewScroll() {
    if (STATE.previewScrollBound) return;
    STATE.previewScrollBound = true;
    const onScroll = () => schedulePreview();
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    if (window.visualViewport) {
      window.visualViewport.addEventListener("scroll", onScroll, { passive: true });
      window.visualViewport.addEventListener("resize", onScroll, { passive: true });
    }
  }

  function subsDesktop() {
    return (window.innerWidth || 0) >= 1000 && !!(window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches);
  }

  function paintMute(btn) {
    if (!btn) return;
    const on = !!STATE.sound;
    btn.innerHTML = icon(on ? "vol" : "volOff");
    btn.setAttribute("aria-label", on ? "Mute" : "Unmute");
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }

  function markShown(el) {
    if (!el) return;
    el.classList.add("is-playing", "is-shown");
    if (el.dataset.preview !== "feed" || el.querySelector(".gif-badge")) return;
    const btn = el.querySelector(".vmute");
    if (btn) { btn.hidden = false; paintMute(btn); }
  }

  function applyPreviewSound(el) {
    if (!el) return;
    const video = el.querySelector("video");
    const gif = !!el.querySelector(".gif-badge");
    const subs = el.dataset.preview === "subs";
    if (video) video.muted = gif || subs || !STATE.sound;
    const btn = el.querySelector(".vmute");
    if (btn && !btn.hidden) paintMute(btn);
  }

  function pausePreview(el) {
    if (!el) return;
    el._gen = (el._gen || 0) + 1;
    if (el.dataset) delete el.dataset.want;
    const video = el.querySelector("video");
    if (video) {
      try { video.pause(); } catch (err) { /* already paused */ }
      video.preload = "none";
    }
    el.querySelectorAll("iframe").forEach((frame) => {
      try { frame.src = "about:blank"; } catch (err) { /* the embed is going away */ }
      frame.remove();
    });
    el.classList.remove("is-shown", "is-playing");
    const mute = el.querySelector(".vmute");
    const left = el.querySelector(".vleft");
    if (mute) mute.hidden = true;
    if (left) left.hidden = true;
    const badge = el.querySelector(".yt-time");
    if (badge && badge.dataset.full) badge.textContent = badge.dataset.full;
  }

  function resumePreview(el) {
    const video = el.querySelector("video");
    if (!video || video.error || !(video.currentSrc || video.src)) return false;
    const gif = !!el.querySelector(".gif-badge");
    const subs = el.dataset.preview === "subs";
    video.muted = gif || subs || !STATE.sound;
    if (video.muted) {
      video.defaultMuted = true;
      video.setAttribute("muted", "");
    }
    video.loop = gif;
    video.playsInline = true;
    video.setAttribute("playsinline", "");
    video.setAttribute("webkit-playsinline", "");
    video.controls = false;
    video.preload = "auto";
    el.dataset.want = "1";
    const pending = video.play();
    if (pending && pending.then) {
      pending.then(() => { if (!video.paused) { markShown(el); notePlay(el, "play-started"); } }).catch((err) => {
        const name = err && err.name ? err.name : "play-error";
        notePlay(el, name === "NotAllowedError" ? "play-blocked:" + name : "play-rejected:" + name);
        if (name === "NotAllowedError") return;
        delete el.dataset.want;
      });
    }
    return true;
  }

  function prefetchPreview(el) {
    if (!el || el._prefetch || el.classList.contains("is-failed") || el.classList.contains("player")) return;
    el._prefetch = 1;
    const post = playPost(el) || {};
    const media = playMedia(el, post) || {};
    sourcesFor(post, media, 0).then((list) => { el._sources = list || []; }).catch(() => {});
  }

  function choosePreview() {
    const blocked = autoplayBlockReason();
    if (blocked) { notePlay(null, blocked); return null; }
    if (STATE.viewer && STATE.viewer.video) return null;
    const subs = document.querySelector(".vplay[data-preview='subs']");
    const nodes = subs
      ? document.querySelectorAll(".vplay[data-preview='subs']")
      : document.querySelectorAll(".vplay[data-preview='feed']");
    if (subs && subsDesktop() && STATE.subsHover && document.body.contains(STATE.subsHover) && previewEligible(STATE.subsHover)) return STATE.subsHover;
    let best = null;
    let bestScore = 0;
    nodes.forEach((el) => {
      if (el.classList.contains("is-failed") || el.classList.contains("player")) return;
      const metrics = visibleMetrics(el);
      if (metrics.ratio < 0.6 && metrics.cover < 0.6) return;
      const score = Math.max(metrics.ratio, metrics.cover);
      if (score > bestScore) { best = el; bestScore = score; }
    });
    return best;
  }

  let previewQueued = false;
  function schedulePreview() {
    if (previewQueued) return;
    previewQueued = true;
    const tick = window.requestAnimationFrame || function (fn) { return setTimeout(fn, 16); };
    tick(() => {
      previewQueued = false;
      syncPreview();
    });
  }

  function syncPreview() {
    if (!autoplayAllowed() || (STATE.viewer && STATE.viewer.video)) {
      if (STATE.autoEl) pausePreview(STATE.autoEl);
      STATE.autoEl = null;
      paintAutoplayDebug();
      return;
    }
    const next = choosePreview();
    if (STATE.autoEl && STATE.autoEl !== next) pausePreview(STATE.autoEl);
    if (!next) { STATE.autoEl = null; paintAutoplayDebug(); return; }
    STATE.autoEl = next;
    if (next.dataset.want === "1" || (next.classList.contains("is-playing") && (next.querySelector("video") || next.querySelector("iframe:not([src='about:blank'])")))) {
      applyPreviewSound(next);
      const frame = next.querySelector("iframe");
      if (frame && !next.classList.contains("is-shown") && next._nudge) next._nudge();
      const current = next.querySelector("video");
      if (current && current.paused && !current.error) resumePreview(next);
      paintAutoplayDebug();
      return;
    }
    const video = next.querySelector("video");
    if (video && !video.error && (video.currentSrc || video.src)) {
      resumePreview(next);
      return;
    }
    const post = playPost(next) || {};
    const media = playMedia(next, post) || {};
    const gif = !!(media && media.type === "animated_gif");
    startPlayback(next, { preview: true, loop: gif, muted: gif || next.dataset.preview === "subs" || !STATE.sound });
    paintAutoplayDebug();
  }

  function bindPlayers() {
    if (STATE.videoObserver) STATE.videoObserver.disconnect();
    STATE.autoEl = null;
    if (!("IntersectionObserver" in window)) { schedulePreview(); return; }
    bindPreviewScroll();
    STATE.videoObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) prefetchPreview(entry.target);
      });
      schedulePreview();
    }, { root: previewScrollRoot(), rootMargin: "200px 0px", threshold: [0, 0.6, 1] });
    document.querySelectorAll(".vplay[data-preview]").forEach((el) => STATE.videoObserver.observe(el));
    schedulePreview();
  }

  function openFullVideo(tile) {
    const post = playPost(tile);
    if (!post) return;
    const media = playMedia(tile, post) || {};
    const video = tile.querySelector("video");
    const time = video && isFinite(video.currentTime) ? video.currentTime : 0;
    const src = video ? (video.currentSrc || video.src || "") : "";
    const yt = youtubeId(post, media);
    noteVideo(post, { position: time, touch: true });
    if (yt || post.watch || (post.platform === "youtube" && post.kind !== "community")) {
      STATE.handoff = true;
      STATE.playing = {
        pid: tile.dataset.pid || post.id || "",
        mi: tile.dataset.mi || "0",
        time: time,
        muted: false,
        src: src && src.indexOf("youtube-nocookie") < 0 && src.indexOf("about:blank") < 0 ? src : "",
        iframe: false
      };
      pausePreview(tile);
      goHash(watchHash(post));
      return;
    }
    openVideoViewer(post, media, src, time);
  }

  function followButton(id, large) {
    const on = isFollowed(id);
    return `<button class="follow${on ? " following" : ""}${large ? " lg" : ""}" data-act="follow" data-id="${esc(id)}" aria-pressed="${on ? "true" : "false"}"><span class="f">Following</span><span class="u">Unfollow</span>${on ? "" : "Follow"}</button>`.replace(
      on ? "" : `<span class="f">Following</span><span class="u">Unfollow</span>`,
      ""
    );
  }

  function followButtonClean(id, large) {
    const ids = window.FeedsPeople && window.FeedsPeople.followIds ? window.FeedsPeople.followIds(id) : [id];
    const primary = ids[0] || id;
    const attr = ` data-id="${esc(primary)}" data-ids="${esc(ids.join(","))}"`;
    if (ids.some((item) => isFollowed(item))) {
      return `<button class="follow following${large ? " lg" : ""}" data-act="follow"${attr}><span class="f">Following</span><span class="u">Unfollow</span></button>`;
    }
    if (!ids.some((item) => configuredFeed(item))) {
      return `<a class="follow${large ? " lg" : ""}" data-act="follow-request" data-id="${esc(primary)}" target="_blank" rel="noopener noreferrer" href="${esc(followIssueUrlForId("follow", primary))}">Follow</a>`;
    }
    return `<button class="follow${large ? " lg" : ""}" data-act="follow"${attr}>Follow</button>`;
  }

  function bellGlyph(kind) {
    if (kind === "plus") {
      return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.1 8.35c-.26-2.05-1.95-3.6-4-3.6s-3.74 1.55-4 3.6l-.72 5.25h2.05c.26 1.1 1.2 1.9 2.57 1.9s2.31-.8 2.57-1.9h2.05l-.72-5.25zM12.1 14.2c-.64 0-1.18-.4-1.4-1h2.8c-.22.6-.76 1-1.4 1zM8.55 12.4l.5-3.4c.22-1.15 1.25-2 2.55-2s2.33.85 2.55 2l.5 3.4H8.55z"/><path d="M17.15 14.6h-1.45v1.45H14.25v1.45h1.45V19h1.45v-1.5h1.45v-1.45h-1.45z"/></svg>`;
    }
    if (kind === "off") return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${PATH.bell}"/><path d="M4.1 3.05 2.95 4.2 19.8 21.05l1.15-1.15z"/></svg>`;
    if (kind === "on") return icon("bellOn");
    if (kind === "video") return icon("video");
    return icon("bell");
  }

  function accountFollowed(id) {
    const ids = window.FeedsPeople && window.FeedsPeople.followIds ? window.FeedsPeople.followIds(id) : [id];
    return (ids.length ? ids : [id]).some((item) => isFollowed(item));
  }

  function bellRecord(id) {
    const bells = (STATE.settings && STATE.settings.bells) || {};
    if (bells[id]) return bells[id];
    const wanted = window.FeedsPeople && window.FeedsPeople.followIds ? window.FeedsPeople.followIds(id) : [id];
    const keys = Object.keys(bells);
    for (let i = 0; i < keys.length; i++) {
      const row = bells[keys[i]];
      if (!row) continue;
      if (keys[i] === id) return row;
      if ((row.ids || []).some((item) => item === id || wanted.indexOf(item) >= 0)) return row;
    }
    return null;
  }

  function bellOn(id) {
    const row = bellRecord(id);
    return !!(row && (row.mode === "all" || row.mode === "live"));
  }

  function bellButton(id, handle) {
    if (!accountFollowed(id)) return "";
    const on = bellOn(id);
    const open = !!(STATE.bellMenu && STATE.bellMenu.id === id);
    return `<button class="notify-bell${on ? " on" : ""}" type="button" data-act="bell" data-id="${esc(id)}" data-handle="${esc(String(handle || "").replace(/^@/, ""))}" title="Notify" aria-label="Notify" aria-haspopup="menu" aria-expanded="${open ? "true" : "false"}"><span class="bell-off">${bellGlyph("off-outline")}</span><span class="bell-add">${bellGlyph("plus")}</span><span class="bell-on">${bellGlyph("on")}</span></button>`;
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
    const asQuoted = asPost(quoted, platform);
    const art = articleOf(asQuoted);
    const href = art ? articleHash(asQuoted) : (quoted.url && !quoted.handle ? quoted.url : (quoted.handle ? statusHash(asQuoted) : (quoted.url || "#")));
    const external = !art && href.startsWith("http");
    const open = external ? ` data-href="${esc(href)}"` : ` data-open="${esc(href)}"`;
    const key = "q:" + (quoted.statusId || quoted.id || "x");
    const shown = displayPost(asQuoted);
    return `<div class="quote"${open}>
      <div class="quote-head">
        ${avatar(quoted.avatar, quoted.author || quoted.handle)}
        <span class="name">${esc(quoted.author || quoted.handle || "Post")}${badge(quoted.verifiedType)}</span>
        ${quoted.handle ? `<span class="handle">@${esc(quoted.handle)}</span>` : ""}
        ${quoted.date ? `<span class="dot">·</span><span class="time">${esc(relTime(quoted.date))}</span>` : ""}
      </div>
      ${shown.text ? textBlock(shown, key, false, "quote-text") : ""}
      ${articleCardHtml(asQuoted)}
      ${mediaHtml(quoted.media, false, quoted)}
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
    if (!post || post.kind !== "reply") return true;
    return !isSelfReply(post);
  }

  function muteKey(item) {
    return String(item || "").replace(/^@/, "").trim().toLowerCase();
  }

  function matchesMute(list, handle, platform, feedId) {
    const handleKey = String(handle || "").replace(/^@/, "").toLowerCase();
    const id = String(feedId || "").toLowerCase();
    const prefixed = (platform || "x") + ":" + handleKey;
    return (list || []).some((item) => {
      const key = muteKey(item);
      return !!key && (key === handleKey || key === id || key === prefixed);
    });
  }

  function wordMuted(text) {
    const sample = String(text || "");
    return ((STATE.settings && STATE.settings.mutedWords) || []).some((word) => {
      const raw = String(word || "").trim();
      if (!raw) return false;
      if (/^[a-z0-9]+$/i.test(raw)) {
        const escaped = raw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        return new RegExp("(?:^|[^a-z0-9])" + escaped + "(?:[^a-z0-9]|$)", "i").test(sample);
      }
      return sample.toLowerCase().indexOf(raw.toLowerCase()) >= 0;
    });
  }

  function repostsOff(post) {
    if (!post || !post.repostedBy) return false;
    const by = post.repostedBy;
    return matchesMute((STATE.settings && STATE.settings.repostOff) || [], by.handle, by.platform || post.platform || "x", by.feedId || post.feedId);
  }

  function bridgeErrorPost(post) {
    if (!post) return false;
    const quoted = post.quoted || {};
    const blob = [post.text, post.title, post.description, quoted.text].join("\n");
    const folded = blob.toLowerCase();
    if (folded.indexOf("bridge returned error") >= 0) return true;
    if (folded.indexOf("httpexception") >= 0) return true;
    if (folded.indexOf("lib/http.php") >= 0) return true;
    if (folded.indexOf("looks like something went wrong") >= 0) return true;
    const guid = String(post.statusId || post.id || "");
    const link = String(post.url || "");
    if (/developer\.mozilla\.org\/\S*status\/\d+/i.test(guid) || /developer\.mozilla\.org\/\S*status\/\d+/i.test(link)) return true;
    if (/^https?:\/\/docs\.rsshub\.app\/?$/i.test(guid) || /^https?:\/\/docs\.rsshub\.app\/?$/i.test(link)) return true;
    const bridgeUrl = (value) => /[?&]action=display\b/i.test(value) && /[?&]bridge=/i.test(value);
    if (bridgeUrl(guid) || bridgeUrl(link)) return true;
    if (!link && /^urn:sha1:[0-9a-f]{40}$/i.test(guid)) return true;
    return false;
  }

  function hiddenPost(post) {
    if (!post) return false;
    if (matchesMute((STATE.settings && STATE.settings.mutedAccounts) || [], post.handle, post.platform, post.feedId)) return true;
    if (wordMuted(post.text)) return true;
    return repostsOff(post);
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
  const SUB_COUNTS = {};
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

  function relativeLabel(text) {
    const label = String(text || "").trim().toLowerCase();
    if (!label) return false;
    if (label === "just now" || label === "now" || label === "yesterday") return true;
    return /(?:(?:streamed|premiered)\s+)?(?:\d+\s+(?:second|minute|hour|day|week|month|year)s?|\d+\s*[smhdwy])\s+ago\b/i.test(label);
  }

  function timeMs(value) {
    const n = Date.parse(value || "");
    return isFinite(n) && n > Date.parse("2005-01-01T00:00:00Z") ? n : 0;
  }

  function earlierIso(left, right) {
    const a = timeMs(left);
    const b = timeMs(right);
    if (a && b) return a <= b ? left : right;
    if (a) return left || "";
    if (b) return right || "";
    return "";
  }

  function ivPublish(item) {
    if (!item) return "";
    const label = item.publishedText || "";
    if (relativeLabel(label)) return "";
    const iso = ivIso(item.published);
    if (!label && iso && Math.abs(Date.now() - timeMs(iso)) < 120000) return "";
    return iso;
  }

  function upgradeAvatar(url) {
    if (!url) return "";
    return String(url).replace("_normal.", "_400x400.").replace("_bigger.", "_400x400.").replace("_mini.", "_400x400.");
  }

  function playableFile(url) {
    const raw = String(url || "");
    if (/instagram\.com\/[^?\s]+\/media/i.test(raw)) return false;
    return /\.(mp4|webm|mov|m3u8)(\?|$)/i.test(raw.split("?")[0]);
  }

  function oePast(url) {
    const match = String(url || "").match(/[?&]oe=([0-9A-Fa-f]{6,})/);
    if (!match) return false;
    const sec = parseInt(match[1], 16);
    return isFinite(sec) && sec * 1000 < Date.now();
  }

  function videoFields(variants) {
    const files = [];
    let hls = "";
    (variants || []).forEach((variant) => {
      if (!variant || typeof variant !== "object") return;
      const url = variant.url || "";
      if (!url) return;
      const path = url.split("?")[0].toLowerCase();
      if (path.indexOf(".m3u8") >= 0) { if (!hls) hls = url; return; }
      const ctype = String(variant.content_type || variant.type || variant.container || "").toLowerCase();
      if (ctype.indexOf("mp4") < 0 && path.indexOf(".mp4") < 0) return;
      let rate = Number(variant.bitrate || variant.bit_rate || 0);
      if (!isFinite(rate)) rate = 0;
      files.push({ url: url, bitrate: rate });
    });
    return { variants: files, hls: hls };
  }

  function pickMp4(variants) {
    const files = (variants || []).filter((row) => row && playableFile(row.url) && !oePast(row.url));
    if (!files.length) return "";
    const narrow = (window.innerWidth || 390) < 700;
    const target = narrow ? 900000 : 2500000;
    let best = files[0];
    let score = Infinity;
    files.forEach((file) => {
      const rate = file.bitrate || (narrow ? 500000 : 2000000);
      const dist = Math.abs(rate - target);
      if (dist < score) { score = dist; best = file; }
    });
    return best.url;
  }

  function bestMp4(variants) {
    return pickMp4(videoFields(variants).variants) || "";
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
      const extra = videoFields(item.variants || item.formats || item.video_files || []);
      const mp4 = pickMp4(extra.variants);
      const poster = item.thumbnail_url || item.poster || item.preview_image_url || "";
      let url = item.url || "";
      if (kind === "video" || kind === "animated_gif") url = mp4 || (playableFile(url) && !oePast(url) ? url : "") || extra.hls || "";
      else url = url || poster;
      if (!url && !poster) return;
      const row = { type: kind, url: url, poster: poster || (kind === "photo" ? url : ""), width: item.width || null, height: item.height || null, alt: item.alt || item.alt_text || "" };
      if (extra.variants.length) row.variants = extra.variants;
      if (extra.hls) row.hls = extra.hls;
      out.push(row);
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
    const article = articleFromStatus(wrapped);
    if (article) post.article = article;
    if (conv) post.conversationId = conv;
    const parentStatus = (wrapped.replying_to && (wrapped.replying_to.status || wrapped.replying_to.status_id)) || wrapped.replying_to_status || wrapped.in_reply_to_status_id;
    if (replying && parentStatus) post.replyingTo = Object.assign({}, replying, { id: String(parentStatus) });
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
    ["text", "handle", "author", "date", "avatar", "url", "verifiedType", "authorJoined", "authorFollowers", "conversationId", "article"].forEach((key) => {
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
    if ((post.platform || "") === "telegram") {
      const bucket = { loading: false, replies: [], missing: !post.discussion, cap: want, fetchedAt: Date.now(), settled: true };
      STATE.replies[id] = bucket;
      return bucket;
    }
    if ((post.platform || "") === "discord") {
      const stamp = (reply) => {
        if (!reply || typeof reply !== "object") return reply;
        if (!reply.platform) reply.platform = "discord";
        if (!reply.guildId && post.guildId) reply.guildId = post.guildId;
        if (!reply.channelId && post.channelId) reply.channelId = post.channelId;
        if (!reply.channelName && post.channelName) reply.channelName = post.channelName;
        return reply;
      };
      return { loading: false, replies: (Array.isArray(post.replies) ? post.replies : []).map(stamp), missing: false, cap: want, fetchedAt: Date.now(), settled: true };
    }
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
      STATE.replies[id] = { loading: false, replies: replies || [], missing: !!missing, cap: cap || want, fetchedAt: typeof fetchedAt === "number" ? fetchedAt : Date.now(), settled: true };
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
    if ((post.platform || "") === "youtube") {
      loadYtComments(post).then((doc) => {
        if (STATE.replyEpoch[id] !== epoch) return;
        const rows = (doc && doc.replies) || [];
        const at = ytFetchedAt(doc);
        if (!rows.length) finish([], !(doc && doc.commentCount != null), want, at);
        else finish(rows.slice(0, want), false, want, at);
      }).catch(() => {
        if (STATE.replyEpoch[id] !== epoch) return;
        finish([], true, want, 0);
      });
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
    let n = Number(value);
    if (!isFinite(n) || n <= 0) return "";
    if (n < 100000000000) n *= 1000;
    if (n < 1000000000000) return "";
    return new Date(n).toISOString().replace(/\.\d{3}Z$/, "Z");
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
      const clip = {
        type: "video",
        url: "https://www.youtube-nocookie.com/embed/" + att.videoId,
        poster: poster,
        videoId: att.videoId,
        alt: att.title || ""
      };
      if (att.author) clip.author = String(att.author);
      if (att.authorId) clip.authorId = String(att.authorId);
      const face = bestThumb(att.authorThumbnails);
      if (face.url) clip.authorAvatar = face.url;
      media.push(clip);
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

  function ytVideoId(id) {
    return /^[A-Za-z0-9_-]{11}$/.test(String(id || ""));
  }

  function ytFetchedAt(doc) {
    if (!doc) return 0;
    const raw = doc.fetchedAt != null && doc.fetchedAt !== "" ? doc.fetchedAt : doc._at;
    const t = typeof raw === "number" ? raw : Date.parse(raw || "");
    return isFinite(t) && t > 0 ? t : 0;
  }

  function ytUsable(doc) {
    return !!(doc && (((doc.replies || []).length) || doc.commentCount != null));
  }

  function rememberYt(id, doc, live) {
    if (live) doc.fetchedAt = new Date().toISOString();
    else if (!doc.fetchedAt && doc._at) doc.fetchedAt = new Date(doc._at).toISOString();
    if (doc.commentCount != null && isFinite(Number(doc.commentCount))) applyLiveStats(id, { replies: Number(doc.commentCount) });
    STATE.ytDocs[id] = doc;
    return cacheSet("yt:doc:" + id, doc).then(() => doc);
  }

  function ivCommunityThread(post) {
    const id = postKey(post);
    const ucid = (feedOf(post).channelId) || "";
    let path = "/api/v1/post/" + encodeURIComponent(id) + "/comments?sort_by=top";
    if (ucid) path += "&ucid=" + encodeURIComponent(ucid);
    return rotate(ivBases(), path, 4, "ivBase").then((payload) => {
      if (!payload || !Array.isArray(payload.comments)) return null;
      const top = [];
      payload.comments.forEach((comment) => {
        if (!String(comment.content || "").trim()) return;
        const row = ivComment(comment, id, post.handle || "");
        row._community = true;
        delete row._continuation;
        top.push(row);
      });
      const doc = { postId: "ytpost_" + id, platform: "youtube", source: "invidious", replies: top };
      if (payload.commentCount != null && isFinite(Number(payload.commentCount))) {
        doc.commentCount = Number(payload.commentCount);
        applyLiveStats(id, { replies: doc.commentCount });
      }
      return ytUsable(doc) ? doc : null;
    });
  }

  function ytStub(id) {
    return snapshotDoc("yt_" + id).then((doc) => ytUsable(doc) ? doc : null).catch(() => null);
  }

  function ytPostStub(id) {
    return snapshotDoc("ytpost_" + id).then((doc) => ytUsable(doc) ? doc : null).catch(() => null);
  }

  function loadYtRoot(post) {
    const id = postKey(post);
    if (!id) return Promise.resolve(null);
    const community = post.kind === "community";
    const fresh = STATE.forceWatch === id || STATE.forceReply === id;
    if (STATE.forceWatch === id) STATE.forceWatch = "";
    if (STATE.forceReply === id) STATE.forceReply = "";
    if (fresh) cacheDrop("yt:doc:" + id);
    return once((fresh ? "ytfresh:" : "yt:") + id, () => (fresh ? Promise.resolve(null) : cacheGet("yt:doc:" + id, COMMENT_TTL)).then((hit) => {
      if (hit) {
        if (hit.commentCount != null && isFinite(Number(hit.commentCount))) applyLiveStats(id, { replies: Number(hit.commentCount) });
        STATE.ytDocs[id] = hit;
        return hit;
      }
      const live = community ? ivCommunityThread(post) : ivThread(id, post.handle || "");
      const stored = community
        ? ownPack("ytpost_" + id).then((own) => ytUsable(own) ? own : ytPostStub(id))
        : ownPack("yt_" + id).then((own) => ytUsable(own) ? own : ytStub(id));
      return loadStatus().then(() => live.then((doc) => {
        if (ytUsable(doc)) return rememberYt(id, doc, true);
        return stored.then((own) => own ? rememberYt(id, own, false) : null);
      }));
    })).catch(() => null);
  }

  function commentInDocs(id) {
    const key = String(id || "");
    if (!key) return null;
    const names = Object.keys(STATE.ytDocs || {});
    for (let i = 0; i < names.length; i++) {
      const doc = STATE.ytDocs[names[i]];
      const found = findComment((doc && doc.replies) || [], key) || findComment((doc && doc.newest) || [], key);
      if (found) return { comment: found, doc: doc, videoId: names[i] };
    }
    return null;
  }

  function ytRootPost(id, handle) {
    const known = posts().find((item) => item && item.platform === "youtube" && postKey(item) === id);
    if (known) return known;
    return { id: id, statusId: id, platform: "youtube", handle: handle || "", kind: ytVideoId(id) ? "post" : "community" };
  }

  function ytCandidateIds(handle) {
    const h = String(handle || "").toLowerCase();
    const ids = [];
    posts().forEach((item) => {
      if (!item || item.platform !== "youtube" || item.kind === "reply") return;
      if (h && String(item.handle || "").toLowerCase() !== h) return;
      const id = postKey(item);
      if (id && ids.indexOf(id) < 0) ids.push(id);
    });
    return ids;
  }

  function packYtComment(comment, doc) {
    return {
      replies: (comment && comment.replies) || [],
      fetchedAt: doc && (doc.fetchedAt || doc._at) || "",
      source: (doc && doc.source) || "",
      comment: comment || null,
      commentCount: comment && comment.stats ? comment.stats.replies : null
    };
  }

  function ytDocName(id) {
    if (ytVideoId(id)) return "yt_" + id;
    const known = posts().find((item) => item && item.platform === "youtube" && postKey(item) === id);
    if (known && known.kind !== "community") return "yt_" + id;
    return "ytpost_" + id;
  }

  function loadYtReplies(post) {
    const id = postKey(post);
    const cached = commentInDocs(id);
    if (cached) return Promise.resolve(packYtComment(cached.comment, cached.doc));
    const parent = String((post.replyingTo || {}).id || "");
    const seeds = [];
    if (parent && (ytVideoId(parent) || posts().some((item) => item.platform === "youtube" && postKey(item) === parent))) seeds.push(parent);
    ytCandidateIds(post.handle).forEach((vid) => { if (seeds.indexOf(vid) < 0) seeds.push(vid); });
    const finishSeed = (vid, probed) => loadYtRoot(ytRootPost(vid, post.handle)).then((doc) => {
      const liveHit = commentInDoc(doc, id);
      if (liveHit) {
        STATE.ytDocs[vid] = doc;
        return packYtComment(liveHit, doc);
      }
      const file = probed ? Promise.resolve(probed) : ownPack(ytDocName(vid));
      return file.then((stored) => {
        const found = commentInDoc(stored, id);
        if (found) {
          STATE.ytDocs[vid] = stored;
          return packYtComment(found, stored);
        }
        return snapshotDoc(id).then((stub) => ytUsable(stub) ? stub : null).catch(() => null);
      });
    });
    if (parent && seeds[0] === parent) return finishSeed(parent, null);
    return Promise.all(seeds.map((vid) => ownPack(ytDocName(vid)).then((doc) => ({ vid: vid, doc: doc })).catch(() => ({ vid: vid, doc: null })))).then((rows) => {
      const hit = rows.find((row) => commentInDoc(row.doc, id));
      if (hit) return finishSeed(hit.vid, hit.doc);
      return snapshotDoc(id).then((stub) => ytUsable(stub) ? stub : null).catch(() => null);
    });
  }

  function commentInDoc(doc, id) {
    if (!doc) return null;
    return findComment(doc.replies || [], id) || findComment(doc.newest || [], id);
  }

  function loadYtComments(post) {
    const id = postKey(post);
    if (!id || !post || post.platform !== "youtube") return Promise.resolve(null);
    const known = posts().some((item) => item.platform === "youtube" && postKey(item) === id && item.kind !== "reply");
    if (post.kind === "reply" || (!known && !ytVideoId(id) && post.kind !== "community")) return loadYtReplies(post);
    return loadYtRoot(post);
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
    const local = new URL("archive/" + file, document.baseURI).href;
    const raw = ARCHIVE_RAW + file;
    const cdn = ARCHIVE_CDN + file;
    const ia = ARCHIVE_IA + file;
    const extra = [];
    const month = String(file).match(/^(\d{4}-\d{2}|undated)\.json$/);
    if (month) extra.push("https://archive.org/download/superintelapp-" + month[1] + "/" + file);
    if (file === "index.json" || file === "ia-manifest.json") extra.push("https://archive.org/download/superintelapp-manifest/" + file);
    const primary = fresh ? [local, raw, cdn] : [local, cdn, raw];
    return primary.concat(extra).concat([ia]);
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
    const manifestTask = fetchArchive("ia-manifest.json", true).then((doc) => {
      installIaManifest(doc || { v: 1, files: [], posts: {} });
    }).catch(() => {
      installIaManifest({ v: 1, files: [], posts: {} });
    });
    try {
      const index = await fetchArchive("index.json", true);
      if (index) {
        ARCHIVE.order = (index.shards || []).filter((name) => /^\d{4}-\d{2}$/.test(name) || name === "undated");
        if (ARCHIVE.order.length) await loadShard(ARCHIVE.order[0]);
      }
    } catch (err) { /* the timeline stays on feeds.json */ }
    await manifestTask;
  }

  function revealArchive() {
    const route = parseRoute();
    if (route.name !== "home" || (route.tab && route.tab !== "foryou")) { render(); return; }
    const center = document.querySelector("main.center");
    if (!center) { render(); return; }
    const seen = {};
    center.querySelectorAll("article[data-post]").forEach((el) => { seen[el.dataset.post] = true; });
    const list = posts().filter((post) => homeShows(post, route));
    if (tabView(route.tab || "foryou") === "reposts") list.sort(byRepostTime);
    else list.sort(byStamp);
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
      const saved = archivedFromManifest(stub);
      if (saved) {
        HYDRATED[key] = saved;
        return;
      }
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
    if (stub.platform === "instagram" || stub.platform === "threads" || stub.platform === "rss" || stub.platform === "discord") {
      const saved = archivedFromManifest(stub);
      if (saved) {
        HYDRATED[key] = saved;
        render();
      }
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
        const saved = archivedFromManifest(stub);
        if (saved) {
          HYDRATED[key] = saved;
          render();
          return;
        }
        HYDRATE_MISS[key] = true;
        return;
      }
      applyHydrated(key, value, stub);
      render();
    }).catch(() => {
      delete HYDRATE_FLIGHT[key];
      const saved = archivedFromManifest(stub);
      if (saved) {
        HYDRATED[key] = saved;
        render();
        return;
      }
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
    if (SUB_COUNTS[feed.channelId] != null) feed.followers = SUB_COUNTS[feed.channelId];
    const key = "subs:" + feed.channelId;
    if (TRIED[key]) return;
    TRIED[key] = 1;
    liveSubs(feed.channelId).then((count) => {
      if (count == null) return;
      SUB_COUNTS[feed.channelId] = count;
      if (feed.followers === count) return;
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
    let directs = pool.filter((reply) => isDirect(post, reply) && !hiddenPost(reply));
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
    if ((reply.platform || "") === "youtube" && (reply.replies || []).length) return reply.replies;
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
    if (!isFinite(t) || t <= 0) return "";
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
    const label = freshLabel(bucket.fetchedAt);
    return `<div class="reply-tools">${label ? `<span class="reply-fresh">${esc(label)}</span>` : ""}</div>${replySortTabs()}`;
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
      let inline = [];
      if ((reply.platform || post.platform) === "youtube" && (reply.replies || []).length) {
        inline = reply.replies.filter((child) => child && String(child.text || "").trim()).slice(0, 20);
      }
      if ((reply.platform || post.platform) === "discord" && (reply.replies || []).length) {
        inline = reply.replies.filter((child) => child && (String(child.text || "").trim() || (child.media || []).length || child.author)).slice(0, 20);
      }
      if (!inline.length) inline = inlineChildren(reply, pool);
      inline = inline.filter((child) => child && !hiddenPost(child));
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
            <a class="name" href="${esc(accountHash(post.platform, post.handle))}" data-card="${esc((post.platform || "x") + ":" + (post.handle || ""))}">${esc(post.author || post.handle || "Post")}${badge(face.verified)}</a>
            ${post.handle ? `<a class="handle" href="${esc(accountHash(post.platform, post.handle))}" data-card="${esc((post.platform || "x") + ":" + post.handle)}">@${esc(post.handle)}</a>` : ""}
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
    const question = poll.question ? `<div class="poll-question">${esc(poll.question)}</div>` : "";
    return `<div class="poll">${question}${rows}${votes}</div>`;
  }

  function contextCard(parent) {
    if (!parent) return "";
    const text = String(parent.text || parent.title || "").replace(/\s+/g, " ").trim();
    return `<div class="reply-context">
      <div class="quote-head">
        ${avatar(parent.avatar, parent.author || parent.handle)}
        <span class="name">${esc(parent.author || parent.handle || "Post")}</span>
        ${parent.handle ? `<span class="handle">@${esc(parent.handle)}</span>` : ""}
      </div>
      ${text ? `<div class="quote-text">${esc(text.slice(0, 220))}</div>` : ""}
    </div>`;
  }

  function forwardLine(post) {
    const from = post && post.forwardedFrom;
    if (!from) return "";
    const by = post.repostedBy;
    if (by && (by.name || by.handle)) return "";
    const name = String(from.name || "").trim();
    const handle = String(from.handle || "").trim();
    if (!name && !handle) return `<div class="repost-line">${icon("repost")}<span>Forwarded</span></div>`;
    const label = name || ("@" + handle);
    const who = handle
      ? `<a data-act="stop" data-card="${esc("telegram:" + handle)}" href="${esc(accountHash("telegram", handle))}">${esc(label)}</a>`
      : esc(label);
    return `<div class="repost-line">${icon("repost")}<span>Forwarded from ${who}</span></div>`;
  }

  function card(post, mode, opts) {
    creditCarried(post);
    if (bridgeErrorPost(post)) return "";
    if (post && post.tombstone) return tombstoneCard(post);
    opts = opts || {};
    const hideRepost = mode === "author" || mode === "status";
    const repost = repostBanner(post, hideRepost ? "author" : "");
    const sharedNote = repostQuote(post, hideRepost ? "author" : "");
    const forwarded = forwardLine(post);
    const showReply = mode === "reply" ? relevantReply(post, opts.focus) : !!(post.replyingTo && post.replyingTo.handle);
    const reply = showReply ? `<div class="replying">Replying to <a data-act="stop" data-card="${esc((post.platform || "x") + ":" + post.replyingTo.handle)}" href="${esc(accountHash(post.platform || "x", post.replyingTo.handle))}">@${esc(post.replyingTo.handle)}</a></div>` : "";
    const context = mode !== "status" && post.replyParent && (post.kind === "reply" || post.platform === "telegram") ? contextCard(post.replyParent) : "";
    const repostFeed = feedOf(post);
    const repostItem = repostFeed && repostFeed.id && isFollowed(repostFeed.id)
      ? `<button data-act="repost-off" data-id="${esc(repostFeed.id)}">${(STATE.settings.repostOff || []).indexOf(repostFeed.id) >= 0 ? "Turn on reposts" : "Turn off reposts"}</button>`
      : "";
    const shareLink = sharePostUrl(post, "post") || post.url || sitePermalink(statusHash(post));
    const shareNote = sharePostUrl(post, "post") ? "" : unpublishedNote("post", post.platform, !!post.url);
    const here = parseRoute();
    const histItem = here.name === "history" ? `<button data-act="hist-remove" data-id="${esc(post.id)}" data-tab="${esc(here.tab || "bookmarks")}">Remove from History</button>` : "";
    const menu = STATE.menu === post.id ? `<div class="menu" data-act="stop"><button data-act="copy" data-url="${esc(shareLink)}"${shareNote ? ` data-note="${esc(shareNote)}"` : ""}>Copy link</button>${histItem}${repostItem}<a data-act="stop" target="_blank" rel="noopener noreferrer" href="${esc(post.url || "#")}">View on ${esc(PLATFORM[post.platform] || "web")}</a></div>` : "";
    const continues = !!opts.continues;
    const face = authorFace(post);
    const creator = isRepost(post) ? creatorOf(post) : null;
    const eager = !!opts.eager;
    watchArticle(post);
    const shown = displayPost(post);
    const dest = articleOf(post) ? articleHash(post) : (post.watch ? watchHash(post) : statusHash(post));
    const who = creator ? (post.profileHandle || creator.channelId || creator.handle || post.handle) : (post.profileHandle || post.handle);
    const displayName = creator ? (creator.name || post.author || post.handle) : (post.author || post.handle);
    const displayHandle = creator ? (post.handle || creator.handle || "") : (post.handle || "");
    const avaLink = `<a href="${esc(accountHash(post.platform, who))}" data-card="${esc(post.platform + ":" + who)}" aria-label="${esc(displayName || "Profile")}">${avatar(face.avatar, displayName)}</a>`;
    const avaCol = continues ? `<div class="ava-col">${avaLink}<div class="thread-line"></div></div>` : avaLink;
    const open = ` data-open="${esc(dest)}"`;
    const nestedDiscord = post.platform === "discord" && Array.isArray(post.replies) && post.replies.length;
    const threadLink = mode !== "status" && mode !== "reply" && (threadChildren(post).length || nestedDiscord)
      ? `<a class="show-thread" href="${esc(statusHash(post))}" data-act="stop">Show this thread</a>` : "";
    const hydrate = post.stub ? ` data-hydrate="${esc(postIdentity(post))}"` : "";
    return `<article class="post${continues ? " continues" : ""}${mode === "reply" ? " reply-card" : ""}" data-post="${esc(post.id)}" data-kind="${esc(post.kind || "post")}" data-date="${esc(post.date || "")}"${open}${hydrate}>
      ${context}
      ${repost}
      ${sharedNote}
      ${forwarded}
      <div class="post-row">
        ${avaCol}
        <div class="post-main">
          <div class="byline">
            <a class="name" href="${esc(accountHash(post.platform, who))}" data-card="${esc(post.platform + ":" + who)}">${esc(displayName)}${badge(face.verified)}</a>
            ${displayHandle ? `<a class="handle" href="${esc(accountHash(post.platform, who))}" data-card="${esc(post.platform + ":" + who)}">@${esc(displayHandle)}</a>` : ""}
            <span class="dot">·</span>
            <a class="time" href="${esc(dest)}">${esc(relTime(post.date))}</a>
            ${post.edited ? `<span class="edited">Edited</span>` : ""}
            ${sourceBadge(post.platform)}
            <button class="more-btn" data-act="menu" data-id="${esc(post.id)}" aria-label="More">${icon("more")}</button>
          </div>
          ${reply}
          ${discordMeta(post)}
          ${shown.text ? textBlock(shown, post.id, false) : ""}
          ${articleCardHtml(post)}
          ${pollHtml(post)}
          ${mediaHtml(post.media, eager, post)}
          ${postCards(post)}
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
    try { return parseRouteInner(); }
    catch (err) { return { name: "home", tab: "foryou", query: new URLSearchParams() }; }
  }

  function parseRouteInner() {
    const hash = location.hash || "#/";
    const qAt = hash.indexOf("?");
    const query = qAt >= 0 ? new URLSearchParams(hash.slice(qAt + 1)) : new URLSearchParams();
    const path = (qAt >= 0 ? hash.slice(0, qAt) : hash).replace(/^#/, "") || "/";
    const parts = path.split("/").filter(Boolean).map((part) => {
      try { return decodeURIComponent(part); } catch (err) { return part; }
    });
    if (!parts.length || parts[0] === "home") return { name: "home", tab: parts[1] === "following" ? "following" : parts[1] === "tab" ? "list:" + parts[2] : "foryou", query };
    if (parts[0] === "following") return { name: "home", tab: "following", query };
    if (parts[0] === "subscriptions") return { name: "subscriptions", channel: parts[1] || query.get("c") || "", query };
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
    if (parts[0] === "p" && parts[1]) return { name: "person", id: parts[1], query };
    if (parts[0] === "messages") {
      const channel = parts[1] === "discord" && parts[2] ? parts[2] : "";
      return { name: "messages", channel: channel, query };
    }
    if (parts[0] === "spaces" && parts[1]) return { name: "spaces", id: parts[1], query };
    if (parts[0] === "history") {
      const tab = parts[1] === "likes" || parts[1] === "videos" || parts[1] === "articles" ? parts[1] : "bookmarks";
      return { name: "history", tab: tab, query };
    }
    if (parts[0] === "article" && parts[1]) return { name: "article", id: parts.slice(1).join("/"), query };
    if (parts[0] === "bookmarks" && parts.length === 1) return { name: "history", tab: "bookmarks", query };
    const names = ["explore", "notifications", "messages", "feeds", "lists", "settings", "incoming"];
    if (names.includes(parts[0]) && parts.length === 1) return { name: parts[0], query };
    if (parts[0] === "lists" && parts[1]) return { name: "list", id: parts[1], query };
    let platform = "x";
    let handle = "";
    let rest = [];
    if (parts[0].startsWith("@")) {
      handle = parts[0].slice(1);
      rest = parts.slice(1);
    } else if (["x", "threads", "instagram", "rss", "youtube", "vk", "discord", "telegram"].includes(parts[0])) {
      platform = parts[0];
      handle = parts[1] || "";
      rest = parts.slice(2);
    } else {
      return { name: "home", tab: "foryou", query };
    }
    if (rest[0] === "status" && rest[1]) return { name: "status", platform, handle, id: rest.slice(1).join("/"), query };
    return { name: "profile", platform, handle, query };
  }

  function bellUnread() {
    const read = Number(STATE.settings && STATE.settings.bellRead) || 0;
    return ((STATE.settings && STATE.settings.bellNotes) || []).filter((note) => (Number(note.at) || 0) > read).length;
  }

  function bellBadgeHtml() {
    const count = bellUnread();
    if (!count) return "";
    return `<span class="nav-badge">${count > 20 ? "20+" : String(count)}</span>`;
  }

  function navItem(href, name, label, on) {
    const glyph = icon(on && name === "home" ? "homeOn" : name);
    const badge = name === "bell" ? bellBadgeHtml() : "";
    return `<a class="nav-item${on ? " on" : ""}" href="${href}" aria-label="${esc(label)}"${on ? ' aria-current="page"' : ""}><span class="nav-ico">${glyph}${badge}</span><span class="nav-label">${label}</span></a>`;
  }

  function brandLink() {
    return `<a class="logo" href="#/" aria-label="SuperintelApp"><svg class="logo-full" viewBox="0 0 9539.20 2079.00" fill="currentColor" aria-hidden="true"><path d="M 708.4 1680.8Q 495 1680.8 336.05 1617.55Q 177.1 1554.3 89.1 1422.3Q 1.1 1290.3 0 1084.6H 422.4Q 426.8 1159.4 460.35 1211.1Q 493.9 1262.8 554.95 1289.2Q 616 1315.6 701.8 1315.6Q 773.3 1315.6 821.7 1298Q 870.1 1280.4 894.85 1249.05Q 919.6 1217.7 919.6 1177Q 919.6 1139.6 895.95 1111.55Q 872.3 1083.5 818.4 1060.4Q 764.5 1037.3 673.2 1018.6L 508.2 983.4Q 291.5 937.2 166.65 825.55Q 41.8 713.9 41.8 521.4Q 41.8 365.2 126.5 248.05Q 211.2 130.9 360.25 65.45Q 509.3 0 704 0Q 903.1 0 1047.75 66.55Q 1192.4 133.1 1271.05 253.55Q 1349.7 374 1350.8 534.6H 924Q 918.5 454.3 865.15 409.75Q 811.8 365.2 704 365.2Q 635.8 365.2 591.8 381.15Q 547.8 397.1 526.9 425.7Q 506 454.3 506 490.6Q 506 529.1 528.55 558.25Q 551.1 587.4 600.05 608.85Q 649 630.3 726 646.8L 860.2 675.4Q 995.5 704 1092.85 751.3Q 1190.2 798.6 1252.35 861.85Q 1314.5 925.1 1343.65 1004.3Q 1372.8 1083.5 1372.8 1177Q 1372.8 1338.7 1293.05 1451.45Q 1213.3 1564.2 1064.8 1622.5Q 916.3 1680.8 708.4 1680.8Z M 1986.6 22V 1661H 1542.2V 22Z M 2510.2 991V 1661H 2330.2V 543H 2503.2L 2504.2 750Q 2558.2 631 2645.7 580Q 2733.2 529 2846.2 529Q 3016.2 529 3120.2 634Q 3224.2 739 3224.2 951V 1661H 3044.2V 966Q 3044.2 837 2976.7 764Q 2909.2 691 2792.2 691Q 2671.2 691 2590.7 769.5Q 2510.2 848 2510.2 991Z M 3980.2 543V 697H 3750.2V 1371Q 3750.2 1446 3780.7 1480.5Q 3811.2 1515 3882.2 1515Q 3899.2 1515 3925.7 1511Q 3952.2 1507 3974.2 1503L 4011.2 1655Q 3983.2 1665 3947.7 1670Q 3912.2 1675 3877.2 1675Q 3732.2 1675 3651.2 1598.5Q 3570.2 1522 3570.2 1385V 697H 3402.2V 543H 3570.2V 277H 3750.2V 543Z M 4660.2 1685Q 4498.2 1685 4380.7 1613Q 4263.2 1541 4199.7 1412Q 4136.2 1283 4136.2 1111Q 4136.2 939 4198.2 808Q 4260.2 677 4373.7 603Q 4487.2 529 4639.2 529Q 4728.2 529 4814.7 558.5Q 4901.2 588 4971.7 653.5Q 5042.2 719 5084.2 826Q 5126.2 933 5126.2 1088V 1163H 4318.2Q 4325.2 1338 4418.7 1431.5Q 4512.2 1525 4661.2 1525Q 4760.2 1525 4831.7 1481.5Q 4903.2 1438 4934.2 1353L 5108.2 1401Q 5069.2 1528 4950.7 1606.5Q 4832.2 1685 4660.2 1685ZM 4319.2 1011H 4943.2Q 4930.2 868 4853.7 778.5Q 4777.2 689 4639.2 689Q 4543.2 689 4473.7 734Q 4404.2 779 4364.2 852Q 4324.2 925 4319.2 1011Z M 5564.2 171V 1661H 5384.2V 171Z M 5774.2 1661 6315.2 171H 6535.2L 7083.2 1661H 6883.2L 6734.2 1245H 6120.2L 5976.2 1661ZM 6178.2 1079H 6675.2L 6567.2 777Q 6540.2 702 6506.2 593.5Q 6472.2 485 6424.2 323Q 6377.2 488 6342.2 598Q 6307.2 708 6283.2 777Z M 7293.2 2079V 543H 7467.2V 722H 7487.2Q 7506.2 692 7540.2 646.5Q 7574.2 601 7638.2 565Q 7702.2 529 7811.2 529Q 7951.2 529 8057.7 599Q 8164.2 669 8224.7 798.5Q 8285.2 928 8285.2 1105Q 8285.2 1283 8225.2 1413Q 8165.2 1543 8058.7 1614Q 7952.2 1685 7812.2 1685Q 7706.2 1685 7641.2 1648.5Q 7576.2 1612 7541.2 1565.5Q 7506.2 1519 7487.2 1488H 7473.2V 2079ZM 7785.2 1524Q 7890.2 1524 7960.7 1467.5Q 8031.2 1411 8066.7 1315.5Q 8102.2 1220 8102.2 1103Q 8102.2 987 8067.2 893.5Q 8032.2 800 7961.7 745Q 7891.2 690 7785.2 690Q 7631.2 690 7551.2 804Q 7471.2 918 7471.2 1103Q 7471.2 1290 7552.2 1407Q 7633.2 1524 7785.2 1524Z M 8547.2 2079V 543H 8721.2V 722H 8741.2Q 8760.2 692 8794.2 646.5Q 8828.2 601 8892.2 565Q 8956.2 529 9065.2 529Q 9205.2 529 9311.7 599Q 9418.2 669 9478.7 798.5Q 9539.2 928 9539.2 1105Q 9539.2 1283 9479.2 1413Q 9419.2 1543 9312.7 1614Q 9206.2 1685 9066.2 1685Q 8960.2 1685 8895.2 1648.5Q 8830.2 1612 8795.2 1565.5Q 8760.2 1519 8741.2 1488H 8727.2V 2079ZM 9039.2 1524Q 9144.2 1524 9214.7 1467.5Q 9285.2 1411 9320.7 1315.5Q 9356.2 1220 9356.2 1103Q 9356.2 987 9321.2 893.5Q 9286.2 800 9215.7 745Q 9145.2 690 9039.2 690Q 8885.2 690 8805.2 804Q 8725.2 918 8725.2 1103Q 8725.2 1290 8806.2 1407Q 8887.2 1524 9039.2 1524Z"/></svg><svg class="logo-si" viewBox="0 0 1986.60 1680.80" fill="currentColor" aria-hidden="true"><path d="M 708.4 1680.8Q 495 1680.8 336.05 1617.55Q 177.1 1554.3 89.1 1422.3Q 1.1 1290.3 0 1084.6H 422.4Q 426.8 1159.4 460.35 1211.1Q 493.9 1262.8 554.95 1289.2Q 616 1315.6 701.8 1315.6Q 773.3 1315.6 821.7 1298Q 870.1 1280.4 894.85 1249.05Q 919.6 1217.7 919.6 1177Q 919.6 1139.6 895.95 1111.55Q 872.3 1083.5 818.4 1060.4Q 764.5 1037.3 673.2 1018.6L 508.2 983.4Q 291.5 937.2 166.65 825.55Q 41.8 713.9 41.8 521.4Q 41.8 365.2 126.5 248.05Q 211.2 130.9 360.25 65.45Q 509.3 0 704 0Q 903.1 0 1047.75 66.55Q 1192.4 133.1 1271.05 253.55Q 1349.7 374 1350.8 534.6H 924Q 918.5 454.3 865.15 409.75Q 811.8 365.2 704 365.2Q 635.8 365.2 591.8 381.15Q 547.8 397.1 526.9 425.7Q 506 454.3 506 490.6Q 506 529.1 528.55 558.25Q 551.1 587.4 600.05 608.85Q 649 630.3 726 646.8L 860.2 675.4Q 995.5 704 1092.85 751.3Q 1190.2 798.6 1252.35 861.85Q 1314.5 925.1 1343.65 1004.3Q 1372.8 1083.5 1372.8 1177Q 1372.8 1338.7 1293.05 1451.45Q 1213.3 1564.2 1064.8 1622.5Q 916.3 1680.8 708.4 1680.8Z M 1986.6 22V 1661H 1542.2V 22Z"/></svg></a>`;
  }

  function nav(route) {
    const name = route.name;
    return `<header class="nav">
      <div class="nav-scroll">
        ${brandLink()}
        ${navItem("#/", "home", "Home", name === "home")}
        ${navItem("#/explore", "search", "Explore", name === "explore")}
        ${navItem("#/notifications", "bell", "Notifications", name === "notifications")}
        ${navItem("#/messages", "mail", "Messages", name === "messages")}
        ${navItem("#/feeds", "spark", "Feeds", name === "feeds")}
        ${navItem("#/lists", "lists", "Lists", name === "lists" || name === "list")}
        ${navItem("#/history", "clock", "History", name === "history")}
        ${navItem(subsHash(STATE.settings.subsGroup), "subs", "Subscriptions", name === "subscriptions")}
        ${navItem("#/settings", "more", "More", name === "settings")}
        <button class="post-btn" data-act="compose" aria-label="Post"><span class="post-label">Post</span><svg class="post-ico" viewBox="0 0 24 24"><path d="${PATH.feather}"/></svg></button>
      </div>
      <button class="account-pill" data-act="drawer" aria-label="Account menu">
        <span class="ava initials">Y</span>
        <span class="account-meta"><b>You</b><span>@reader</span></span>
        <span class="dots">${icon("more")}</span>
      </button>
    </header>`;
  }

  function shownFeeds(list) {
    if (window.FeedsPeople && window.FeedsPeople.collapse) return window.FeedsPeople.collapse(list);
    return list;
  }

  function followSuggestions() {
    const list = feeds().filter((f) => f.id);
    if (window.FeedsPeople && window.FeedsPeople.suggestions) return window.FeedsPeople.suggestions(list, isFollowed);
    return list.filter((f) => !isFollowed(f.id)).sort((a, b) => (b.configured ? 1 : 0) - (a.configured ? 1 : 0));
  }

  function sidebar() {
    const people = followSuggestions().slice(0, 3);
    const rows = people.map((f) => `<div class="who-row">
      <a class="who-main" href="${esc(accountHash(f.platform, f.channelId || f.handle))}" data-card="${esc(f.id)}">
        ${avatar(f.avatar, f.name)}
        <span class="who-copy"><span class="name">${esc(f.name)}${badge(f.verifiedType)}</span><span class="handle">@${esc(f.handle)} ${sourceBadge(f.platform)}</span></span>
      </a>
      ${followButtonClean(f.id)}
    </div>`).join("");
    return `<aside class="side">
      <form class="side-search" data-act="search-form">
        <label class="search"><span class="sr">${icon("search")}</span><input id="side-q" type="search" placeholder="Search" aria-label="Search"></label>
      </form>
      ${window.Spaces && window.Spaces.sideCard ? window.Spaces.sideCard() : ""}
      ${people.length ? `<section class="card"><h2>Who to follow</h2>${rows}<a class="show-more-row" href="#/feeds">Show more</a></section>` : ""}
      <div class="fineprint"><span>SuperintelApp</span><span>Preview snapshot</span><a href="https://github.com/${GITHUB_REPO}">GitHub</a><span>Not affiliated with X</span></div>
    </aside>`;
  }

  function bottom(route) {
    const item = (href, name, label, on) => `<a href="${href}" class="${on ? "on" : ""}" aria-label="${label}"${on ? ' aria-current="page"' : ""}><span class="nav-ico">${icon(name)}${name === "bell" ? bellBadgeHtml() : ""}</span></a>`;
    return `<nav class="bottom-nav" aria-label="Primary">
      ${item("#/", route.name === "home" ? "homeOn" : "home", "Home", route.name === "home")}
      ${item("#/explore", "search", "Search", route.name === "explore")}
      ${item("#/feeds", "spark", "Feeds", route.name === "feeds")}
      ${item("#/notifications", "bell", "Notifications", route.name === "notifications")}
      ${item("#/messages", "mail", "Messages", route.name === "messages")}
    </nav>
    <button class="fab" data-act="compose" aria-label="Post">${icon("plus")}</button>`;
  }

  function listSortOf(list) {
    return list && list.sort === "popular" ? "popular" : "recent";
  }

  function cleanTabViews(raw) {
    const out = {};
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
    Object.keys(raw).forEach((key) => {
      if (raw[key] === "reposts" && key && String(key).length < 160) out[key] = "reposts";
    });
    return out;
  }

  function tabView(tab) {
    const views = (STATE.settings && STATE.settings.tabViews) || {};
    return views[tab || "foryou"] === "reposts" ? "reposts" : "all";
  }

  function setTabView(tab, view) {
    if (!STATE.settings.tabViews || typeof STATE.settings.tabViews !== "object" || Array.isArray(STATE.settings.tabViews)) STATE.settings.tabViews = {};
    const key = tab || "foryou";
    if (view === "reposts") STATE.settings.tabViews[key] = "reposts";
    else delete STATE.settings.tabViews[key];
  }

  function isRepost(post) {
    if (!post) return false;
    if (post.kind === "repost") return true;
    const by = post.repostedBy;
    if (by && (by.handle || by.name)) return true;
    const from = post.forwardedFrom;
    return !!(from && typeof from === "object");
  }

  function repostMillis(post) {
    const raw = (post && (post.sortDate || post.date)) || "";
    const ms = Date.parse(raw);
    return isFinite(ms) ? ms : 0;
  }

  function byRepostTime(a, b) {
    const delta = repostMillis(b) - repostMillis(a);
    if (delta) return delta;
    const aid = String((a && a.id) || "");
    const bid = String((b && b.id) || "");
    return aid < bid ? 1 : aid > bid ? -1 : 0;
  }

  function homePath(tab) {
    if (tab === "following") return "#/following";
    if (tab && tab.indexOf("list:") === 0) return "#/tab/" + encodeURIComponent(tab.slice(5));
    return "#/";
  }

  function homeHash(tab) {
    const q = new URLSearchParams();
    if (tab === "following") q.set("sort", STATE.settings.followingSort === "popular" ? "popular" : "recent");
    else if (tab && tab.indexOf("list:") === 0) {
      const list = (STATE.settings.lists || []).find((item) => item.id === tab.slice(5));
      q.set("sort", listSortOf(list));
    } else {
      q.set("reposts", STATE.settings.forYouReposts === false ? "0" : "1");
      q.set("replies", STATE.settings.forYouReplies === false ? "0" : "1");
    }
    if (tabView(tab) === "reposts") q.set("view", "reposts");
    const text = q.toString();
    return homePath(tab) + (text ? "?" + text : "");
  }

  function syncHomeFromQuery(route) {
    if (!route || route.name !== "home" || !route.query) return;
    const tab = route.tab || "foryou";
    let changed = false;
    if (tab === "following" || tab.indexOf("list:") === 0) {
      const sort = route.query.get("sort");
      if (sort === "recent" || sort === "popular") {
        if (tab === "following") {
          if (STATE.settings.followingSort !== sort) { STATE.settings.followingSort = sort; changed = true; }
        } else {
          const list = (STATE.settings.lists || []).find((item) => item.id === tab.slice(5));
          if (list && listSortOf(list) !== sort) { list.sort = sort; changed = true; }
        }
      }
    } else {
      if (route.query.has("reposts")) {
        const on = route.query.get("reposts") !== "0";
        if ((STATE.settings.forYouReposts !== false) !== on) { STATE.settings.forYouReposts = on; changed = true; }
      }
      if (route.query.has("replies")) {
        const on = route.query.get("replies") !== "0";
        if ((STATE.settings.forYouReplies !== false) !== on) { STATE.settings.forYouReplies = on; changed = true; }
      }
    }
    if (route.query.has("view")) {
      const want = route.query.get("view") === "reposts" ? "reposts" : "all";
      if (tabView(tab) !== want) { setTabView(tab, want); changed = true; }
    }
    if (changed) saveSettings();
  }

  function tabSort(tab) {
    if (tab === "following") return STATE.settings.followingSort === "popular" ? "popular" : "recent";
    if (tab && tab.indexOf("list:") === 0) return listSortOf((STATE.settings.lists || []).find((item) => item.id === tab.slice(5)));
    return "recent";
  }

  function homeMember(post, tab) {
    if (tab === "following") {
      const followed = STATE.settings.follows || [];
      return followed.indexOf(post.feedId) >= 0 || followed.indexOf((post.platform || "x") + ":" + (post.handle || "")) >= 0;
    }
    if (tab && tab.indexOf("list:") === 0) {
      const found = (STATE.settings.lists || []).find((item) => item.id === tab.slice(5));
      const ids = (found && found.members) || [];
      return ids.indexOf(post.feedId) >= 0 || ids.indexOf((post.platform || "x") + ":" + (post.handle || "")) >= 0;
    }
    if (tabView(tab) !== "reposts") {
      if (STATE.settings.forYouReposts === false && (post.kind === "repost" || post.repostedBy)) return false;
      if (STATE.settings.forYouReplies === false && post.kind === "reply") return false;
    }
    return true;
  }

  function homeShows(post, route) {
    if (!post || !inTimeline(post) || hiddenPost(post)) return false;
    const tab = (route && route.tab) || "foryou";
    if (!homeMember(post, tab)) return false;
    if (tabView(tab) === "reposts" && !isRepost(post)) return false;
    return true;
  }

  function homeHeader(tab) {
    const lists = STATE.settings.lists.filter((l) => l.pinned);
    const tabBtn = (id, label, on) => `<button class="tab${on ? " on" : ""}" data-act="htab" data-tab="${esc(id)}" role="tab" aria-selected="${on ? "true" : "false"}"><span>${esc(label)}</span></button>`;
    const tabWithMenu = (id, label) => {
      if (tab !== id) return tabBtn(id, label, false);
      const expanded = STATE.tabMenu === id;
      return `<div class="tab-pair on">${tabBtn(id, label, true)}<button class="tab-caret" type="button" data-act="tab-options" data-tab="${esc(id)}" aria-label="${esc(label)} options" aria-expanded="${expanded ? "true" : "false"}" aria-haspopup="menu">${icon("caret")}</button></div>`;
    };
    return `<div class="topbar tall">
      <h1 class="vh">Home</h1>
      <div class="mhead">
        <button class="m-ava" data-act="drawer" aria-label="Menu"><span class="ava initials">Y</span></button>
        <a class="m-logo" href="#/" aria-label="SuperintelApp"><svg class="logo-full" viewBox="0 0 9539.20 2079.00" fill="currentColor" aria-hidden="true"><path d="M 708.4 1680.8Q 495 1680.8 336.05 1617.55Q 177.1 1554.3 89.1 1422.3Q 1.1 1290.3 0 1084.6H 422.4Q 426.8 1159.4 460.35 1211.1Q 493.9 1262.8 554.95 1289.2Q 616 1315.6 701.8 1315.6Q 773.3 1315.6 821.7 1298Q 870.1 1280.4 894.85 1249.05Q 919.6 1217.7 919.6 1177Q 919.6 1139.6 895.95 1111.55Q 872.3 1083.5 818.4 1060.4Q 764.5 1037.3 673.2 1018.6L 508.2 983.4Q 291.5 937.2 166.65 825.55Q 41.8 713.9 41.8 521.4Q 41.8 365.2 126.5 248.05Q 211.2 130.9 360.25 65.45Q 509.3 0 704 0Q 903.1 0 1047.75 66.55Q 1192.4 133.1 1271.05 253.55Q 1349.7 374 1350.8 534.6H 924Q 918.5 454.3 865.15 409.75Q 811.8 365.2 704 365.2Q 635.8 365.2 591.8 381.15Q 547.8 397.1 526.9 425.7Q 506 454.3 506 490.6Q 506 529.1 528.55 558.25Q 551.1 587.4 600.05 608.85Q 649 630.3 726 646.8L 860.2 675.4Q 995.5 704 1092.85 751.3Q 1190.2 798.6 1252.35 861.85Q 1314.5 925.1 1343.65 1004.3Q 1372.8 1083.5 1372.8 1177Q 1372.8 1338.7 1293.05 1451.45Q 1213.3 1564.2 1064.8 1622.5Q 916.3 1680.8 708.4 1680.8Z M 1986.6 22V 1661H 1542.2V 22Z M 2510.2 991V 1661H 2330.2V 543H 2503.2L 2504.2 750Q 2558.2 631 2645.7 580Q 2733.2 529 2846.2 529Q 3016.2 529 3120.2 634Q 3224.2 739 3224.2 951V 1661H 3044.2V 966Q 3044.2 837 2976.7 764Q 2909.2 691 2792.2 691Q 2671.2 691 2590.7 769.5Q 2510.2 848 2510.2 991Z M 3980.2 543V 697H 3750.2V 1371Q 3750.2 1446 3780.7 1480.5Q 3811.2 1515 3882.2 1515Q 3899.2 1515 3925.7 1511Q 3952.2 1507 3974.2 1503L 4011.2 1655Q 3983.2 1665 3947.7 1670Q 3912.2 1675 3877.2 1675Q 3732.2 1675 3651.2 1598.5Q 3570.2 1522 3570.2 1385V 697H 3402.2V 543H 3570.2V 277H 3750.2V 543Z M 4660.2 1685Q 4498.2 1685 4380.7 1613Q 4263.2 1541 4199.7 1412Q 4136.2 1283 4136.2 1111Q 4136.2 939 4198.2 808Q 4260.2 677 4373.7 603Q 4487.2 529 4639.2 529Q 4728.2 529 4814.7 558.5Q 4901.2 588 4971.7 653.5Q 5042.2 719 5084.2 826Q 5126.2 933 5126.2 1088V 1163H 4318.2Q 4325.2 1338 4418.7 1431.5Q 4512.2 1525 4661.2 1525Q 4760.2 1525 4831.7 1481.5Q 4903.2 1438 4934.2 1353L 5108.2 1401Q 5069.2 1528 4950.7 1606.5Q 4832.2 1685 4660.2 1685ZM 4319.2 1011H 4943.2Q 4930.2 868 4853.7 778.5Q 4777.2 689 4639.2 689Q 4543.2 689 4473.7 734Q 4404.2 779 4364.2 852Q 4324.2 925 4319.2 1011Z M 5564.2 171V 1661H 5384.2V 171Z M 5774.2 1661 6315.2 171H 6535.2L 7083.2 1661H 6883.2L 6734.2 1245H 6120.2L 5976.2 1661ZM 6178.2 1079H 6675.2L 6567.2 777Q 6540.2 702 6506.2 593.5Q 6472.2 485 6424.2 323Q 6377.2 488 6342.2 598Q 6307.2 708 6283.2 777Z M 7293.2 2079V 543H 7467.2V 722H 7487.2Q 7506.2 692 7540.2 646.5Q 7574.2 601 7638.2 565Q 7702.2 529 7811.2 529Q 7951.2 529 8057.7 599Q 8164.2 669 8224.7 798.5Q 8285.2 928 8285.2 1105Q 8285.2 1283 8225.2 1413Q 8165.2 1543 8058.7 1614Q 7952.2 1685 7812.2 1685Q 7706.2 1685 7641.2 1648.5Q 7576.2 1612 7541.2 1565.5Q 7506.2 1519 7487.2 1488H 7473.2V 2079ZM 7785.2 1524Q 7890.2 1524 7960.7 1467.5Q 8031.2 1411 8066.7 1315.5Q 8102.2 1220 8102.2 1103Q 8102.2 987 8067.2 893.5Q 8032.2 800 7961.7 745Q 7891.2 690 7785.2 690Q 7631.2 690 7551.2 804Q 7471.2 918 7471.2 1103Q 7471.2 1290 7552.2 1407Q 7633.2 1524 7785.2 1524Z M 8547.2 2079V 543H 8721.2V 722H 8741.2Q 8760.2 692 8794.2 646.5Q 8828.2 601 8892.2 565Q 8956.2 529 9065.2 529Q 9205.2 529 9311.7 599Q 9418.2 669 9478.7 798.5Q 9539.2 928 9539.2 1105Q 9539.2 1283 9479.2 1413Q 9419.2 1543 9312.7 1614Q 9206.2 1685 9066.2 1685Q 8960.2 1685 8895.2 1648.5Q 8830.2 1612 8795.2 1565.5Q 8760.2 1519 8741.2 1488H 8727.2V 2079ZM 9039.2 1524Q 9144.2 1524 9214.7 1467.5Q 9285.2 1411 9320.7 1315.5Q 9356.2 1220 9356.2 1103Q 9356.2 987 9321.2 893.5Q 9286.2 800 9215.7 745Q 9145.2 690 9039.2 690Q 8885.2 690 8805.2 804Q 8725.2 918 8725.2 1103Q 8725.2 1290 8806.2 1407Q 8887.2 1524 9039.2 1524Z"/></svg></a>
        <a class="m-icon" href="#/settings" aria-label="Settings">${icon("spark")}</a>
      </div>
      <div class="tabs-bar">
        <button class="tab-arrow left" type="button" data-act="tab-scroll" data-dir="-1" aria-label="Scroll tabs left" hidden>${icon("chevL")}</button>
        <div class="tabs" role="tablist" aria-label="Home timeline">
          ${tabWithMenu("foryou", "For you")}
          ${tabWithMenu("following", "Following")}
          ${lists.map((l) => tabWithMenu("list:" + l.id, l.name)).join("")}
        </div>
        <button class="tab-arrow right" type="button" data-act="tab-scroll" data-dir="1" aria-label="Scroll tabs right" hidden>${icon("chevR")}</button>
        <button class="tab-manage" type="button" data-act="manage-tabs" aria-label="Manage tabs">${icon("sliders")}</button>
      </div>
      ${window.Spaces && window.Spaces.homeRow ? window.Spaces.homeRow() : ""}
    </div>`;
  }

  function tabChoice(role, attrs, text, on, glyph, control) {
    const mark = control === "radio"
      ? `<span class="tab-radio${on ? " on" : ""}" aria-hidden="true"></span>`
      : control === "check"
        ? `<span class="tab-check${on ? " on" : ""}" aria-hidden="true"></span>`
        : "";
    const checked = on == null ? "" : ` aria-checked="${on ? "true" : "false"}"`;
    return `<button type="button" role="${role}" class="tab-choice"${checked} ${attrs}><span class="tab-choice-ico">${menuIcon(glyph)}</span><span class="tab-choice-label">${esc(text)}</span>${mark}</button>`;
  }

  function tabMenu() {
    if (!STATE.tabMenu) return "";
    const which = STATE.tabMenu;
    const listId = which.indexOf("list:") === 0 ? which.slice(5) : "";
    const list = listId ? (STATE.settings.lists || []).find((item) => item.id === listId && item.pinned) : null;
    if (listId && !list) return "";
    let body = "";
    let label = "Home options";
    const viewItems = (tab) => {
      const view = tabView(tab);
      const item = (id, text) => tabChoice("menuitemradio", `data-act="tab-view" data-view="${id}" data-tab="${esc(tab)}"`, text, view === id, id === "reposts" ? "repost" : "posts", "radio");
      return `<div class="tab-menu-gap"></div><div class="tab-menu-label">Show</div>${item("all", "All posts")}${item("reposts", "Reposts only")}`;
    };
    if (which === "foryou") {
      label = "For you options";
      const box = (key, text, on, glyph) => tabChoice("menuitemcheckbox", `data-act="foryou-toggle" data-key="${key}"`, text, on, glyph, "check");
      body = box("reposts", "Show reposts", STATE.settings.forYouReposts !== false, "repost") + box("replies", "Show replies", STATE.settings.forYouReplies !== false, "reply") + viewItems("foryou");
    } else {
      label = list ? list.name + " options" : "Following options";
      const sort = list ? listSortOf(list) : (STATE.settings.followingSort === "popular" ? "popular" : "recent");
      const sortItem = (id, text) => tabChoice("menuitemradio", `data-act="follow-sort" data-sort="${id}"${list ? ` data-list="${esc(list.id)}"` : ""}`, text, sort === id, id === "popular" ? "rocket" : "clock", "radio");
      const extra = list ? `<div class="tab-menu-gap"></div><div class="tab-menu-label">List</div>${tabChoice("menuitem", `data-act="edit-list" data-id="${esc(list.id)}"`, "Edit list", null, "pencil", "")}${tabChoice("menuitem", `data-act="tab-unpin" data-id="${esc(list.id)}"`, "Unpin from Home", null, "pin", "")}` : "";
      body = `<div class="tab-menu-label">Sort by</div>${sortItem("recent", "Recent")}${sortItem("popular", "Popular")}` + viewItems(which) + extra;
    }
    const manage = `<div class="tab-menu-gap"></div>${tabChoice("menuitem", `data-act="manage-tabs"`, "Manage tabs", null, "gear", "")}`;
    return `<div class="tab-sheet" data-act="close-tab-menu"><div class="menu tab-menu" data-act="stop" role="menu" aria-label="${esc(label)}"><div class="tab-grab" aria-hidden="true"></div>${body}${manage}</div></div>`;
  }

  function bellMenu() {
    const menu = STATE.bellMenu;
    if (!menu || !menu.id) return "";
    const row = bellRecord(menu.id);
    const mode = row && (row.mode === "all" || row.mode === "live") ? row.mode : "off";
    const choice = (id, text, glyph) => {
      const on = mode === id;
      return `<button class="bell-choice" type="button" role="menuitemradio" aria-checked="${on ? "true" : "false"}" data-act="bell-mode" data-mode="${id}" data-id="${esc(menu.id)}"><span class="bell-choice-ico">${bellGlyph(glyph)}</span><span class="bell-choice-label">${text}</span><span class="bell-mark">${on ? icon("tick") : ""}</span></button>`;
    };
    return `<div class="bell-sheet" data-act="close-bell"><div class="menu bell-menu" data-act="stop" role="menu" aria-label="Notify"><div class="bell-grab" aria-hidden="true"></div>${choice("all", "All posts", "outline")}${choice("live", "Only posts with live video", "video")}${choice("off", "Off", "off")}<p class="bell-note">Without Web Push, alerts arrive when the app checks in the background (Android/Chrome installed app) or on next open (iOS).</p></div></div>`;
  }

  function listMembersPosts(list) {
    const ids = new Set(list.members || []);
    return posts().filter((p) => ids.has(p.feedId) || ids.has((p.platform || "x") + ":" + p.handle)).sort(byStamp);
  }

  function homeView(route) {
    const tab = route.tab || "foryou";
    let list = posts().filter((post) => homeShows(post, route));
    if (tabView(tab) === "reposts") list.sort(byRepostTime);
    else {
      list.sort(byStamp);
      if (tabSort(tab) === "popular") {
        const heat = (post) => {
          const stats = (post && post.stats) || {};
          return (Number(stats.likes) || 0) + (Number(stats.reposts) || 0) + (Number(stats.replies) || 0) + (Number(stats.quotes) || 0);
        };
        list.sort((a, b) => heat(b) - heat(a) || byStamp(a, b));
      }
    }
    const repostsOnly = tabView(tab) === "reposts";
    const body = list.length ? list.map((p, i) => card(p, null, { eager: i === 0 })).join("") : emptyBlock(
      repostsOnly ? "No reposts yet" : tab === "following" ? "Nothing to see here — yet" : tab.startsWith("list:") ? "No posts in this List" : "No posts yet",
      repostsOnly ? "Reposts and forwards on this tab show up here." : tab === "following" ? "When you follow accounts, their posts show up here." : tab.startsWith("list:") ? "Posts from members of this List will show up here." : "Posts from your feeds will show up here."
    );
    const spaceCard = window.Spaces && window.Spaces.homeCard ? window.Spaces.homeCard() : "";
    return homeHeader(tab) + spaceCard + body + archiveSentinel();
  }

  function pageHead(title, extra, back, action) {
    return `<div class="topbar tall"><div class="mhead">
        <button class="m-ava" data-act="drawer" aria-label="Menu"><span class="ava initials">Y</span></button>
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

  function stampActivity(posts, nowMs) {
    const now = nowMs || Date.now();
    let index = 0;
    const timeOf = (post) => {
      const parsed = Date.parse(isoDate((post && (post.sortDate || post.date)) || ""));
      return isFinite(parsed) ? parsed : 0;
    };
    while (index < posts.length) {
      const post = posts[index];
      if (!post || post.kind !== "repost" || post.sortDate) { index += 1; continue; }
      const start = index;
      while (index < posts.length && posts[index] && posts[index].kind === "repost" && !posts[index].sortDate) index += 1;
      const run = posts.slice(start, index);
      const anchor = index < posts.length ? timeOf(posts[index]) : 0;
      let ceiling = now;
      if (start > 0) ceiling = timeOf(posts[start - 1]) || now;
      if (!anchor || ceiling <= anchor) continue;
      const behind = run.some((item) => {
        const posted = Date.parse(isoDate(item.date || ""));
        return !isFinite(posted) || posted < anchor;
      });
      if (!behind) continue;
      const step = (ceiling - anchor) / (run.length + 1);
      run.forEach((item, offset) => {
        let stamp = ceiling - step * (offset + 1);
        if (stamp <= anchor) stamp = anchor + Math.max(1000, (run.length - offset) * 1000);
        if (stamp >= ceiling) stamp = ceiling - (offset + 1) * 1000;
        item.sortDate = isoDate(Math.round(stamp));
      });
    }
  }

  function fxLivePost(status) {
    const wrapped = status && status.tweet && typeof status.tweet === "object" ? status.tweet : status;
    const post = fxFromStatus(wrapped);
    if (!post) return null;
    const by = fxPerson(wrapped.reposted_by || wrapped.retweeted_by);
    if (by && by.handle) {
      post.repostedBy = by;
      post.kind = "repost";
      const who = String(by.handle).replace(/^@/, "").toLowerCase();
      if (who && post.statusId) post.id = "repost:" + who + ":" + post.statusId;
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
    if (kind === "replies" || kind === "home") query.push("with_replies=1");
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
      stampActivity(posts);
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
      if (rt) {
        post.repostedBy = { name: rt[1], handle: rt[1], avatar: "" };
        post.id = "repost:" + String(rt[1]).toLowerCase() + ":" + statusId;
      }
      if (fxOwned(post, handle) || (post.repostedBy && String(post.repostedBy.handle).toLowerCase() === handle.toLowerCase())) out.push(post);
    }
    stampActivity(out);
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
    const ownerId = String(video.authorId || "");
    const profileId = String((profile && profile.channelId) || "");
    const shared = !!(ownerId && profileId && ownerId !== profileId);
    const post = {
      id: shared ? ("repost:" + String((profile && (profile.displayHandle || profile.handle)) || "channel").toLowerCase() + ":" + id) : id,
      statusId: id,
      platform: "youtube",
      kind: shared ? "repost" : "post",
      watch: true,
      author: shared ? (video.author || "") : ((profile && profile.name) || video.author || ""),
      handle: shared ? "" : ((profile && profile.displayHandle) || ""),
      profileHandle: shared ? ownerId : ((profile && (profile.channelId || profile.handle)) || ""),
      avatar: shared ? (ivBest(video.authorThumbnails) || "") : ((profile && profile.avatar) || ""),
      verifiedType: shared ? "" : (profile && profile.verifiedType),
      title: video.title || "",
      text: video.title || "",
      description: video.description || "",
      date: ivPublish(video),
      url: "https://www.youtube.com/watch?v=" + id,
      media: [{ type: "video", url: "", poster: poster, duration: video.lengthSeconds, videoId: id }],
      stats: { views: video.viewCount }
    };
    if (shared) {
      post.channelId = ownerId;
      post.repostedBy = {
        name: (profile && profile.name) || "",
        handle: (profile && profile.displayHandle) || "",
        avatar: (profile && profile.avatar) || "",
        platform: "youtube",
        feedId: (profile && profile.id) || "",
        channelId: profileId
      };
    }
    return post;
  }

  function ivCommunityPost(item, profile) {
    const id = item && item.commentId;
    if (!id) return null;
    const built = communityFromIv(item, {
      author: (profile && profile.name) || "",
      avatar: (profile && profile.avatar) || "",
      date: ""
    });
    const post = {
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
      date: ivPublish(item),
      url: "https://www.youtube.com/post/" + id,
      media: (built && built.media) || [],
      stats: { likes: item.likeCount, replies: item.replyCount }
    };
    if (built && built.poll) post.poll = built.poll;
    return claimCommunityVideo(post, profile);
  }

  function claimCommunityVideo(post, profile) {
    const clip = ((post && post.media) || []).find((item) => item && item.type === "video" && item.videoId);
    if (!clip || !clip.authorId) return post;
    const profileId = String((profile && profile.channelId) || "");
    if (profileId && clip.authorId === profileId) return post;
    const owner = {
      name: clip.author || "",
      channelId: clip.authorId,
      avatar: clip.authorAvatar || "",
      title: clip.alt || ""
    };
    if (!owner.name) return post;
    applyVideoOwner(post, owner);
    return post;
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
    const knownFeed = catalogAccount(platform, handle) || findFeed(platform, handle);
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

  function ytImage(url) {
    const text = String(url || "");
    try {
      const parsed = new URL(text);
      const host = parsed.searchParams.get("host") || "";
      if (/piped/i.test(parsed.hostname) && /^(yt3\.googleusercontent\.com|yt3\.ggpht\.com|i\.ytimg\.com)$/.test(host)) {
        return "https://" + host + parsed.pathname;
      }
    } catch (err) { /* keep the original address */ }
    return text;
  }

  function ytProfileFromPiped(data, requested) {
    const id = (data && data.id) || requested;
    const known = catalogAccount("youtube", id) || catalogAccount("youtube", requested);
    const subs = Number(data && data.subscriberCount);
    return {
      id: known && known.id ? known.id : "youtube:" + id,
      platform: "youtube",
      handle: id,
      displayHandle: (known && known.handle) || "",
      channelId: id,
      name: (data && data.name) || (known && known.name) || id,
      avatar: ytImage((data && data.avatarUrl) || (known && known.avatar) || ""),
      banner: ytImage((data && data.bannerUrl) || (known && known.banner) || ""),
      bio: (data && data.description) || (known && known.bio) || "",
      location: "",
      website: "",
      joined: "",
      following: null,
      followers: isFinite(subs) && subs > 0 ? subs : (known && known.followers != null ? known.followers : null),
      postsCount: null,
      verifiedType: data && data.verified ? "blue" : ((known && known.verifiedType) || ""),
      url: "https://www.youtube.com/channel/" + id
    };
  }

  function pipedVideoPosts(data, profile) {
    const out = [];
    ((data && data.relatedStreams) || []).forEach((video) => {
      if (!video) return;
      const fromUrl = String(video.url || "").match(/[?&]v=([A-Za-z0-9_-]{6,})/);
      const id = video.videoId || (fromUrl && fromUrl[1]);
      const post = ivVideoPost({
        videoId: id,
        title: video.title,
        thumbnail: ytImage(video.thumbnail) || (id ? "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg" : ""),
        videoThumbnails: id ? [{ url: "https://i.ytimg.com/vi/" + id + "/hqdefault.jpg", width: 480 }] : [],
        lengthSeconds: video.duration,
        viewCount: video.views,
        published: video.uploaded,
        author: video.uploaderName
      }, profile);
      if (post) out.push(post);
    });
    return out;
  }

  function pipedBases() {
    const prefer = LIVE.pipedBase;
    const list = [];
    if (prefer && !LIVE.dead[prefer]) list.push(prefer);
    PIPED_SEEDS.forEach((base) => {
      if (list.indexOf(base) < 0 && !LIVE.dead[base]) list.push(base);
    });
    if (list.length) return list;
    return PIPED_SEEDS.slice();
  }

  function pipedGet(path) {
    const list = pipedBases();
    let index = 0;
    function next() {
      if (index >= list.length) return Promise.resolve(null);
      const base = list[index++];
      return fetchJson(base.replace(/\/$/, "") + path).then((data) => {
        delete LIVE.dead[base];
        LIVE.pipedBase = base;
        return data;
      }).catch((err) => {
        if (!(err && (err.status === 404 || err.status === 500))) LIVE.dead[base] = true;
        return next();
      });
    }
    return next();
  }

  function loadPipedChannel(handle) {
    const id = String(handle || "").replace(/^@/, "");
    if (!id) return Promise.resolve(null);
    const uc = /^UC[\w-]{10,}$/.test(id);
    const paths = uc
      ? ["/channel/" + encodeURIComponent(id)]
      : ["/c/" + encodeURIComponent(id), "/user/" + encodeURIComponent(id), "/channel/" + encodeURIComponent(id)];
    let index = 0;
    function step() {
      if (index >= paths.length) {
        if (uc) return Promise.resolve(null);
        return pipedGet("/search?q=" + encodeURIComponent(id) + "&filter=channels").then((found) => {
          const items = (found && found.items) || [];
          const lower = id.toLowerCase();
          const hit = items.find((item) => item && String(item.name || "").toLowerCase() === lower)
            || items.find((item) => item && String(item.url || "").toLowerCase().indexOf(lower) >= 0)
            || items[0];
          const match = String((hit && hit.url) || "").match(/\/channel\/(UC[\w-]{10,})/);
          if (!match) return null;
          return pipedGet("/channel/" + encodeURIComponent(match[1])).then((data) => (data && (data.name || data.id) ? data : null));
        });
      }
      return pipedGet(paths[index++]).then((data) => {
        if (data && (data.name || data.bannerUrl || data.avatarUrl)) return data;
        return step();
      });
    }
    return step();
  }

  function pipedSearchVideos(query, channelId, name) {
    const q = String(query || channelId || "").trim();
    if (!q) return Promise.resolve([]);
    return pipedGet("/search?q=" + encodeURIComponent(q) + "&filter=videos").then((data) => {
      const id = String(channelId || "");
      const who = String(name || "").toLowerCase();
      return ((data && data.items) || []).filter((video) => {
        if (!video) return false;
        const url = String(video.uploaderUrl || "");
        if (id && url.indexOf(id) >= 0) return true;
        if (who && String(video.uploaderName || "").toLowerCase() === who) return true;
        return false;
      });
    }).catch(() => []);
  }

  function finishYt(row, profile, videos, community) {
    const list = videos || [];
    const job = list.length
      ? Promise.resolve(list)
      : pipedSearchVideos(profile.name || profile.channelId || profile.handle, profile.channelId, profile.name).then((items) => pipedVideoPosts({ relatedStreams: items }, profile));
    return job.then((rows) => applyYtChannel(row, profile, rows, community || [], ""));
  }

  function applyYtChannel(row, profile, videos, community, cursor) {
    row.profile = profile;
    row.videos = videos || [];
    row.community = community || [];
    row.cursor.videos = cursor || "";
    row.limited = false;
    row.videos.forEach(rememberLive);
    row.community.forEach(rememberLive);
    if (!row.videos.length && !row.community.length) row.error = "thin";
    row.fetchedAt = Date.now();
  }

  function loadYtLive(row, handle) {
    const miss = () => loadPipedChannel(handle).then((piped) => {
      if (piped && (piped.name || piped.bannerUrl || piped.avatarUrl)) {
        const profile = ytProfileFromPiped(piped, handle);
        return finishYt(row, profile, pipedVideoPosts(piped, profile), []);
      }
      row.profile = limitedProfile("youtube", handle);
      row.limited = true;
      row.error = "thin";
      row.fetchedAt = Date.now();
    });
    return loadYtChannel(handle).then((data) => {
      if (!data || !data.authorId) return miss();
      const profile = ytProfileFromChannel(data, handle);
      const videos = ivVideoPosts({ videos: data.latestVideos || [] }, profile);
      const id = data.authorId;
      return Promise.all([
        rotate(ivBases(), "/api/v1/channels/" + encodeURIComponent(id) + "/videos", 4, "ivBase").catch(() => null),
        rotate(ivBases(), "/api/v1/channels/" + encodeURIComponent(id) + "/community", 4, "ivBase").catch(() => null)
      ]).then((pair) => {
        const page = pair[0];
        const extra = ivVideoPosts(page, profile);
        const seen = {};
        videos.forEach((post) => { seen[post.id] = true; });
        extra.forEach((post) => {
          if (seen[post.id]) return;
          seen[post.id] = true;
          videos.push(post);
        });
        const community = ((pair[1] && pair[1].comments) || []).map((item) => ivCommunityPost(item, profile)).filter((post) => post && post.text);
        if (!videos.length) return finishYt(row, profile, [], community);
        applyYtChannel(row, profile, videos, community, (page && page.continuation) || "");
      });
    }).catch(() => miss());
  }

  function loadLimited(row, platform, handle) {
    row.profile = limitedProfile(platform, handle);
    row.limited = true;
    row.fetchedAt = Date.now();
    return Promise.resolve();
  }

  function loadTelegramSaved(row, handle) {
    const feed = findFeed("telegram", handle);
    const profile = limitedProfile("telegram", handle);
    if (feed) {
      ["name", "avatar", "banner", "bannerColor", "bio", "location", "website", "joined", "verifiedType", "url"].forEach((key) => {
        if (feed[key]) profile[key] = feed[key];
      });
      if (feed.followers != null) profile.followers = feed.followers;
      if (feed.following != null) profile.following = feed.following;
      if (feed.postsCount != null) profile.postsCount = feed.postsCount;
      profile.id = feed.id || profile.id;
    }
    row.profile = profile;
    row.posts = [];
    absorbSaved(row);
    row.media = (row.posts || []).filter((post) => (post.media || []).some((item) => item && item.type !== "file" && item.type !== "audio" && (item.url || item.poster)));
    row.limited = !feed && !(row.posts || []).length;
    if ((row.posts || []).length) row.saved = false;
    row.fetchedAt = Date.now();
    return Promise.resolve();
  }

  function loadVkSaved(row, handle) {
    const feed = findFeed("vk", handle);
    const profile = limitedProfile("vk", handle);
    if (feed) {
      ["name", "avatar", "banner", "bio", "location", "website", "joined", "verifiedType", "url"].forEach((key) => {
        if (feed[key]) profile[key] = feed[key];
      });
      if (feed.followers != null) profile.followers = feed.followers;
      if (feed.following != null) profile.following = feed.following;
      if (feed.postsCount != null) profile.postsCount = feed.postsCount;
      profile.id = feed.id || profile.id;
    }
    row.profile = profile;
    row.posts = [];
    absorbSaved(row);
    row.limited = !(row.posts || []).length;
    if ((row.posts || []).length) row.saved = false;
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
      : platform === "vk" ? Promise.resolve(limitedProfile("vk", clean))
      : platform === "telegram" ? Promise.resolve(limitedProfile("telegram", clean))
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
      : platform === "vk" ? loadVkSaved(row, clean)
      : platform === "telegram" ? loadTelegramSaved(row, clean)
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
    if (!row) return [];
    if ((row.platform || "") === "telegram") return [["posts", "Posts"], ["media", "Media"]];
    if (row.limited) return [];
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

  function profileLinkLabel(platform) {
    return PLATFORM[platform] || "Web";
  }

  function userView(route) {
    if (window.FeedsPeople) {
      const merged = window.FeedsPeople.page(route);
      if (merged) return merged;
    }
    const known = catalogAccount(route.platform, route.handle);
    if (known && known.handle) {
      const tab = route.query.get("tab") || "";
      const next = profileHash(known.platform, known.handle) + (tab && tab !== "posts" ? "?tab=" + encodeURIComponent(tab) : "");
      if ((location.hash || "") !== next) {
        setTimeout(() => {
          if ((location.hash || "") !== next) location.replace(next);
        }, 0);
        return `<div class="reply-empty">Loading…</div>`;
      }
    }
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
    const banner = profile.banner ? `<img class="pbanner" src="${esc(profile.banner)}" alt="" referrerpolicy="no-referrer">` : profile.bannerColor ? `<div class="pbanner theme" style="background:${esc(profile.bannerColor)}"></div>` : `<div class="pbanner"></div>`;
    const meta = [
      profile.location ? `<span>${icon("loc")}${esc(profile.location)}</span>` : "",
      profile.website ? `<a data-act="stop" href="${esc(profile.website)}" target="_blank" rel="noopener noreferrer">${icon("link")}${esc(String(profile.website).replace(/^https?:\/\//, ""))}</a>` : "",
      profile.joined ? `<span>${icon("cal")}${esc(joinedLabel(profile.joined))}</span>` : ""
    ].join("");
    const counts = audienceCounts(profile);
    const count = profile.postsCount != null ? formatCount(profile.postsCount) + " posts" : "";
    const tabHtml = tabs.map((pair) => {
      const href = accountHash(profile.platform, profile.channelId || profile.handle) + (pair[0] === tabs[0][0] ? "" : "?tab=" + pair[0]);
      return `<a class="tab${tab === pair[0] ? " on" : ""}" role="tab" aria-selected="${tab === pair[0] ? "true" : "false"}" href="${esc(href)}"><span>${pair[1]}</span></a>`;
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
      row.error === "thin" && !row.saved ? "The live timeline didn’t load from the public sources." : (tab === "replies" ? "Replies from this account will show up here." : tab === "media" ? "Photos and videos from this account will show up here." : "Posts from this account will show up here.")
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
        ${window.Spaces && window.Spaces.avatar ? window.Spaces.avatar(avatar(profile.avatar, profile.name, "pava"), profile.platform, profile.handle) : avatar(profile.avatar, profile.name, "pava")}
        <div class="pactions">
          <button class="icon-btn" type="button" data-act="share" data-kind="profile" data-id="${esc(profile.id || (profile.platform + ":" + profile.handle))}" aria-label="Share">${icon("share")}</button>
          ${bellButton(liveFollowId(profile), profile.handle)}
          ${followButtonClean(liveFollowId(profile), true)}
          <a class="outline" data-act="stop" target="_blank" rel="noopener noreferrer" href="${esc(externalProfile(profile))}" aria-label="${esc(openLabel(profile.platform))}">${esc(profileLinkLabel(profile.platform))}</a>
        </div>
      </div>
      <h1 class="pname">${esc(profile.name || profile.handle)}${badge(profile.verifiedType)}</h1>
      ${shown ? `<div class="phandle">@${esc(shown)}</div>` : ""}
      ${bioBlock(profile)}
      ${meta ? `<div class="pmeta">${meta}</div>` : ""}
      ${counts}
      ${fresh}
      ${limited}
      ${saved}
      ${note}
    </div>
    ${window.Spaces && window.Spaces.profileCard ? window.Spaces.profileCard(profile.platform, profile.handle) : ""}
    ${tabs.length ? `<div class="tabs ptabs" role="tablist" aria-label="Profile">${tabHtml}</div>` : ""}
    ${body}${more}`;
  }

  function profileView(route) {
    posts().forEach(creditCarried);
    if (window.FeedsPeople) {
      const merged = window.FeedsPeople.page(route);
      if (merged) return merged;
    }
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
    const loaded = postsFor(feed);
    const carriedOnly = loaded.filter((post) => carriedBy(post, feed) && !sameAuthor(post, feed)).length;
    const own = loaded.filter((post) => post.kind !== "reply" && !(carriedBy(post, feed) && !sameAuthor(post, feed))).length;
    let total = own;
    if (feed.postsCount != null && !feed.postsCountIncludesReposts) total = Number(feed.postsCount);
    else if (feed.postsCount != null) total = Math.max(own, Number(feed.postsCount) - carriedOnly);
    let list = loaded.slice();
    if (youtube && tab === "videos") list = list.filter((post) => isVideoPost(post) && !isRepost(post));
    else if (youtube && tab === "community") list = list.filter((p) => p.kind === "community");
    else if (tab === "replies") list = list.filter((p) => p.kind === "reply");
    else if (tab === "media") list = list.filter((p) => (p.media || []).length);
    else list = list.filter((p) => p.kind !== "reply");
    const count = formatCount(total);
    const banner = feed.banner ? `<img class="pbanner" src="${esc(feed.banner)}" alt="">` : feed.bannerColor ? `<div class="pbanner theme" style="background:${esc(feed.bannerColor)}"></div>` : `<div class="pbanner"></div>`;
    const meta = [
      feed.location ? `<span>${icon("loc")}${esc(feed.location)}</span>` : "",
      feed.website ? `<a href="${esc(feed.website)}" target="_blank" rel="noopener noreferrer">${icon("link")}${esc(String(feed.website).replace(/^https?:\/\//, ""))}</a>` : "",
      feed.joined ? `<span>${icon("cal")}${esc(joinedLabel(feed.joined))}</span>` : ""
    ].join("");
    const counts = audienceCounts(feed, feed.platform === "youtube" || feed.platform === "telegram" ? "Subscribers" : feed.platform === "discord" ? "Members" : "Followers");
    const tabIds = youtube ? [["posts", "Posts"], ["videos", "Videos"], ["community", "Community"]] : feed.platform === "telegram" ? [["posts", "Posts"], ["media", "Media"]] : [["posts", "Posts"], ["replies", "Replies"], ["media", "Media"]];
    const tabs = tabIds.map((pair) => {
      const id = pair[0];
      const href = profileHash(feed.platform, feed.handle) + (id === "posts" ? "" : "?tab=" + id);
      return `<a class="tab${tab === id ? " on" : ""}" role="tab" aria-selected="${tab === id ? "true" : "false"}" href="${esc(href)}"><span>${pair[1]}</span></a>`;
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
        ${window.Spaces && window.Spaces.avatar ? window.Spaces.avatar(avatar(feed.avatar, feed.name, "pava"), feed.platform, feed.handle) : avatar(feed.avatar, feed.name, "pava")}
        <div class="pactions">
          <button class="icon-btn" type="button" data-act="share" data-kind="profile" data-id="${esc(feed.id)}" aria-label="Share">${icon("share")}</button>
          ${bellButton(feed.id, feed.handle)}
          ${followButtonClean(feed.id, true)}
          <a class="outline" target="_blank" rel="noopener noreferrer" href="${esc(externalProfile(feed))}" aria-label="View on ${esc(PLATFORM[feed.platform] || "web")}">${esc(profileLinkLabel(feed.platform))}</a>
        </div>
      </div>
      <h1 class="pname">${esc(feed.name || feed.handle)}${badge(feed.verifiedType)}</h1>
      <div class="phandle">@${esc(feed.handle)}</div>
      ${bioBlock(feed)}
      ${meta ? `<div class="pmeta">${meta}</div>` : ""}
      ${counts}
    </div>
    ${window.Spaces && window.Spaces.profileCard ? window.Spaces.profileCard(feed.platform, feed.handle) : ""}
    <div class="tabs ptabs" role="tablist" aria-label="Profile">${tabs}</div>
    ${list.length ? list.map((p) => {
      return card(p, carriedBy(p, feed) ? "" : "author");
    }).join("") : emptyBlock(
      tab === "replies" ? "No replies yet" : tab === "media" ? "No media yet" : tab === "videos" ? "No videos yet" : tab === "community" ? "No community posts yet" : "No posts yet",
      tab === "replies" ? "Replies by this account will show up here." : tab === "community" ? "Community posts from this channel will show up here." : "Posts from this account will show up here."
    )}` + archiveSentinel();
  }

  function statusView(route) {
    let post = findPost(route.platform, route.handle, route.id);
    if (!post && (route.platform === "instagram" || route.platform === "threads" || route.platform === "youtube")) {
      const archived = (ARCHIVE.posts || []).find((item) => item && item.p === route.platform && String(item.id) === String(route.id));
      const knownShape = route.platform !== "youtube" || ytVideoId(route.id) || !!(archived && archived.k);
      if (knownShape) {
        post = expandStub(archived || { p: route.platform, id: route.id, h: route.handle });
        if (post) STATE.shared[String(route.id)] = post;
      }
    }
    if (post && post.tombstone) {
      return `<div class="topbar"><div class="page-head"><button class="icon-btn" data-act="back" aria-label="Back">${icon("back")}</button><h1 class="grow">Post</h1></div></div>` + tombstoneCard(post);
    }
    if (post) {
      creditCarried(post);
      rememberOpened(post);
      if (countsAsArticle(post) && STATE.notedStatus !== post.id) {
        STATE.notedStatus = post.id;
        noteArticle(post, {});
      }
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
    const talk = telegramTalk(post);
    const slice = talk == null ? replySlice(post) : { loading: false, shown: [] };
    const threaded = !slice.loading && slice.shown.length > 0 && sameThread(post, slice.shown[0]);
    const replyLine = post.replyingTo && post.replyingTo.handle ? `<div class="replying" style="margin-top:12px">Replying to <a data-card="${esc((post.platform || "x") + ":" + post.replyingTo.handle)}" href="${esc(accountHash(post.platform, post.replyingTo.handle))}">@${esc(post.replyingTo.handle)}</a></div>` : "";
    const parentCard = post.platform === "telegram" && post.replyParent ? contextCard(post.replyParent) : "";
    const body = `${parentCard}${forwardLine(post)}${replyLine}
        ${textBlock(post, post.id, true, "status-text")}
        ${hiddenPost(post) ? `<p class="phandle">Muted on this device.</p>` : ""}
        ${pollHtml(post)}
        ${discordMeta(post)}
        ${articleCardHtml(post)}
        ${mediaHtml(post.media, false, post)}
        ${postCards(post)}
        ${quoteCard(post.quoted)}
        <div class="status-time">${esc(fullTime(post.date))}${post.edited ? " · Edited" : ""}${post.url ? ` · <a target="_blank" rel="noopener noreferrer" href="${esc(post.url)}">View on ${esc(PLATFORM[post.platform] || "web")}</a>` : ""}</div>
        ${stats.views != null ? `<div class="status-views"><b>${esc(formatCount(stats.views))}</b> Views</div>` : `<div class="status-views"></div>`}
        ${actionBar(post)}`;
    const face = authorFace(post);
    const names = `<div>
            <a class="name" data-card="${esc((post.platform || "x") + ":" + (post.handle || ""))}" href="${esc(accountHash(post.platform, post.handle))}">${esc(post.author || "")}${badge(face.verified)}</a>
            <a class="handle" data-card="${esc((post.platform || "x") + ":" + (post.handle || ""))}" href="${esc(accountHash(post.platform, post.handle))}">@${esc(post.handle || "")}</a>
          </div>
          <span style="margin-left:auto;display:flex;gap:8px;align-items:center">${(post.platform === "discord" && post.guildId) || post.handle ? followButtonClean(post.platform === "discord" && post.guildId ? "discord:" + post.guildId : (post.platform || "x") + ":" + post.handle) : ""}${sourceBadge(post.platform)}</span>`;
    const parented = chain.nodes.length > 0 ? " has-parent" : "";
    const article = threaded
      ? `<article class="status has-thread${parented}"><div class="status-thread"><div class="ava-col"><a data-card="${esc((post.platform || "x") + ":" + (post.handle || ""))}" href="${esc(accountHash(post.platform, post.handle))}" aria-label="${esc(post.author || post.handle || "Profile")}">${avatar(face.avatar, post.author)}</a><div class="thread-line"></div></div><div class="status-main"><div class="status-author">${names}</div>${body}</div></div></article>`
      : `<article class="status${parented}"><div class="status-author"><a data-card="${esc((post.platform || "x") + ":" + (post.handle || ""))}" href="${esc(accountHash(post.platform, post.handle))}" aria-label="${esc(post.author || post.handle || "Profile")}">${avatar(face.avatar, post.author)}</a>${names}</div>${body}</article>`;
    return `<div class="topbar"><div class="page-head"><button class="icon-btn" data-act="back" aria-label="Back">${icon("back")}</button><h1 class="grow">Post</h1></div></div>
      ${ancestorBlock(post, chain)}
      ${repostBanner(post)}
      ${article}
      ${talk == null ? composer(threaded) + replyList(post) : talk}`;
  }

  function telegramTalk(post) {
    if (!post || post.platform !== "telegram") return null;
    if (!post.discussion) return "";
    const handle = post.handle || "";
    const id = post.statusId || post.id || "";
    const src = "https://t.me/" + encodeURIComponent(handle) + "/" + encodeURIComponent(id) + "?embed=1&discussion=1";
    return `<div class="tg-comments"><iframe src="${esc(src)}" title="Telegram comments" loading="lazy" referrerpolicy="no-referrer"></iframe></div>`;
  }

  function exploreView(route) {
    const q = (route.query.get("q") || "").trim();
    const lq = q.toLowerCase();
    let body = emptyBlock("Search posts and accounts", "Try a name, @handle, or a word from a post.");
    if (lq) {
      const accounts = shownFeeds(feeds()).filter((f) => !matchesMute(STATE.settings.mutedAccounts, f.handle, f.platform, f.id) && (f.name + " " + f.handle + " " + (f.aliases || "") + " " + (f.bio || "")).toLowerCase().includes(lq));
      const found = posts().filter((p) => !hiddenPost(p) && (p.text + " " + p.author + " " + p.handle + " " + ((p.article && ((p.article.title || "") + " " + (p.article.preview || ""))) || "") + " " + ((p.quoted && p.quoted.text) || "") + " " + ((p.quoted && p.quoted.article && p.quoted.article.title) || "")).toLowerCase().includes(lq)).sort(byStamp);
      const acct = accounts.length ? `<section class="card"><h2>Accounts</h2>${accounts.map(accountRow).join("")}</section>` : "";
      body = acct + (found.length ? found.map((p) => card(p)).join("") : emptyBlock("No results", "Nothing matched “" + q + "”."));
    }
    return `<div class="topbar explore-bar"><div class="page-head"><h1>Explore</h1></div>
      <form data-act="search-form" class="explore-form"><label class="search"><span>${icon("search")}</span><input id="explore-q" value="${esc(q)}" placeholder="Search" aria-label="Search"></label></form></div>${body}`;
  }

  function accountRow(f, opts) {
    const remove = opts && opts.remove && f.configured
      ? `<button type="button" class="follow remove-pill" data-act="ask-remove" data-id="${esc(f.id)}">Remove</button>`
      : "";
    const follow = followButtonClean(f.id);
    const actions = remove ? `<span class="row-actions">${follow}${remove}</span>` : follow;
    return `<div class="acct-row"><a class="who-main" href="${esc(accountHash(f.platform, f.channelId || f.handle))}" data-card="${esc(f.id)}">${avatar(f.avatar, f.name)}<span class="who-copy"><span class="name">${esc(f.name)}${badge(f.verifiedType)}</span><span class="handle">@${esc(f.handle)}</span></span></a>${actions}</div>`;
  }

  function feedsView() {
    const list = shownFeeds(feeds().slice()).sort((a, b) => Number(b.configured) - Number(a.configured) || (a.name || "").localeCompare(b.name || ""));
    const box = `<form class="add-account"><label class="search"><span>${icon("search")}</span><input id="add-account" placeholder="Add account URL or @handle" aria-label="Add account"></label><button class="follow" type="submit">Add</button></form>`;
    return pageHead("Feeds") + box + (list.length ? `<div>${list.map((f) => accountRow(f, { remove: true })).join("")}</div>` : emptyBlock("No accounts", "Paste a profile URL or @handle above."));
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
    const items = listMembersPosts(list).filter((post) => inTimeline(post) && !hiddenPost(post));
    return `<div class="topbar"><div class="page-head">
        <button class="icon-btn" data-act="back" aria-label="Back">${icon("back")}</button>
        <div class="head-text grow"><div class="pt-name">${esc(list.name)}</div><div class="pt-count">${(list.members || []).length} members</div></div>
        <button class="icon-btn pin${list.pinned ? " on" : ""}" data-act="pin" data-id="${esc(list.id)}" aria-label="Pin list">${icon("pin")}</button>
      </div></div>
      <div class="list-banner" style="background:${esc(list.bannerColor || COLORS[0])}"></div>
      <div class="list-body">
        <div class="list-tools"><div><h1>${esc(list.name)}</h1>${list.description ? `<div class="bio">${esc(list.description)}</div>` : ""}<div class="phandle">${(list.members || []).length} Members</div></div>
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

  const HIST_KEY = "rss-feeds-history-v1";
  const HIST_CAP = 2000;
  const HIST_TABS = ["bookmarks", "likes", "videos", "articles"];

  function cleanHistoryPause(raw) {
    const src = raw && typeof raw === "object" ? raw : {};
    return { videos: src.videos === true, articles: src.articles === true };
  }

  function historyPaused(tab) {
    const pause = (STATE.settings && STATE.settings.historyPause) || {};
    return tab === "videos" ? !!pause.videos : tab === "articles" ? !!pause.articles : false;
  }

  function histEnsure() {
    if (!STATE.history) STATE.history = { bookmarks: [], likes: [], videos: [], articles: [] };
    return STATE.history;
  }

  function histFind(tab, id) {
    const key = String(id || "");
    return (histEnsure()[tab] || []).find((row) => row && row.id === key) || null;
  }

  function histDb() {
    if (STATE.histDb) return Promise.resolve(STATE.histDb);
    if (STATE.histDbWait) return STATE.histDbWait;
    STATE.histDbWait = new Promise((resolve) => {
      if (!window.indexedDB) { resolve(null); return; }
      let req;
      try { req = indexedDB.open("superintel-history", 1); }
      catch (err) { resolve(null); return; }
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("entries")) db.createObjectStore("entries", { keyPath: "key" });
      };
      req.onsuccess = () => { STATE.histDb = req.result; resolve(req.result); };
      req.onerror = () => resolve(null);
    });
    return STATE.histDbWait;
  }

  function histPut(entry) {
    if (!entry || !entry.key) return;
    histDb().then((db) => {
      if (!db) return;
      try { db.transaction("entries", "readwrite").objectStore("entries").put(entry); }
      catch (err) { /* the mirror in localStorage still has the row */ }
    });
  }

  function histDrop(key) {
    if (!key) return;
    histDb().then((db) => {
      if (!db) return;
      try { db.transaction("entries", "readwrite").objectStore("entries").delete(key); }
      catch (err) { /* ignore */ }
    });
  }

  function histMirror() {
    const slim = {};
    HIST_TABS.forEach((tab) => {
      slim[tab] = (histEnsure()[tab] || []).slice(0, HIST_CAP).map((row) => {
        const copy = Object.assign({}, row);
        if (copy.post && copy.post.article && Array.isArray(copy.post.article.blocks) && copy.post.article.blocks.length > 30) {
          const article = Object.assign({}, copy.post.article, { blocks: copy.post.article.blocks.slice(0, 30) });
          copy.post = Object.assign({}, copy.post, { article: article });
        }
        return copy;
      });
    });
    try { localStorage.setItem(HIST_KEY, JSON.stringify(slim)); }
    catch (err) {
      HIST_TABS.forEach((tab) => {
        slim[tab] = (slim[tab] || []).slice(0, 80).map((row) => {
          if (row.post && row.post.article) {
            const article = Object.assign({}, row.post.article);
            delete article.blocks;
            row = Object.assign({}, row, { post: Object.assign({}, row.post, { article: article }) });
          }
          return row;
        });
      });
      try { localStorage.setItem(HIST_KEY, JSON.stringify(slim)); } catch (err2) { /* quota */ }
    }
  }

  function flushHist() {
    const pending = STATE.histPending || {};
    STATE.histPending = {};
    Object.keys(pending).forEach((key) => histPut(pending[key]));
    histMirror();
  }

  function queueHist(entry, soon) {
    STATE.histPending = STATE.histPending || {};
    STATE.histPending[entry.key] = entry;
    clearTimeout(STATE.histTimer);
    STATE.histTimer = setTimeout(flushHist, soon ? 40 : 700);
  }

  function readHistLocal() {
    try {
      const doc = JSON.parse(localStorage.getItem(HIST_KEY) || "{}");
      const rows = [];
      HIST_TABS.forEach((tab) => ((doc && doc[tab]) || []).forEach((row) => rows.push(row)));
      return rows;
    } catch (err) { return []; }
  }

  function histLoad() {
    if (STATE.histLoading) return STATE.histLoading;
    STATE.histLoading = histDb().then((db) => new Promise((resolve) => {
      const finish = (rows) => {
        const bag = { bookmarks: [], likes: [], videos: [], articles: [] };
        (rows || []).forEach((row) => {
          if (!row || !bag[row.tab] || !row.id) return;
          bag[row.tab].push(row);
        });
        const pending = STATE.history;
        if (pending) {
          HIST_TABS.forEach((tab) => {
            (pending[tab] || []).forEach((row) => {
              const idx = bag[tab].findIndex((item) => item.id === row.id);
              if (idx < 0) bag[tab].unshift(row);
              else if ((row.at || 0) >= (bag[tab][idx].at || 0)) bag[tab][idx] = row;
            });
          });
        }
        HIST_TABS.forEach((tab) => {
          bag[tab].sort((a, b) => (b.at || 0) - (a.at || 0));
          bag[tab] = bag[tab].slice(0, HIST_CAP);
        });
        STATE.history = bag;
        resolve(bag);
      };
      if (!db) { finish(readHistLocal()); return; }
      let req;
      try { req = db.transaction("entries", "readonly").objectStore("entries").getAll(); }
      catch (err) { finish(readHistLocal()); return; }
      req.onsuccess = () => finish(req.result && req.result.length ? req.result : readHistLocal());
      req.onerror = () => finish(readHistLocal());
    })).then(() => histMirror());
    return STATE.histLoading;
  }

  function slimArticle(article) {
    if (!article || typeof article !== "object") return null;
    const out = {
      id: String(article.id || ""),
      title: String(article.title || ""),
      preview: String(article.preview || "").slice(0, 700),
      cover: String(article.cover || ""),
      url: String(article.url || "")
    };
    if (Array.isArray(article.blocks) && article.blocks.length) {
      out.blocks = article.blocks.slice(0, 80).map((block) => {
        if (!block || typeof block !== "object") return null;
        const row = { type: String(block.type || "paragraph") };
        if (block.text) row.text = String(block.text).slice(0, 2000);
        if (block.url) row.url = String(block.url);
        if (block.tweetId) row.tweetId = String(block.tweetId);
        if (block.poster) row.poster = String(block.poster);
        if (block.alt) row.alt = String(block.alt);
        if (block.title && block.type !== "paragraph") row.title = String(block.title);
        if (Array.isArray(block.styles) && block.styles.length) row.styles = block.styles.slice(0, 20);
        if (Array.isArray(block.links) && block.links.length) row.links = block.links.slice(0, 20);
        return row;
      }).filter(Boolean);
    }
    if (!out.title && !out.cover && !out.preview && !(out.blocks || []).length) return null;
    return out;
  }

  function histUpsert(tab, post, extra) {
    extra = extra || {};
    if ((tab === "videos" || tab === "articles") && historyPaused(tab)) return;
    const id = String((post && post.id) || extra.id || "");
    if (!id || !HIST_TABS.includes(tab)) return;
    if (extra.touch === false) {
      const prev = histFind(tab, id);
      if (prev) {
        const pos = extra.position != null ? Number(extra.position) : Number(prev.position) || 0;
        const scroll = extra.scroll != null ? Number(extra.scroll) : Number(prev.scroll) || 0;
        const progress = extra.progress != null ? Number(extra.progress) : Number(prev.progress) || 0;
        if (Math.abs((Number(prev.position) || 0) - pos) < 1.5 && Math.abs((Number(prev.scroll) || 0) - scroll) < 0.012 && Math.abs((Number(prev.progress) || 0) - progress) < 0.02) return;
      }
    }
    const prev = histFind(tab, id);
    const slim = post ? slimPost(post) : (prev && prev.post) || null;
    if (slim && post && post.article) slim.article = slimArticle(post.article);
    if (slim && post && post.link && post.link.url) {
      slim.link = { url: post.link.url || "", title: post.link.title || "", description: post.link.description || "", image: post.link.image || "", site: post.link.site || "" };
    }
    const entry = {
      key: tab + ":" + id,
      tab: tab,
      id: id,
      at: extra.touch === false && prev ? (prev.at || Date.now()) : Date.now(),
      platform: (post && post.platform) || (prev && prev.platform) || (slim && slim.platform) || "",
      progress: extra.progress != null ? Number(extra.progress) || 0 : (prev && prev.progress) || 0,
      position: extra.position != null ? Number(extra.position) || 0 : (prev && prev.position) || 0,
      duration: extra.duration != null ? Number(extra.duration) || 0 : (prev && prev.duration) || 0,
      scroll: extra.scroll != null ? Number(extra.scroll) || 0 : (prev && prev.scroll) || 0,
      post: slim || (prev && prev.post) || null
    };
    if (extra.at != null) entry.at = extra.at;
    const list = (histEnsure()[tab] || []).filter((row) => row && row.id !== id);
    list.unshift(entry);
    list.sort((a, b) => (b.at || 0) - (a.at || 0));
    while (list.length > HIST_CAP) {
      const gone = list.pop();
      if (gone) histDrop(gone.key);
    }
    STATE.history[tab] = list;
    queueHist(entry, extra.touch !== false);
  }

  function histRemove(tab, id) {
    const key = String(id || "");
    STATE.history = histEnsure();
    (STATE.history[tab] || []).forEach((row) => {
      if (!row || row.id !== key) return;
      histDrop(row.key);
      if (STATE.histPending) delete STATE.histPending[row.key];
    });
    STATE.history[tab] = (STATE.history[tab] || []).filter((row) => row && row.id !== key);
    histMirror();
  }

  function wipeHistory(tab) {
    if (HIST_TABS.indexOf(tab) < 0) return;
    if (tab === "bookmarks") {
      STATE.settings.bookmarks = {};
      STATE.settings.savedPosts = {};
      saveSettings();
    } else if (tab === "likes") {
      STATE.settings.likes = {};
      saveSettings();
    }
    (histEnsure()[tab] || []).forEach((row) => {
      if (!row || !row.key) return;
      histDrop(row.key);
      if (STATE.histPending) delete STATE.histPending[row.key];
    });
    STATE.history[tab] = [];
    histMirror();
  }

  function histSyncSaves() {
    const run = () => {
      ["likes", "bookmarks"].forEach((bucket) => {
        const map = (STATE.settings && STATE.settings[bucket]) || {};
        Object.keys(map).forEach((id) => {
          if (!map[id] || histFind(bucket, id)) return;
          const post = findAnyPost(id) || ((STATE.settings.savedPosts || {})[id]) || null;
          const at = typeof map[id] === "number" ? map[id] : 1;
          histUpsert(bucket, post, { id: id, at: at, touch: false });
        });
      });
    };
    if (STATE.histLoading) return STATE.histLoading.then(run);
    run();
    return Promise.resolve();
  }

  function noteVideo(post, extra) {
    if (!post || !post.id || historyPaused("videos")) return;
    const media = post.media || [];
    const gifOnly = media.length > 0 && media.every((item) => item && item.type === "animated_gif") && !media.some((item) => youtubeId(post, item));
    if (gifOnly) return;
    const video = (post.platform === "youtube" && post.kind !== "community") || post.watch || media.some((item) => item && item.type === "video") || media.some((item) => youtubeId(post, item));
    if (!video) return;
    histUpsert("videos", post, extra || {});
  }

  function videoProgress(post) {
    if (!post || !post.id) return 0;
    const row = histFind("videos", post.id);
    if (!row) return 0;
    if (row.duration > 1 && row.position > 0) return Math.max(0, Math.min(1, row.position / row.duration));
    return Math.max(0, Math.min(1, Number(row.progress) || 0));
  }

  function noteArticle(post, extra) {
    if (!post || !post.id || historyPaused("articles")) return;
    histUpsert("articles", post, extra || {});
  }

  function countsAsArticle(post) {
    if (!post) return false;
    if (articleOf(post)) return true;
    if (post.platform === "rss") return true;
    const text = String(post.text || post.title || post.description || "");
    return text.length >= 480;
  }

  function articleUrlIn(text) {
    const match = String(text || "").match(/https?:\/\/(?:www\.)?(?:x|twitter)\.com\/(?:i\/article\/|(?:[A-Za-z0-9_]{1,30})\/article\/)([A-Za-z0-9]+)/i);
    return match ? { id: match[1], url: match[0] } : null;
  }

  function articleOf(post) {
    const art = post && post.article;
    if (!art || typeof art !== "object") return null;
    if (art.title || art.cover || art.preview || (art.blocks || []).length) return art;
    return null;
  }

  function articleHash(post) {
    const art = articleOf(post) || {};
    const id = art.id || (post && (post.statusId || post.id)) || "";
    return "#/article/" + encodeURIComponent(id);
  }

  function displayPost(post) {
    if (!articleOf(post)) return post;
    const text = String(post.text || "").replace(/https?:\/\/(?:www\.)?(?:x|twitter)\.com\/(?:i\/article\/[A-Za-z0-9]+|(?:[A-Za-z0-9_]{1,30})\/article\/[A-Za-z0-9]+)\S*/gi, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
    if (text === String(post.text || "").trim()) return post;
    return Object.assign({}, post, { text: text });
  }

  function isArticleLink(link, post) {
    if (!articleOf(post)) return false;
    const url = String((link && link.url) || "");
    return !!articleUrlIn(url);
  }

  function articleCardHtml(post) {
    const art = articleOf(post);
    if (!art || !post) return "";
    const cover = art.cover ? `<img class="xa-cover" src="${esc(art.cover)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : "";
    const title = art.title ? `<div class="xa-title">${esc(art.title)}</div>` : "";
    const preview = art.preview ? `<div class="xa-preview">${esc(art.preview)}</div>` : "";
    return `<a class="xa" href="${esc(articleHash(post))}" data-act="open-article" data-id="${esc(post.id)}">${cover}<div class="xa-copy">${title}${preview}<span class="xa-label">${icon("article")}<span>Article</span></span></div></a>`;
  }

  function watchArticle(post) {
    if (!post || articleOf(post)) return;
    const blob = [post.text, post.url, post.link && post.link.url].concat((post.links || []).map((item) => (item && (item.url || item.expanded_url)) || ""), (post.cards || []).map((item) => (item && item.url) || "")).join(" ");
    if (!articleUrlIn(blob)) return;
    const sid = String(post.statusId || post.id || "");
    if (!/^\d{6,}$/.test(sid)) return;
    STATE.articleTried = STATE.articleTried || {};
    if (STATE.articleTried[sid] || (STATE.articleFlight || 0) >= 2) return;
    STATE.articleTried[sid] = true;
    STATE.articleFlight = (STATE.articleFlight || 0) + 1;
    pullArticle(sid).then((art) => {
      STATE.articleFlight = Math.max(0, (STATE.articleFlight || 1) - 1);
      if (!art) return;
      post.article = art;
      render();
    }).catch(() => { STATE.articleFlight = Math.max(0, (STATE.articleFlight || 1) - 1); });
  }

  function pullArticle(id) {
    return fetchJson(FX + "/2/status/" + encodeURIComponent(id)).then((data) => {
      const status = fxStatusObject(data) || data;
      return articleFromStatus(status);
    }).catch(() => null);
  }

  function normalizeArticle(raw) {
    if (!raw || typeof raw !== "object") return null;
    if (raw.preview != null && raw.preview_text == null && raw.content == null && raw.cover_media == null) {
      const title = String(raw.title || "").trim();
      const preview = String(raw.preview || "").trim();
      const cover = String(raw.cover || "").trim();
      const blocks = Array.isArray(raw.blocks) ? raw.blocks : [];
      if (!title && !preview && !cover && !blocks.length) return null;
      const out = { id: String(raw.id || ""), title: title, preview: preview, cover: cover, url: String(raw.url || "") };
      if (blocks.length) out.blocks = blocks;
      return out;
    }
    const title = String(raw.title || "").trim();
    const preview = String(raw.preview_text || raw.preview || raw.description || "").trim();
    const articleId = String(raw.id || raw.rest_id || raw.article_id || "").trim();
    let cover = "";
    if (typeof raw.cover_url === "string") cover = raw.cover_url;
    else if (typeof raw.image === "string") cover = raw.image;
    const media = raw.cover_media || raw.cover || {};
    if (!cover && typeof media === "string") cover = media;
    if (!cover && media && typeof media === "object") {
      const info = media.media_info || media.mediaInfo || {};
      cover = info.original_img_url || info.url || media.url || media.media_url_https || "";
    }
    const url = String(raw.url || "") || (articleId ? "https://x.com/i/article/" + articleId : "");
    const blocks = articleBlocks(raw);
    if (!title && !preview && !cover && !blocks.length) return null;
    const out = { id: articleId, title: title, preview: preview, cover: String(cover || ""), url: url };
    if (blocks.length) out.blocks = blocks;
    return out;
  }

  function articleEntityMap(content) {
    const raw = content && content.entityMap;
    const pairs = [];
    if (Array.isArray(raw)) raw.forEach((item) => { if (item && item.key != null) pairs.push([item.key, item.value]); });
    else if (raw && typeof raw === "object") Object.keys(raw).forEach((key) => pairs.push([key, raw[key]]));
    const out = {};
    pairs.forEach((pair) => {
      const value = pair[1];
      if (!value || typeof value !== "object") return;
      const data = value.data && typeof value.data === "object" ? value.data : {};
      const entry = { type: String(value.type || "") };
      const tweet = data.tweetId || data.tweet_id || "";
      if (tweet) entry.tweetId = String(tweet);
      const media = data.media && typeof data.media === "object" ? data.media : {};
      const info = media.media_info && typeof media.media_info === "object" ? media.media_info : data;
      let url = "";
      [info, data, media].forEach((src) => {
        if (!src || typeof src !== "object" || url) return;
        url = src.original_img_url || src.media_url_https || src.url || "";
      });
      if (url) entry.url = String(url);
      const poster = info && (info.preview_image_url || info.thumbnail_url) || "";
      if (poster) entry.poster = String(poster);
      if (data.title || data.name) entry.title = String(data.title || data.name);
      out[String(pair[0])] = entry;
    });
    return out;
  }

  function articleBlocks(raw) {
    const content = raw.content || raw.content_state || {};
    if (!content || typeof content !== "object" || !Array.isArray(content.blocks)) return [];
    const entities = articleEntityMap(content);
    const map = { unstyled: "paragraph", "header-one": "h1", "header-two": "h2", "header-three": "h3", blockquote: "quote", "unordered-list-item": "ul", "ordered-list-item": "ol", atomic: "atomic" };
    const resolved = [];
    content.blocks.slice(0, 400).forEach((block) => {
      if (!block || typeof block !== "object") return;
      const kind = map[String(block.type || "unstyled")] || "paragraph";
      const text = String(block.text || "");
      if (kind === "atomic") {
        let ent = null;
        (block.entityRanges || []).some((ref) => {
          ent = entities[String(ref && ref.key)];
          return !!ent;
        });
        if (!ent) return;
        const etype = String(ent.type || "").toUpperCase();
        if (etype === "TWEET" && ent.tweetId) resolved.push({ type: "embed", tweetId: ent.tweetId });
        else if (ent.url && (etype.indexOf("VIDEO") >= 0 || etype === "ANIMATED_GIF")) {
          const row = { type: "video", url: ent.url };
          if (ent.poster) row.poster = ent.poster;
          resolved.push(row);
        } else if (ent.url && (etype === "IMAGE" || etype === "MEDIA" || etype === "PHOTO")) resolved.push({ type: "image", url: ent.url, alt: ent.title || "" });
        else if (ent.url) resolved.push({ type: "link", url: ent.url, title: ent.title || ent.url });
        return;
      }
      const row = { type: kind, text: text };
      const styles = [];
      (block.inlineStyleRanges || []).slice(0, 40).forEach((style) => {
        const start = Number(style && style.offset) || 0;
        const length = Number(style && style.length) || 0;
        const name = String((style && style.style) || "");
        if (length > 0 && name) styles.push({ start: start, end: start + length, style: name });
      });
      if (styles.length) row.styles = styles;
      const links = [];
      const data = block.data && typeof block.data === "object" ? block.data : {};
      [["urls", ""], ["mentions", "https://x.com/"], ["hashtags", "https://x.com/hashtag/"]].forEach((bucket) => {
        (data[bucket[0]] || []).slice(0, 20).forEach((span) => {
          const label = String((span && span.text) || "");
          const start = Number(span && span.fromIndex) || 0;
          const end = Number(span && span.toIndex) || 0;
          if (!label || end <= start) return;
          const href = bucket[0] === "urls" ? label : bucket[1] + label.replace(/^[#@]/, "");
          links.push({ start: start, end: end, url: href });
        });
      });
      if (links.length) row.links = links;
      if (!text.trim() && !links.length) return;
      resolved.push(row);
    });
    return resolved;
  }

  function articleFromUrls(entities) {
    const urls = entities && Array.isArray(entities.urls) ? entities.urls : (Array.isArray(entities) ? entities : []);
    for (let i = 0; i < urls.length; i++) {
      const entry = urls[i];
      if (!entry || typeof entry !== "object") continue;
      const expanded = entry.expanded_url || entry.unwound_url || entry.url || "";
      const found = articleUrlIn(expanded);
      if (!found) continue;
      let cover = "";
      const images = entry.images || entry.image || [];
      if (Array.isArray(images) && images[0]) cover = typeof images[0] === "string" ? images[0] : (images[0].url || "");
      else if (typeof images === "string") cover = images;
      return normalizeArticle({ id: found.id, title: entry.title || "", preview_text: entry.description || "", url: expanded, cover_url: cover });
    }
    return null;
  }

  function articleFromStatus(status) {
    if (!status || typeof status !== "object") return null;
    if (status.article && typeof status.article === "object") {
      const found = normalizeArticle(status.article);
      if (found) return found;
    }
    return articleFromUrls(status.entities);
  }

  function inlineRich(block) {
    const text = String((block && block.text) || "");
    const points = [0, text.length];
    (block.styles || []).forEach((span) => { points.push(Number(span.start) || 0, Number(span.end) || 0); });
    (block.links || []).forEach((span) => { points.push(Number(span.start) || 0, Number(span.end) || 0); });
    const cuts = points.filter((n, i, all) => n >= 0 && n <= text.length && all.indexOf(n) === i).sort((a, b) => a - b);
    let out = "";
    for (let i = 0; i < cuts.length - 1; i++) {
      const a = cuts[i];
      const b = cuts[i + 1];
      let chunk = esc(text.slice(a, b));
      if (!chunk) continue;
      (block.styles || []).forEach((span) => {
        if (span.start > a || span.end < b) return;
        if (span.style === "Bold") chunk = "<strong>" + chunk + "</strong>";
        else if (span.style === "Italic") chunk = "<em>" + chunk + "</em>";
        else if (span.style === "Strikethrough") chunk = "<s>" + chunk + "</s>";
      });
      const link = (block.links || []).find((span) => span.start <= a && span.end >= b);
      if (link && link.url) chunk = `<a href="${esc(link.url)}" target="_blank" rel="noopener noreferrer">${chunk}</a>`;
      out += chunk;
    }
    return out || esc(text);
  }

  function readingMinutes(art) {
    let words = 0;
    ((art && art.blocks) || []).forEach((block) => {
      words += String((block && block.text) || "").split(/\s+/).filter(Boolean).length;
    });
    if (!words) words = String((art && art.preview) || "").split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 220) || 1);
  }

  function articleBlockHtml(block) {
    if (!block) return "";
    if (block.type === "h1" || block.type === "h2") return `<h2 class="xa-h">${inlineRich(block)}</h2>`;
    if (block.type === "h3") return `<h3 class="xa-h">${inlineRich(block)}</h3>`;
    if (block.type === "quote") return `<blockquote>${inlineRich(block)}</blockquote>`;
    if (block.type === "image" && block.url) return `<img class="xa-img" src="${esc(block.url)}" alt="${esc(block.alt || "")}" loading="lazy" referrerpolicy="no-referrer">`;
    if (block.type === "video" && block.url) return `<video class="xa-video" controls playsinline ${block.poster ? `poster="${esc(block.poster)}"` : ""} src="${esc(block.url)}"></video>`;
    if (block.type === "link" && block.url) return `<a class="xa-link" href="${esc(block.url)}" target="_blank" rel="noopener noreferrer">${esc(block.title || block.url)}</a>`;
    if (block.type === "embed" && block.tweetId) {
      const known = findAnyPost(block.tweetId);
      if (known) return `<div class="xa-embed">${quoteCard(known)}</div>`;
      if ((STATE.embedBudget || 0) < 6) {
        STATE.embedBudget = (STATE.embedBudget || 0) + 1;
        hydrateEmbed(block.tweetId);
      }
      return `<a class="xa-embed-link" href="#/x/i/status/${encodeURIComponent(block.tweetId)}">View post</a>`;
    }
    if (block.type === "ul" || block.type === "ol") return "";
    return `<p>${inlineRich(block)}</p>`;
  }

  function articleBodyHtml(art) {
    const blocks = (art && art.blocks) || [];
    if (!blocks.length) {
      const preview = art && art.preview ? `<div class="xa-fallback">${esc(art.preview)}</div>` : "";
      const href = (art && art.url) || "";
      const btn = href ? `<a class="xa-full" target="_blank" rel="noopener noreferrer" href="${esc(href)}">Read full article on X</a>` : "";
      return preview + btn;
    }
    let html = "";
    let i = 0;
    while (i < blocks.length) {
      const block = blocks[i];
      if (block && (block.type === "ul" || block.type === "ol")) {
        const tag = block.type;
        let items = "";
        while (i < blocks.length && blocks[i] && blocks[i].type === tag) {
          items += `<li>${inlineRich(blocks[i])}</li>`;
          i += 1;
        }
        html += `<${tag}>${items}</${tag}>`;
        continue;
      }
      html += articleBlockHtml(block);
      i += 1;
    }
    if (art.url) html += `<p class="xa-view"><a target="_blank" rel="noopener noreferrer" href="${esc(art.url)}">View on X</a></p>`;
    return html;
  }

  function hydrateEmbed(id) {
    const key = String(id || "");
    if (!key) return;
    STATE.embedPosts = STATE.embedPosts || {};
    if (STATE.embedPosts[key] || findAnyPost(key)) return;
    STATE.embedPosts[key] = "loading";
    fxStatusPost(key).then((post) => {
      STATE.embedPosts[key] = post || "miss";
      if (post) STATE.shared[String(post.statusId || post.id)] = post;
      if (parseRoute().name === "article") render();
    }).catch(() => { STATE.embedPosts[key] = "miss"; });
  }

  function ensureArticleBody(post) {
    const art = articleOf(post);
    if (!art || (art.blocks || []).length) return;
    const sid = String((post && (post.statusId || post.id)) || "");
    if (!/^\d{6,}$/.test(sid)) return;
    STATE.articleBodyTried = STATE.articleBodyTried || {};
    if (STATE.articleBodyTried[sid]) return;
    STATE.articleBodyTried[sid] = true;
    pullArticle(sid).then((next) => {
      if (!next || !(next.blocks || []).length) return;
      post.article = next;
      const live = posts().find((item) => item && (item.id === post.id || String(item.statusId || "") === sid));
      if (live && live !== post) live.article = next;
      if (parseRoute().name === "article") render();
    }).catch(() => {});
  }

  function findArticle(id) {
    const key = String(id || "");
    const pool = posts().slice();
    Object.keys(STATE.shared || {}).forEach((name) => { if (STATE.shared[name]) pool.push(STATE.shared[name]); });
    (histEnsure().articles || []).forEach((row) => { if (row && row.post) pool.push(row.post); });
    Object.keys((STATE.settings && STATE.settings.savedPosts) || {}).forEach((name) => {
      const saved = STATE.settings.savedPosts[name];
      if (saved) pool.push(saved);
    });
    return pool.find((post) => {
      if (!post) return false;
      const art = post.article || {};
      return String(art.id || "") === key || String(post.id || "") === key || String(post.statusId || "") === key;
    }) || null;
  }

  function articleScroll(id) {
    const post = findArticle(id);
    if (!post) return 0;
    const row = histFind("articles", post.id);
    return row ? Number(row.scroll) || 0 : 0;
  }

  function articleHead() {
    return `<div class="topbar"><div class="page-head"><button class="icon-btn" data-act="back" aria-label="Back">${icon("back")}</button><h1 class="grow">Article</h1></div></div>`;
  }

  function articleDate(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear();
  }

  function articleView(route) {
    const post = findArticle(route.id);
    if (!post || !articleOf(post)) {
      return articleHead() + emptyBlock("Article isn’t available", "This article isn’t in the current snapshot.");
    }
    ensureArticleBody(post);
    if (STATE.notedArticle !== post.id) {
      STATE.notedArticle = post.id;
      noteArticle(post, {});
    }
    const art = articleOf(post);
    const minutes = readingMinutes(art);
    const face = authorFace(post);
    const who = post.handle || "";
    const followId = (post.platform === "discord" && post.guildId) ? "discord:" + post.guildId : (post.platform || "x") + ":" + who;
    const cover = art.cover ? `<img class="xa-cover-lg" src="${esc(art.cover)}" alt="" referrerpolicy="no-referrer">` : "";
    const when = articleDate(post.date);
    return `${articleHead()}<article class="xa-page">
      ${cover}
      <h1 class="xa-title-lg">${esc(art.title || "Article")}</h1>
      <div class="xa-author">
        <a href="${esc(accountHash(post.platform, who))}" data-card="${esc((post.platform || "x") + ":" + who)}" aria-label="${esc(post.author || who || "Profile")}">${avatar(face.avatar || post.avatar, post.author)}</a>
        <div class="who">
          <a class="name" href="${esc(accountHash(post.platform, who))}" data-card="${esc((post.platform || "x") + ":" + who)}">${esc(post.author || who)}${badge(face.verified || post.verifiedType)}</a>
          ${who ? `<a class="handle" href="${esc(accountHash(post.platform, who))}">@${esc(who)}</a>` : ""}
        </div>
        ${who ? followButtonClean(followId) : ""}
      </div>
      <div class="xa-date">${esc(when)}${when ? " · " : ""}${minutes} min read</div>
      ${actionBar(post)}
      <div class="xa-body">${articleBodyHtml(art)}</div>
    </article>`;
  }

  function histPost(row) {
    const live = findAnyPost(row.id);
    const snap = row.post;
    if (live && snap && snap.article && !articleOf(live)) return Object.assign({}, live, { article: snap.article });
    return live || snap;
  }

  function histHay(row) {
    const post = (row && row.post) || {};
    const art = post.article || {};
    return [post.author, post.handle, post.text, post.title, art.title, art.preview, row.platform, PLATFORM[row.platform] || ""].join(" ").toLowerCase();
  }

  function histRows(tab) {
    const q = String(STATE.histQ || "").trim().toLowerCase();
    const plat = STATE.histPlat || "";
    const present = {};
    (histEnsure()[tab] || []).forEach((row) => { if (row && row.platform) present[row.platform] = true; });
    return (histEnsure()[tab] || []).filter((row) => {
      if (!row || !histPost(row)) return false;
      if (plat && present[plat] && row.platform !== plat) return false;
      if (q && histHay(row).indexOf(q) < 0) return false;
      return true;
    }).slice(0, HIST_CAP);
  }

  function histDay(at) {
    const ms = Number(at) || 0;
    if (ms < 100000) return "Earlier";
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    if (ms >= start) return "Today";
    if (ms >= start - 86400000) return "Yesterday";
    return "Earlier";
  }

  function histList(rows) {
    let html = "";
    let day = "";
    rows.forEach((row) => {
      const label = histDay(row.at);
      if (label !== day) {
        day = label;
        html += `<div class="hist-day">${esc(label)}</div>`;
      }
      const post = histPost(row);
      if (post) html += card(post);
    });
    return html;
  }

  function histEmpty(tab, searching) {
    if (searching) return emptyBlock("No results", "Nothing in this tab matches your search.");
    if (tab === "likes") return emptyBlock("You don’t have any likes yet", "Tap the heart on any post to show it some love. When you do, it’ll show up here.");
    if (tab === "videos") return emptyBlock("No videos yet", "Videos you watch show up here, so you can pick up where you left off.");
    if (tab === "articles") return emptyBlock("No articles yet", "Articles and long posts you open show up here.");
    return emptyBlock("Save posts for later", "Bookmark posts to easily find them again in the future.");
  }

  function histChips(tab) {
    const present = {};
    (histEnsure()[tab] || []).forEach((row) => { if (row && row.platform) present[row.platform] = true; });
    const order = ["x", "youtube", "threads", "instagram", "vk", "rss", "discord", "telegram"].filter((name) => present[name]);
    if (!order.length) return "";
    const plat = order.indexOf(STATE.histPlat) >= 0 ? STATE.histPlat : "";
    const chips = [`<button class="hist-chip${!plat ? " on" : ""}" type="button" data-act="hist-chip" data-plat="">All</button>`];
    order.forEach((name) => {
      chips.push(`<button class="hist-chip${plat === name ? " on" : ""}" type="button" data-act="hist-chip" data-plat="${name}">${esc(PLATFORM[name] || name)}</button>`);
    });
    return `<div class="hist-chips" aria-label="Platforms">${chips.join("")}</div>`;
  }

  function historyView(route) {
    const tab = ["likes", "videos", "articles"].indexOf(route.tab) >= 0 ? route.tab : "bookmarks";
    const q = STATE.histQ || "";
    const rows = histRows(tab);
    const tabs = [["bookmarks", "Bookmarks"], ["likes", "Likes"], ["videos", "Videos"], ["articles", "Articles"]].map((item) => {
      return `<a class="tab${tab === item[0] ? " on" : ""}" href="#/history/${item[0]}"><span>${item[1]}</span></a>`;
    }).join("");
    const pause = tab === "videos" || tab === "articles"
      ? `<button class="outline hist-pause${historyPaused(tab) ? " on" : ""}" type="button" data-act="hist-pause" data-tab="${tab}">${historyPaused(tab) ? "Resume history" : "Pause history"}</button>`
      : "";
    const note = tab === "likes" ? `<p class="hist-note">Your likes are private. Only you can see them.</p>` : "";
    const body = rows.length ? histList(rows) : histEmpty(tab, !!String(q).trim() || !!(STATE.histPlat));
    return `<div class="topbar tall hist-bar"><div class="page-head"><button class="icon-btn hist-back" type="button" data-act="back" aria-label="Back">${icon("back")}</button><h1 class="grow">History</h1></div><div class="tabs" role="tablist" aria-label="History">${tabs}</div></div>
      <form class="hist-search"><label class="search"><span>${icon("search")}</span><input id="hist-q" type="search" value="${esc(q)}" placeholder="Search History" aria-label="Search History"></label></form>
      ${histChips(tab)}
      <div class="hist-tools">${pause}<button class="outline hist-clear" type="button" data-act="hist-clear" data-tab="${tab}">Clear all</button></div>
      ${note}
      ${body}`;
  }


  function bookmarksView() {
    const list = bookmarkedPosts();
    return pageHead("Bookmarks", `<div class="subhead">@reader</div>`) + (list.length ? list.map((p) => card(p)).join("") : emptyBlock("Save posts for later", "Bookmark posts to easily find them again in the future."));
  }

  function notesView(title, headline, body) {
    return pageHead(title) + emptyBlock(headline, body);
  }

  function notificationsView() {
    const notes = (STATE.settings && STATE.settings.bellNotes) || [];
    if (notes.length) {
      const newest = notes.reduce((max, note) => Math.max(max, Number(note.at) || 0), 0);
      if (newest && (Number(STATE.settings.bellRead) || 0) < newest) {
        STATE.settings.bellRead = Date.now();
        saveSettings();
        updateBadge(0);
      }
    }
    if (!notes.length) return notesView("Notifications", "Nothing to see here — yet", "From likes to reposts and a whole lot more, this is where all the action happens.");
    const rows = notes.map((note) => {
      const who = note.handle || note.name || "account";
      const face = note.avatar ? avatar(note.avatar, note.name || who) : "";
      const image = note.image ? `<img class="note-img" src="${esc(note.image)}" alt="">` : "";
      return `<article class="note-row"><div class="note-ico">${icon("bellOn")}</div><a class="note-main" href="${esc(note.hash || "#/")}"><div class="note-title">New post notifications for @${esc(who)}</div><div class="note-post">${face}<div class="note-copy"><b>${esc(note.name || who)}</b>${note.text ? `<p>${esc(note.text)}</p>` : ""}${image}</div></div></a></article>`;
    }).join("");
    return pageHead("Notifications") + `<div class="notes">${rows}</div>`;
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
    const autoplay = (STATE.settings && STATE.settings.autoplay) || "all";
    const themeBtn = (id, label) => `<button class="outline${appearance === id ? " on" : ""}" type="button" data-act="theme" data-theme="${id}">${label}</button>`;
    const autoBtn = (id, label) => `<button class="outline${autoplay === id ? " on" : ""}" type="button" data-act="autoplay" data-mode="${id}">${label}</button>`;
    const notifyOn = !!(STATE.settings && STATE.settings.notify && typeof Notification !== "undefined" && Notification.permission === "granted");
    return pageHead("Settings", "", true) + `<div class="modal-body">
      <p class="phandle">Follows, Lists, likes, bookmarks, and history stay in this browser.</p>
      <h2>Appearance</h2>
      <div class="theme-row">
        ${themeBtn("auto", "Auto")}
        ${themeBtn("default", "Default")}
        ${themeBtn("dim", "Dim")}
        ${themeBtn("lightsout", "Lights out")}
      </div>
      ${window.FeedsTV ? window.FeedsTV.settingsHtml() : ""}
      <h2>Accessibility</h2>
      <p class="phandle">Data · Autoplay videos</p>
      <div class="theme-row" role="group" aria-label="Autoplay videos">
        ${autoBtn("all", "On cellular and Wi-Fi")}
        ${autoBtn("wifi", "Wi-Fi only")}
        ${autoBtn("never", "Never")}
      </div>
      ${installControl()}
      ${window.FeedsTranslate ? window.FeedsTranslate.settingsHtml() : ""}
      <h2>Privacy</h2>
      <h3>Mute and block</h3>
      <p class="phandle">Muted words, muted accounts, and reposts you turn off stay on this device.</p>
      <form class="mute-form" data-mute="word"><label class="search"><input id="mute-word" placeholder="Word or phrase" aria-label="Mute a word" maxlength="80"></label><button class="follow" type="submit">Add</button></form>
      ${(STATE.settings.mutedWords || []).map((word) => `<div class="mute-row"><span>${esc(word)}</span><button type="button" data-act="unmute-word" data-word="${esc(word)}">Remove</button></div>`).join("")}
      <form class="mute-form" data-mute="account"><label class="search"><input id="mute-account" placeholder="@handle" aria-label="Mute an account" maxlength="80"></label><button class="follow" type="submit">Add</button></form>
      ${(STATE.settings.mutedAccounts || []).map((account) => `<div class="mute-row"><span>${esc(account)}</span><button type="button" data-act="unmute-account" data-account="${esc(account)}">Remove</button></div>`).join("")}
      <button class="primary" type="button" data-act="notify">${notifyOn ? "Notifications on" : "Notify me about new posts"}</button>
      <button class="primary" data-act="export">Export settings</button>
      <label class="primary import-btn">Import settings<input id="import-file" data-act="import" type="file" accept="application/json" hidden></label>
      <h2>About</h2>
      <p class="phandle">SuperintelApp. Posts from accounts you follow stay in this browser. Not affiliated with X.</p>
    </div>`;
  }

  function drawer() {
    if (!STATE.drawer) return "";
    return `<div class="drawer-back" data-act="close-drawer"><div class="drawer" data-act="stop">
      <div style="padding:16px 20px;display:flex;gap:12px;align-items:center"><span class="ava initials">Y</span><div><b>You</b><div class="phandle">@reader</div></div></div>
      <a href="#/lists">${icon("lists")} Lists</a>
      <a href="#/history">${icon("clock")} History</a>
      <a href="${subsHash(STATE.settings.subsGroup)}">${icon("subs")} Subscriptions</a>
      <a href="#/feeds">${icon("spark")} Feeds</a>
      <a href="#/settings">${icon("more")} Settings</a>
      ${isStandalone() ? "" : `<button class="linky" type="button" data-act="install">${icon("plus")} Install app</button>`}
    </div></div>`;
  }

  function removeFeedDialog() {
    const pending = STATE.removeFeed;
    if (!pending) return "";
    const handle = String(pending.handle || "").replace(/^@/, "");
    const title = handle ? "Remove @" + handle + "?" : "Remove this account?";
    const body = handle
      ? "@" + handle + " will be removed from the whole site, not just hidden from your feeds."
      : "This account will be removed from the whole site, not just hidden from your feeds.";
    return `<div class="modal-back remove-back" data-act="close-remove"><div class="modal remove-sheet" role="dialog" aria-modal="true" aria-labelledby="remove-title" data-act="stop"><div class="remove-grab" aria-hidden="true"></div><h2 id="remove-title">${esc(title)}</h2><p>${esc(body)}</p><button type="button" class="remove-go" data-act="confirm-remove">Remove</button><button type="button" class="remove-cancel" data-act="close-remove">Cancel</button></div></div>`;
  }

  function modal() {
    if (STATE.removeFeed) return removeFeedDialog();
    if (STATE.histClear) {
      const tab = STATE.histClear;
      const label = tab === "bookmarks" ? "bookmarks" : tab === "likes" ? "likes" : tab === "videos" ? "videos" : "articles";
      return `<div class="modal-back" data-act="close-modal"><div class="modal" role="dialog" style="max-width:320px;margin-top:20vh;padding:8px 0 16px" data-act="stop">
        <div class="modal-body"><h2>Clear all ${esc(label)}?</h2><p class="phandle">This removes them from this device only.</p>
        <button class="primary" data-act="hist-clear-go" style="background:#f4212e">Clear all</button>
        <button class="outline" data-act="close-modal" style="margin-left:8px">Cancel</button></div></div></div>`;
    }
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
    if (STATE.modal === "group") {
      const d = STATE.draft || { name: "", icon: "", members: [], gq: "" };
      const q = String(d.gq || "").trim().toLowerCase();
      const choices = groupChoices(d.members).filter((feed) => {
        if (!q) return true;
        const hay = ((feed.name || "") + " " + (feed.handle || "") + " " + (feed.platform || "")).toLowerCase();
        return hay.indexOf(q) >= 0;
      });
      const rows = choices.map((feed) => {
        const on = draftHas(d, feed);
        return `<button class="group-pick${on ? " on" : ""}" type="button" data-act="group-toggle" data-id="${esc(feed.id)}" aria-pressed="${on ? "true" : "false"}">${avatar(feed.avatar, feed.name)}<span class="who-copy"><span class="name">${esc(feed.name || feed.handle || "")}</span><span class="handle">${esc((PLATFORM[feed.platform] || feed.platform || "") + (feed.handle ? " · @" + feed.handle : ""))}</span></span><span class="tick" aria-hidden="true"></span></button>`;
      }).join("");
      const face = groupFace({ icon: d.icon, members: d.members }, true);
      const named = String(d.name || "").replace(/\s+/g, " ").trim();
      return `<div class="modal-back" data-act="close-modal"><div class="modal group-sheet" role="dialog" aria-label="${d.id ? "Edit group" : "New group"}" data-act="stop">
        <div class="share-grab" aria-hidden="true"></div>
        <div class="modal-head"><button class="icon-btn" type="button" data-act="close-modal" aria-label="Close">${icon("close")}</button><h2>${d.id ? "Edit group" : "New group"}</h2><button class="save" type="button" data-act="group-save"${named ? "" : " disabled"}>Save</button></div>
        <div class="modal-body">
          <div class="group-face">${face}</div>
          <label class="field"><span>Name</span><input id="group-name" data-field="name" maxlength="40" value="${esc(d.name || "")}"></label>
          <label class="field"><span>Icon</span><input id="group-icon" data-field="icon" maxlength="300" placeholder="https://" value="${esc(d.icon || "")}"></label>
          <input id="group-q" class="member-search" data-field="gq" placeholder="Search channels" value="${esc(d.gq || "")}">
          ${rows || emptyBlock("No channels", "Follow accounts that post videos, then pick them here.")}
          ${d.id ? `<button class="danger" type="button" data-act="group-delete" data-group="${esc(d.id)}">Delete group</button>` : ""}
          <button class="outline" type="button" data-act="group-publish">Save groups to the site</button>
        </div>
      </div></div>`;
    }
    if (STATE.modal === "tabs") {
      const pinned = STATE.settings.lists.filter((list) => list.pinned);
      const rows = pinned.map((list, index) => `<div class="acct-row tab-manage-row"><span class="color-chip" style="background:${esc(list.bannerColor || COLORS[0])}"></span><span class="who-copy"><span class="name">${esc(list.name)}</span><span class="handle">${(list.members || []).length} members</span></span><button class="icon-btn" type="button" data-act="tab-move" data-id="${esc(list.id)}" data-dir="-1" aria-label="Move ${esc(list.name)} left"${index === 0 ? " disabled" : ""}>${icon("chevL")}</button><button class="icon-btn" type="button" data-act="tab-move" data-id="${esc(list.id)}" data-dir="1" aria-label="Move ${esc(list.name)} right"${index === pinned.length - 1 ? " disabled" : ""}>${icon("chevR")}</button><button class="outline" type="button" data-act="tab-unpin" data-id="${esc(list.id)}">Unpin</button></div>`).join("");
      return `<div class="modal-back" data-act="close-modal"><div class="modal" role="dialog" aria-label="Manage tabs" data-act="stop">
        <div class="modal-head"><button class="icon-btn" type="button" data-act="close-modal" aria-label="Close">${icon("close")}</button><h2>Manage tabs</h2></div>
        <div class="modal-body">
          <div class="acct-row tab-manage-row locked"><span class="who-copy"><span class="name">For you</span><span class="handle">Always on Home</span></span></div>
          <div class="acct-row tab-manage-row locked"><span class="who-copy"><span class="name">Following</span><span class="handle">Always on Home</span></span></div>
          ${rows || `<p class="phandle">Pin a List to add it beside Following.</p>`}
        </div>
      </div></div>`;
    }
    return "";
  }

  function shell(main, route) {
    const wide = route.name === "subscriptions" || route.name === "watch" || route.name === "messages";
    const tall = route.name === "home" || wide || ["feeds", "lists", "bookmarks", "history", "settings", "notifications", "messages"].includes(route.name);
    const rowExtra = route.name === "home" && window.Spaces && window.Spaces.rowExtra ? window.Spaces.rowExtra() : 0;
    const top = (route.name === "messages" ? 0 : route.name === "explore" ? 124 : tall ? 106 : 53) + rowExtra;
    return `<button class="skip" type="button" data-act="skip">Skip to content</button><div class="app${wide ? " wide" : ""}">${nav(route)}<main class="center" tabindex="-1" style="--top:${top}px">${main}</main>${wide ? "" : sidebar()}</div>${bottom(route)}${drawer()}${shareSheet()}${modal()}${groupMenu()}${tabMenu()}${bellMenu()}`;
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
    if (isRepost(post)) {
      const creator = creatorOf(post);
      return {
        avatar: post.avatar || creator.avatar || "",
        verified: post.verifiedType || creator.verifiedType || ""
      };
    }
    const feed = feedOf(post);
    return {
      avatar: post.avatar || feed.avatar || "",
      verified: post.verifiedType || feed.verifiedType || ""
    };
  }

  function creatorOf(post) {
    if (!isRepost(post)) return feedOf(post);
    const platform = post.platform || "x";
    const handle = String(post.handle || "");
    const channel = String(post.channelId || "");
    const by = post.repostedBy || {};
    const reposterId = by.feedId || ((by.platform || platform) + ":" + (by.handle || ""));
    const known = (channel && feedById(platform + ":" + channel)) || findFeed(platform, handle) || (channel && findFeed(platform, channel)) || null;
    if (known && known.id !== reposterId) return known;
    return {
      id: platform + ":" + (channel || handle),
      platform: platform,
      handle: handle,
      channelId: channel,
      name: post.author || handle,
      avatar: post.avatar || "",
      verifiedType: post.verifiedType || "",
      followers: channel && SUB_COUNTS[channel] != null ? SUB_COUNTS[channel] : null
    };
  }

  function vkWallOwner(id) {
    const text = String(id || "");
    const cut = text.lastIndexOf("_");
    return cut > 0 ? text.slice(0, cut) : "";
  }

  function creditCarried(post) {
    if (!post) return post;
    const named = post.repostedBy && (post.repostedBy.name || post.repostedBy.handle);
    if (named) return post;
    const from = post.forwardedFrom;
    if (from && typeof from === "object" && (from.name || from.handle)) {
      const feed = feedOf(post);
      post.repostedBy = {
        name: post.author || feed.name || "",
        handle: String(post.handle || feed.handle || "").replace(/^@/, ""),
        avatar: post.avatar || feed.avatar || "",
        platform: post.platform || feed.platform || "",
        feedId: post.feedId || feed.id || ""
      };
      post.author = from.name || from.handle || "";
      post.handle = String(from.handle || "").replace(/^@/, "");
      post.avatar = from.avatar || "";
      post.verifiedType = "";
      if (!post.kind || post.kind === "post") post.kind = "repost";
      return post;
    }
    if ((post.platform || "") !== "vk" || post.kind === "reply" || post.kind === "quote" || post.kind === "repost") return post;
    const feed = feedById(post.feedId);
    if (!feed) return post;
    const handle = String(post.handle || "").replace(/^@/, "").toLowerCase();
    const wall = String(feed.handle || "").replace(/^@/, "").toLowerCase();
    if (!handle || handle === wall) return post;
    const owner = vkWallOwner(post.statusId || post.id);
    if (!owner) return post;
    let known = false;
    let sawWall = false;
    posts().forEach((row) => {
      if (!row || row.feedId !== feed.id || row.platform !== "vk") return;
      if (String(row.handle || "").replace(/^@/, "").toLowerCase() !== wall) return;
      const id = vkWallOwner(row.statusId || row.id);
      if (!id) return;
      sawWall = true;
      if (id === owner) known = true;
    });
    if (!sawWall || known) return post;
    post.repostedBy = {
      name: feed.name || feed.handle || "",
      handle: feed.handle || "",
      avatar: feed.avatar || "",
      platform: "vk",
      feedId: feed.id || ""
    };
    if (!post.kind || post.kind === "post") post.kind = "repost";
    return post;
  }

  function carriedBy(post, feed) {
    if (!post || !feed) return false;
    creditCarried(post);
    if (!isRepost(post)) return false;
    const by = post.repostedBy || {};
    if (by.feedId && by.feedId === feed.id) return true;
    const handle = String(by.handle || "").replace(/^@/, "").toLowerCase();
    const platform = by.platform || post.platform || "";
    return !!(handle && handle === String(feed.handle || "").replace(/^@/, "").toLowerCase() && platform === (feed.platform || ""));
  }

  function repostBanner(post, mode) {
    if (!post || mode === "author" || mode === "status" || !isRepost(post)) return "";
    const by = post.repostedBy || {};
    const name = String(by.name || by.handle || "").trim();
    if (!name) return `<div class="repost-line">${icon("repost")}<span>Reposted</span></div>`;
    const platform = by.platform || post.platform || "x";
    const who = by.channelId || by.handle || "";
    const label = esc(by.name || by.handle) + " reposted";
    if (!who) return `<div class="repost-line">${icon("repost")}<span>${label}</span></div>`;
    return `<div class="repost-line">${icon("repost")}<a data-act="stop" data-card="${esc(platform + ":" + who)}" href="${esc(accountHash(platform, who))}">${label}</a></div>`;
  }

  function repostQuote(post, mode) {
    if (!post || mode === "author" || mode === "status" || !isRepost(post)) return "";
    const text = String(post.repostComment || "").trim();
    if (!text) return "";
    const by = post.repostedBy || {};
    const platform = by.platform || post.platform || "x";
    const who = by.channelId || by.handle || "";
    const href = post.repostUrl || (who ? accountHash(platform, who) : "");
    const external = href.indexOf("http") === 0;
    const open = href ? (external ? ` data-href="${esc(href)}"` : ` data-open="${esc(href)}"`) : "";
    return `<div class="quote"${open}>
      <div class="quote-head">
        ${avatar(by.avatar, by.name || by.handle)}
        <span class="name">${esc(by.name || by.handle || "Repost")}</span>
        ${by.handle ? `<span class="handle">@${esc(by.handle)}</span>` : ""}
      </div>
      <div class="quote-text">${esc(text)}</div>
    </div>`;
  }

  function countsAsUpload(post, feed) {
    if (!isVideoPost(post) || isRepost(post) || !feed) return false;
    return post.feedId === feed.id || ((post.platform || "") + ":" + (post.handle || "")) === feed.id || (post.channelId && ((post.platform || "youtube") + ":" + post.channelId) === feed.id);
  }

  function onChannel(post, channel) {
    if (!channel) return true;
    if (isRepost(post)) {
      const by = post.repostedBy || {};
      const reposterId = by.feedId || ((by.platform || post.platform || "x") + ":" + (by.handle || ""));
      if (reposterId && reposterId === channel) return false;
      const creator = creatorOf(post);
      return creator.id === channel || ((post.platform || "") + ":" + (post.handle || "")) === channel || (post.channelId && ((post.platform || "youtube") + ":" + post.channelId) === channel);
    }
    return post.feedId === channel || ((post.platform || "") + ":" + (post.handle || "")) === channel;
  }

  function videoOwnerId(post) {
    const media = ((post && post.media) || []).find((item) => item && item.type === "video" && ytVideoId(item.videoId));
    if (media) return media.videoId;
    const raw = String((post && (post.statusId || post.id)) || "");
    if (post && post.platform === "youtube" && ytVideoId(raw) && post.kind !== "repost") return raw;
    const found = String((post && post.url) || "").match(/(?:[?&]v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
    return found ? found[1] : "";
  }

  function sameCreator(post, owner) {
    if (!post || !owner) return false;
    const channel = String(owner.channelId || "");
    const feed = feedOf(post);
    const knownChannel = String(post.channelId || feed.channelId || "");
    if (channel && knownChannel) return channel === knownChannel;
    const handle = String(owner.handle || "").replace(/^@/, "").toLowerCase();
    const names = [post.handle, feed.handle, post.author, feed.name].map((value) => String(value || "").replace(/^@/, "").toLowerCase()).filter(Boolean);
    if (handle && names.indexOf(handle) >= 0) return true;
    const name = String(owner.name || "").trim().toLowerCase();
    return !!(name && (name === String(post.author || "").trim().toLowerCase() || name === String(feed.name || "").trim().toLowerCase()));
  }

  function applyVideoOwner(post, owner) {
    if (!post || !owner || !owner.name) return false;
    if (post.kind === "repost" && post.repostedBy) return false;
    if (post.kind !== "community") return false;
    const videoId = videoOwnerId(post);
    if (!videoId) return false;
    if (sameCreator(post, owner)) {
      if (owner.title && !post.title) post.title = owner.title;
      return false;
    }
    const feed = feedOf(post);
    const handle = feed.handle || post.handle || "";
    const communityId = String(post.statusId || post.id || "");
    const comment = String(post.text || "").replace(new RegExp("https?://(?:www\\.)?(?:youtube\\.com/(?:watch\\?v=|shorts/)|youtu\\.be/)" + videoId + "\\S*", "ig"), " ").replace(/\s+/g, " ").trim();
    const title = owner.title || (((post.media || [])[0] || {}).alt) || "";
    post.repostedBy = {
      name: post.author || feed.name || handle,
      handle: handle,
      avatar: post.avatar || feed.avatar || "",
      platform: "youtube",
      feedId: post.feedId || feed.id || "",
      channelId: feed.channelId || ""
    };
    post.kind = "repost";
    post.id = "repost:" + String(handle).toLowerCase() + ":" + communityId;
    post.author = owner.name;
    post.handle = owner.handle || owner.channelId || "";
    post.avatar = owner.avatar || "";
    post.profileHandle = owner.channelId || post.handle;
    post.verifiedType = "";
    if (owner.channelId) post.channelId = owner.channelId;
    if (title) {
      post.title = title;
      post.text = title;
    }
    if (comment && comment !== title) post.repostComment = comment;
    post.repostUrl = "https://www.youtube.com/post/" + communityId;
    post.statusId = videoId;
    post.url = "https://www.youtube.com/watch?v=" + videoId;
    post.watch = true;
    return true;
  }

  function oembedOwner(id) {
    const url = "https://www.youtube.com/oembed?format=json&url=" + encodeURIComponent("https://www.youtube.com/watch?v=" + id);
    return fetchJson(url).then((data) => {
      if (!data || !data.author_name) return null;
      const authorUrl = String(data.author_url || "");
      const at = authorUrl.match(/youtube\.com\/@([^/?#]+)/);
      const uc = authorUrl.match(/youtube\.com\/channel\/(UC[\w-]{10,})/);
      return {
        name: String(data.author_name),
        handle: at ? decodeURIComponent(at[1]) : "",
        channelId: uc ? uc[1] : "",
        title: data.title || "",
        avatar: ""
      };
    }).catch(() => null);
  }

  function loadYtOwner(id) {
    const ttl = 7 * 24 * 60 * 60 * 1000;
    return cacheGet("yt:owner:" + id, ttl).then((hit) => {
      if (hit && hit.name) return hit;
      return rotate(ivBases(), "/api/v1/videos/" + encodeURIComponent(id), 3, "ivBase").then((video) => {
        if (video && video.author) {
          return {
            name: video.author,
            handle: "",
            channelId: video.authorId || "",
            title: video.title || "",
            avatar: ivBest(video.authorThumbnails) || ""
          };
        }
        return null;
      }).catch(() => null).then((owner) => owner || oembedOwner(id)).then((owner) => {
        if (!owner || !owner.name) return null;
        return cacheSet("yt:owner:" + id, owner).then(() => owner);
      });
    });
  }

  function ensureVideoOwners() {
    const list = ((STATE.data && STATE.data.posts) || []).filter((post) => post && post.platform === "youtube" && post.kind === "community" && videoOwnerId(post));
    list.slice(0, 12).forEach((post) => {
      const id = videoOwnerId(post);
      const key = "own:" + (post.id || id);
      if (TRIED[key]) return;
      TRIED[key] = 1;
      loadYtOwner(id).then((owner) => {
        if (!applyVideoOwner(post, owner)) return;
        render();
      });
    });
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

  function subsThumb(post) {
    const media = (post.media || [])[0] || {};
    const duration = clock(media.duration);
    return `<div class="yt-thumb vplay" data-preview="subs" data-pid="${esc(post.id || "")}" data-mi="0">${posterImg(post, media, "")}<span class="plat">${esc(PLATFORM[post.platform] || "")}</span>${duration ? `<span class="yt-time" data-full="${esc(duration)}">${esc(duration)}</span>` : ""}</div>`;
  }

  function ytCard(post, layout) {
    creditCarried(post);
    ensureYtMeta(post);
    const creator = creatorOf(post);
    const title = post.title || post.text || "";
    const who = post.profileHandle || creator.channelId || creator.handle || post.handle || "";
    const platform = creator.platform || post.platform || "x";
    const profile = accountHash(platform, who);
    const cardId = platform + ":" + who;
    const dest = watchHash(post);
    const name = creator.name || post.author || post.handle || "";
    const banner = repostBanner(post);
    const quote = repostQuote(post);
    const byline = `<div class="yt-by"><a data-act="stop" href="${esc(profile)}" data-card="${esc(cardId)}">${esc(name)}</a>${badge(creator.verifiedType || post.verifiedType)}</div><div class="yt-sub">${esc(videoMeta(post))}</div>`;
    if (layout === "list") {
      return `<div class="yt-item">
        ${banner}
        <div class="yt-card row" data-feed="${esc(creator.id || "")}" data-open="${esc(dest)}">
          <a class="yt-open" href="${esc(dest)}">${subsThumb(post)}</a>
          <div class="yt-meta">
            <a data-act="stop" href="${esc(profile)}" data-card="${esc(cardId)}" aria-label="${esc(name || "Channel")}">${avatar(creator.avatar || post.avatar, name, "yt-ava")}</a>
            <div class="yt-copy">
              <a class="yt-open" href="${esc(dest)}"><h3 class="yt-title">${esc(title)}</h3></a>
              ${byline}
            </div>
          </div>
        </div>
        ${quote}
      </div>`;
    }
    return `<div class="yt-item" data-feed="${esc(creator.id || "")}" data-open="${esc(dest)}">
      <div class="yt-label">${banner}</div>
      <a class="yt-open yt-shot" href="${esc(dest)}">${subsThumb(post)}</a>
      <a class="yt-face" data-act="stop" href="${esc(profile)}" data-card="${esc(cardId)}" aria-label="${esc(name || "Channel")}">${avatar(creator.avatar || post.avatar, name, "yt-ava")}</a>
      <a class="yt-open yt-title-link" href="${esc(dest)}"><h3 class="yt-title">${esc(title)}</h3></a>
      <div class="yt-lines">${byline}${quote}</div>
    </div>`;
  }

  function videoFeeds() {
    const rows = feeds().filter((feed) => feed && isFollowed(feed.id) && posts().some((post) => countsAsUpload(post, feed)));
    rows.sort((a, b) => {
      const ay = a.platform === "youtube" ? 0 : 1;
      const by = b.platform === "youtube" ? 0 : 1;
      if (ay !== by) return ay - by;
      return String(a.name || a.handle || "").localeCompare(String(b.name || b.handle || ""));
    });
    return shownFeeds(rows);
  }

  function memberOn(group, feed) {
    if (!group || !feed) return false;
    const members = group.members || [];
    return members.indexOf(feed.id) >= 0 || members.indexOf((feed.platform || "x") + ":" + feed.handle) >= 0;
  }

  function postInGroup(group, post) {
    if (!group) return true;
    const members = group.members || [];
    if (!members.length) return false;
    const feed = feedOf(post);
    return members.indexOf(post.feedId) >= 0 || members.indexOf((post.platform || "x") + ":" + (post.handle || "")) >= 0 || memberOn(group, feed);
  }

  function feedKeys(feed) {
    if (!feed) return [];
    const keys = [];
    const add = (value) => {
      const text = String(value || "");
      if (text && keys.indexOf(text) < 0) keys.push(text);
    };
    add(feed.id);
    add((feed.platform || "x") + ":" + (feed.handle || ""));
    if (feed.channelId) add((feed.platform || "youtube") + ":" + feed.channelId);
    if (Array.isArray(feed.memberIds)) feed.memberIds.forEach(add);
    return keys;
  }

  function draftHas(draft, feed) {
    const members = (draft && draft.members) || [];
    return feedKeys(feed).some((key) => members.indexOf(key) >= 0);
  }

  function groupChoices(members) {
    const rows = videoFeeds().slice();
    const seen = {};
    rows.forEach((feed) => { seen[feed.id] = true; });
    (members || []).forEach((id) => {
      if (seen[id]) return;
      const feed = feedById(id);
      if (feed) {
        if (seen[feed.id]) return;
        seen[feed.id] = true;
        rows.push(feed);
        return;
      }
      const cut = String(id).indexOf(":");
      seen[id] = true;
      rows.push({
        id: id,
        platform: cut > 0 ? id.slice(0, cut) : "",
        handle: cut > 0 ? id.slice(cut + 1) : id,
        name: cut > 0 ? id.slice(cut + 1) : id,
        avatar: ""
      });
    });
    return rows;
  }

  function openGroupSheet(group, precheck) {
    const members = group ? (group.members || []).slice() : [];
    if (precheck && members.indexOf(precheck) < 0 && members.length < 200) members.push(precheck);
    STATE.draft = {
      id: group ? group.id : "",
      name: group ? group.name : "",
      icon: group ? (group.icon || "") : "",
      members: members,
      gq: ""
    };
    STATE.modal = "group";
    STATE.groupMenu = null;
    render();
    const name = document.getElementById("group-name");
    if (name) name.focus();
  }

  function goSubs(id) {
    goHash(subsHash(id));
  }

  function groupTarget(node) {
    if (!node || !node.closest) return null;
    const chip = node.closest(".yt-chip[data-group]");
    if (chip && chip.dataset.group) return { kind: "group", id: chip.dataset.group };
    const card = node.closest(".yt-item[data-feed], .yt-card[data-feed], .short-card[data-feed], .yt-ch[data-feed]");
    if (card && card.dataset.feed) return { kind: "feed", id: card.dataset.feed };
    return null;
  }

  function openGroupMenu(target, x, y) {
    if (!target) return;
    const margin = 8;
    const width = 280;
    const rows = target.kind === "group" ? 5 : (STATE.settings.groups || []).length + 2;
    const height = Math.min(window.innerHeight - 16, 56 + rows * 48);
    const left = Math.max(margin, Math.min(x, window.innerWidth - width - margin));
    const top = Math.max(margin, Math.min(y, window.innerHeight - height - margin));
    STATE.groupMenu = { kind: target.kind, id: target.id, left: left, top: top };
    render();
  }

  function groupMenu() {
    const menu = STATE.groupMenu;
    if (!menu) return "";
    if (menu.kind === "group") {
      const groups = STATE.settings.groups || [];
      const index = groups.findIndex((group) => group.id === menu.id);
      if (index < 0) return "";
      const group = groups[index];
      return `<div class="group-menu" role="menu" aria-label="${esc(group.name)}" data-act="stop" style="left:${menu.left}px;top:${menu.top}px">
        <div class="share-grab" aria-hidden="true"></div>
        <button type="button" role="menuitem" data-act="group-edit" data-group="${esc(menu.id)}">Rename</button>
        <button type="button" role="menuitem" data-act="group-edit" data-group="${esc(menu.id)}">Edit channels</button>
        <button type="button" role="menuitem" data-act="group-move" data-group="${esc(menu.id)}" data-dir="-1"${index <= 0 ? " disabled" : ""}>Move left</button>
        <button type="button" role="menuitem" data-act="group-move" data-group="${esc(menu.id)}" data-dir="1"${index >= groups.length - 1 ? " disabled" : ""}>Move right</button>
        <button type="button" role="menuitem" data-act="group-delete" data-group="${esc(menu.id)}">Delete</button>
      </div>`;
    }
    const groups = STATE.settings.groups || [];
    const feed = feedById(menu.id) || { id: menu.id, platform: String(menu.id).split(":")[0], handle: String(menu.id).split(":").slice(1).join(":") };
    const rows = groups.map((group) => {
      const on = draftHas(group, feed);
      return `<button type="button" role="menuitemcheckbox" aria-pressed="${on ? "true" : "false"}" data-act="group-add" data-group="${esc(group.id)}" data-feed="${esc(menu.id)}">${esc(group.name)}</button>`;
    }).join("");
    const empty = groups.length ? "" : `<div class="group-menu-empty">No groups yet</div>`;
    return `<div class="group-menu" role="menu" aria-label="Add to group" data-act="stop" style="left:${menu.left}px;top:${menu.top}px">
      <div class="share-grab" aria-hidden="true"></div>
      <div class="group-menu-title">Add to group</div>
      ${empty}${rows}
      <button type="button" role="menuitem" data-act="group-new" data-feed="${esc(menu.id)}">New group</button>
    </div>`;
  }

  function groupFace(group, large) {
    if (!group) return "";
    if (group.icon && /^https:\/\//.test(group.icon) && group.icon.length <= 300) return `<img class="chip-icon${large ? " lg" : ""}" src="${esc(group.icon)}" alt="" referrerpolicy="no-referrer">`;
    const faces = (group.members || []).map((id) => feedById(id)).filter((feed) => feed && feed.avatar).slice(0, 4);
    if (!faces.length) return "";
    const cls = faces.length <= 1 ? "one" : faces.length === 2 ? "two" : "four";
    return `<span class="collage ${cls}${large ? " lg" : ""}">${faces.map((feed) => `<img src="${esc(feed.avatar)}" alt="" referrerpolicy="no-referrer">`).join("")}</span>`;
  }

  function subsView(route) {
    const layout = STATE.subsLayout === "list" ? "list" : "grid";
    const toggles = `<div class="yt-toggle"><button class="${layout === "grid" ? "on" : ""}" data-act="subs-layout" data-layout="grid" aria-label="Grid">${icon("grid")}</button><button class="${layout === "list" ? "on" : ""}" data-act="subs-layout" data-layout="list" aria-label="List">${icon("rows")}</button></div>`;
    const head = pageHead("Subscriptions", "", false, toggles);
    const picked = String((route.query && route.query.get("group")) || "");
    const active = (STATE.settings.groups || []).find((group) => group.id === picked) || null;
    const remembered = active ? active.id : "";
    if (STATE.settings.subsGroup !== remembered) {
      STATE.settings.subsGroup = remembered;
      saveSettings();
    }
    const here = subsChannelHash(remembered, "");
    const channels = videoFeeds().filter((feed) => !active || memberOn(active, feed));
    const chips = `<div class="yt-chips" aria-label="Subscription groups"><button class="yt-chip${!active ? " on" : ""}" type="button" data-act="subs-group" data-group="" aria-pressed="${!active ? "true" : "false"}">All</button>${(STATE.settings.groups || []).map((group) => {
      const on = active && active.id === group.id;
      return `<button class="yt-chip${on ? " on" : ""}" type="button" data-act="subs-group" data-group="${esc(group.id)}" aria-pressed="${on ? "true" : "false"}">${groupFace(group)}<span>${esc(group.name)}</span></button>`;
    }).join("")}<button class="yt-chip yt-chip-add" type="button" data-act="group-new" aria-pressed="false" aria-label="New group">${icon("plus")}<span>New group</span></button></div>`;
    const strip = `<div class="yt-strip" aria-label="Channels"><a class="yt-ch${!route.channel ? " on" : ""}" href="${esc(here)}"${!route.channel ? ' aria-current="page"' : ""}><span class="yt-all">All</span><span class="ch-name">All</span></a>${channels.map((feed) => {
      const on = route.channel === feed.id;
      const href = on ? here : subsChannelHash(remembered, feed.id);
      return `<a class="yt-ch${on ? " on" : ""}" data-feed="${esc(feed.id)}" href="${esc(href)}"${on ? ' aria-current="page"' : ""}>${avatar(feed.avatar, feed.name, "ch")}<span class="ch-name">${esc(feed.name || feed.handle)}</span></a>`;
    }).join("")}</div>`;
    posts().forEach(creditCarried);
    let list = posts().filter((post) => isVideoPost(post) && followedPost(post) && postInGroup(active, post)).sort(byStamp);
    if (route.channel) list = list.filter((post) => onChannel(post, route.channel));
    channels.forEach(ensureYtSubs);
    list.forEach(ensureYtMeta);
    const save = STATE.settings.groupsOwn ? `<button class="group-save" type="button" data-act="group-publish">Save groups to the site</button>` : "";
    let body = "";
    if (!STATE.settings.follows.length) body = emptyBlock("No videos yet", "Follow accounts to see their videos here.");
    else if (active && !(active.members || []).length) body = emptyBlock("No channels in this group", "Edit the group and pick channels.");
    else if (!list.length) body = emptyBlock(route.channel ? "No videos from this channel" : active ? "No videos in this group" : "No videos yet", route.channel ? "This channel's videos will show up here." : active ? "Videos from these channels will show up here." : "Videos from accounts you follow will show up here.");
    else {
      const shorts = list.filter((post) => post.short);
      const rest = list.filter((post) => !post.short);
      const shelf = shorts.length ? `<section class="yt-sec shorts-sec"><h2>Shorts</h2><div class="shorts">${shorts.map((post) => {
        const feed = feedOf(post);
        return `<a class="short-card" data-feed="${esc(feed.id || "")}" href="${esc(watchHash(post))}">${subsThumb(post)}<h3 class="yt-title">${esc(post.title || post.text || "")}</h3></a>`;
      }).join("")}</div></section>` : "";
      const order = ["Today", "Yesterday", "This week", "This month", "Older"];
      const buckets = {};
      rest.forEach((post) => {
        const name = dayBucket(post.date);
        (buckets[name] || (buckets[name] = [])).push(post);
      });
      const sections = order.filter((name) => buckets[name] && buckets[name].length).map((name) => `<section class="yt-sec"><h2>${name}</h2><div class="yt-grid">${buckets[name].map((post) => ytCard(post, layout)).join("")}</div></section>`).join("");
      body = shelf + sections;
    }
    return `<div class="subs ${layout}">${head}${chips}${save}${strip}${body}</div>`;
  }

  function revealSubsChannel() {
    const picked = document.querySelector(".yt-strip .yt-ch.on[data-feed]");
    const strip = picked && picked.parentElement;
    if (!picked || !strip) return;
    const left = picked.offsetLeft;
    const right = left + picked.offsetWidth;
    if (left >= strip.scrollLeft && right <= strip.scrollLeft + strip.clientWidth) return;
    strip.scrollLeft = Math.max(0, left - 12);
  }

  function watchComments(post) {
    const id = postKey(post);
    const file = post.platform === "youtube" ? "yt_" + id : id;
    const key = "watch:" + file;
    if (STATE.forceWatch === id) delete STATE.replies[key];
    if (STATE.replies[key]) return STATE.replies[key];
    STATE.replies[key] = { loading: true, doc: null, missing: false };
    const snap = () => snapshotDoc(file).then((doc) => {
      STATE.replies[key] = { loading: false, doc: doc, missing: false, fetchedAt: ytFetchedAt(doc) };
      render();
    }).catch(() => {
      STATE.replies[key] = { loading: false, doc: null, missing: true, fetchedAt: 0 };
      render();
    });
    if (post.platform === "youtube") {
      loadYtComments(post).then((doc) => {
        const at = ytFetchedAt(doc);
        if (!ytUsable(doc)) STATE.replies[key] = { loading: false, doc: null, missing: true, fetchedAt: at };
        else STATE.replies[key] = { loading: false, doc: doc, missing: false, fetchedAt: at };
        render();
      }).catch(() => {
        STATE.replies[key] = { loading: false, doc: null, missing: true, fetchedAt: 0 };
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
    const href = comment.channelId ? accountHash("youtube", comment.channelId) : "";
    const cardId = comment.channelId ? ` data-card="youtube:${esc(comment.channelId)}"` : "";
    const face = href ? `<a href="${esc(href)}"${cardId} aria-label="${esc(comment.author || comment.handle || "Profile")}">${avatar(comment.avatar, comment.author || comment.handle)}</a>` : avatar(comment.avatar, comment.author || comment.handle);
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
    if (!post) return pageHead("Watch", "", true) + emptyBlock("Not in this snapshot", "This video isn’t in the current snapshot.");
    creditCarried(post);
    const creator = creatorOf(post);
    ensureYtMeta(post);
    ensureYtSubs(creator);
    const media = (post.media || []).find((item) => item && (item.type === "video" || item.type === "animated_gif")) || (post.media || [])[0] || {};
    const id = postKey(post);
    if (STATE.notedWatch !== id) {
      STATE.notedWatch = id;
      noteVideo(post, { touch: true });
    }
    const clip = !!(media.type === "video" || media.type === "animated_gif" || youtubeId(post, media) || post.platform === "youtube");
    const mediaIndex = Math.max(0, (post.media || []).indexOf(media));
    const player = clip
      ? playerTile(post, media, mediaIndex).replace('class="tile vplay"', 'class="player vplay"')
      : ((media.poster || media.url) ? `<div class="player"><img src="${esc(media.poster || media.url)}" alt="" referrerpolicy="no-referrer"></div>` : "");
    const pip = clip && document.pictureInPictureEnabled ? `<button class="text-btn" type="button" data-act="pip">${icon("pip")} Picture in picture</button>` : "";
    const subs = creator.platform === "youtube" && creator.followers != null ? formatCount(creator.followers) + " subscribers" : (creator.followers != null ? formatCount(creator.followers) + " followers" : "");
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
      const stamped = bucket.fetchedAt || ytFetchedAt(bucket.doc);
      const label = freshLabel(stamped);
      comments = (rows.length ? rows.map(ytComment).join("") : `<div class="reply-empty">No comments yet.</div>`);
      comments = `<h3>${esc(formatCount(total) || "0")} Comments</h3><div class="reply-tools">${label ? `<span class="reply-fresh">${esc(label)}</span>` : ""}</div>${replySortTabs()}${comments}`;
    }
    const up = posts().filter((item) => isVideoPost(item) && followedPost(item) && postKey(item) !== id).sort(byStamp).slice(0, 16);
    const upHtml = up.length ? `<aside class="upnext"><h2>Up next</h2>${up.map((item) => {
      const thumb = ((item.media || [])[0] || {}).poster || "";
      return `<a class="up-row" href="${esc(watchHash(item))}"><div class="yt-thumb">${thumb ? `<img src="${esc(thumb)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ""}${platMark(item.platform)}</div><div><h3 class="yt-title">${esc(item.title || item.text || "")}</h3><div class="yt-by">${esc(item.author || item.handle || "")}</div><div class="yt-sub">${esc(videoMeta(item))}</div></div></a>`;
    }).join("")}</aside>` : `<aside class="upnext"><h2>Up next</h2><p class="yt-sub">No other videos from accounts you follow.</p></aside>`;
    return `<div class="topbar"><div class="page-head"><button class="icon-btn" data-act="back" aria-label="Back">${icon("back")}</button><div class="pt-name grow">Watch</div></div></div>
      <div class="watch">
        <div class="watch-main">
          ${player}
          ${pip}
          ${repostBanner(post)}
          <h1 class="watch-title">${esc(post.title || post.text || "")}</h1>
          <div class="watch-chan">
            <a data-card="${esc((creator.platform || post.platform) + ":" + (creator.channelId || creator.handle))}" href="${esc(accountHash(creator.platform || post.platform, creator.channelId || creator.handle))}" aria-label="${esc(creator.name || post.author || "Channel")}">${avatar(creator.avatar || post.avatar, creator.name || post.author)}</a>
            <div class="watch-who"><a class="name" data-card="${esc((creator.platform || post.platform) + ":" + (creator.channelId || creator.handle))}" href="${esc(accountHash(creator.platform || post.platform, creator.channelId || creator.handle))}">${esc(creator.name || post.author || "")}${badge(creator.verifiedType || post.verifiedType)}</a><div class="yt-sub">${esc(subs)}</div></div>
            ${followButtonClean(creator.id, true)}
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
            <div class="desc-body">${linkify(desc || post.text || "", post.links, post.platform, post.handle)}</div>
            ${desc ? `<button class="text-btn" type="button" data-act="more" data-key="desc:${esc(id)}">${openDesc ? "Show less" : "Show more"}</button>` : ""}
          </div>
          ${repostQuote(post)}
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
    const nested = commentInDocs(key);
    if (nested && nested.comment) return nested.comment;
    return openedPost(key);
  }

  function shareContext() {
    const share = STATE.share;
    if (!share) return null;
    if (share.kind === "profile") {
      const feed = feedById(share.id) || liveProfileById(share.id) || profileStub(share.id);
      if (!feed || !feed.handle) return null;
      const original = externalProfile(feed);
      const page = shareProfileUrl(feed);
      const publicOriginal = original && original !== "#" ? original : "";
      return {
        permalink: page || publicOriginal || sitePermalink(accountHash(feed.platform || "x", feed.handle)),
        original: publicOriginal,
        note: page ? "" : unpublishedNote("profile", feed.platform, !!publicOriginal),
        title: feed.name || feed.handle || "",
        text: feed.bio || feed.name || "",
        platform: PLATFORM[feed.platform] || "web",
        via: "Share profile via…"
      };
    }
    const post = findAnyPost(share.id);
    if (!post) return null;
    const hash = share.kind === "watch" ? watchHash(post) : statusHash(post);
    const page = sharePostUrl(post, share.kind);
    return {
      permalink: page || post.url || sitePermalink(hash),
      original: post.url || "",
      note: page ? "" : unpublishedNote("post", post.platform, !!post.url),
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
    const rows = 1 + (canNative ? 1 : 0) + (original ? 2 : 0) + (ctx.note ? 1 : 0);
    const place = STATE.share.anchor ? sharePlace(STATE.share.anchor, rows) : "top:72px;left:16px";
    const via = canNative ? `<button type="button" role="menuitem" data-act="native-share">${icon("share")} ${esc(ctx.via)}</button>` : "";
    const extra = original ? `<div class="share-rule"></div>
      <button type="button" role="menuitem" data-act="copy" data-copy="original" data-url="${esc(original)}">${icon("link")} Copy original link</button>
      <a role="menuitem" data-act="stop" target="_blank" rel="noopener noreferrer" href="${esc(original)}">${icon("external")} Open original on ${esc(ctx.platform)}</a>` : "";
    const note = ctx.note ? `<p class="share-note">${esc(ctx.note)}</p>` : "";
    return `<div class="share-back" data-act="close-share"><div class="share-pop" data-act="stop" role="menu" aria-label="Share" style="${place}">
      <div class="share-grab" aria-hidden="true"></div>
      ${note}
      <button type="button" role="menuitem" data-act="copy" data-copy="site" data-url="${esc(ctx.permalink)}"${ctx.note ? ` data-note="${esc(ctx.note)}"` : ""}>${icon("link")} Copy link</button>
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
    const reply = showReply ? `<div class="replying">Replying to <a data-act="stop" data-card="${esc((post.platform || "x") + ":" + post.replyingTo.handle)}" href="${esc(accountHash(post.platform || "x", post.replyingTo.handle))}">@${esc(post.replyingTo.handle)}</a></div>` : "";
    const face = authorFace(post);
    return `<article class="ancestor" data-open="${esc(statusHash(post))}">
      <div class="ava-col"><a data-act="stop" data-card="${esc((post.platform || "x") + ":" + (post.handle || ""))}" href="${esc(accountHash(post.platform, post.handle))}" aria-label="${esc(post.author || post.handle || "Profile")}">${avatar(face.avatar, post.author || post.handle)}</a><div class="thread-line"></div></div>
      <div class="ancestor-main">
        <div class="byline">
          <a class="name" data-act="stop" data-card="${esc((post.platform || "x") + ":" + (post.handle || ""))}" href="${esc(accountHash(post.platform, post.handle))}">${esc(post.author || post.handle)}${badge(face.verified)}</a>
          <a class="handle" data-act="stop" data-card="${esc((post.platform || "x") + ":" + (post.handle || ""))}" href="${esc(accountHash(post.platform, post.handle))}">@${esc(post.handle || "")}</a>
          <span class="dot">·</span>
          <a class="time" data-act="stop" href="${esc(statusHash(post))}">${esc(relTime(post.date))}</a>
        </div>
        ${reply}
        ${textBlock(post, "anc:" + postKey(post), false)}
        ${mediaHtml(post.media, false, post)}
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
    if ((route.platform || "x") === "youtube") {
      loadYtComments({ id: key, statusId: key, platform: "youtube", handle: route.handle || "", kind: "reply" }).then((doc) => {
        const comment = doc && doc.comment ? doc.comment : (commentInDocs(key) || {}).comment;
        if (comment && (comment.text || comment.author || comment.handle)) {
          STATE.shared[key] = comment;
          STATE.sharedState[key] = "ok";
        } else STATE.sharedState[key] = "miss";
      }).catch(() => { STATE.sharedState[key] = "miss"; }).then(() => render());
      return;
    }
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
    const matches = q ? shownFeeds(feeds()).filter((item) => (item.name + " " + item.handle + " " + (item.aliases || "")).toLowerCase().includes(q.toLowerCase())).slice(0, 8) : [];
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
    if (route.name === "person") return (window.FeedsPeople && window.FeedsPeople.page(route)) || pageHead("Profile", "", true) + emptyBlock("Profile isn’t available", "This person isn’t in people.json.");
    if (route.name === "spaces") return (window.Spaces && window.Spaces.page && window.Spaces.page(route)) || pageHead("Space", "", true) + emptyBlock("This Space has ended", "This Space isn’t available.");
    if (route.name === "profile") return profileView(route);
    if (route.name === "user") return userView(route);
    if (route.name === "status") return statusView(route);
    if (route.name === "explore") return exploreView(route);
    if (route.name === "feeds") return feedsView();
    if (route.name === "lists") return listsView();
    if (route.name === "list") return listView(route);
    if (route.name === "history" || route.name === "bookmarks") return historyView(route.name === "history" ? route : { name: "history", tab: "bookmarks", query: route.query });
    if (route.name === "article") return articleView(route);
    if (route.name === "subscriptions") return subsView(route);
    if (route.name === "watch") return watchView(route);
    if (route.name === "settings") return settingsView();
    if (route.name === "incoming") return incomingView();
    if (route.name === "notifications") return notificationsView();
    if (route.name === "messages" && window.FeedsDiscord) return window.FeedsDiscord.page(route);
    if (route.name === "messages") return notesView("Messages", "Welcome to your inbox", "Private conversations aren’t part of this reader.");
    if (route.name === "sources") return sourcesView();
    return homeView({ tab: "foryou", query: new URLSearchParams() });
  }

  let lastKey = "";
  function routeScrollKey() {
    const route = parseRoute();
    if (route.name === "home") return "home:" + (route.tab || "foryou");
    if (route.name === "messages") return "#/messages";
    return location.hash || "#/";
  }

  function pageY() {
    return window.scrollY || document.documentElement.scrollTop || document.body.scrollTop || 0;
  }

  function smoothTop() {
    const y = pageY();
    const repeat = !!STATE.snapTop && y > 4;
    STATE.snapTop = y > 4;
    STATE.tabMenu = null;
    const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    window.scrollTo({ top: 0, behavior: repeat || reduced ? "auto" : "smooth" });
    if (STATE.scrollKey) SCROLLS[STATE.scrollKey] = 0;
    STATE.headerHidden = false;
    document.querySelectorAll(".topbar").forEach((el) => el.classList.remove("is-hidden"));
    document.querySelectorAll('.tab-caret[aria-expanded="true"]').forEach((btn) => btn.setAttribute("aria-expanded", "false"));
    const sheet = document.querySelector(".tab-sheet");
    if (sheet) sheet.remove();
  }

  function reloadAtTop() {
    STATE.tabMenu = null;
    refreshOpenComments();
    refreshFeeds(true);
    refreshLiveTimeline(true);
  }

  function navSection(name) {
    if (name === "list") return "lists";
    if (name === "bookmarks") return "history";
    if (name === "home" || name === "explore" || name === "notifications" || name === "messages" || name === "feeds" || name === "lists" || name === "history" || name === "settings" || name === "subscriptions") return name;
    return "";
  }

  function hrefSection(href) {
    const path = String(href || "").replace(/^#/, "").split("?")[0];
    const head = path.split("/").filter(Boolean)[0] || "home";
    if (head === "home" || head === "following" || head === "tab") return "home";
    if (head === "list") return "lists";
    return navSection(head);
  }

  function sameNavSection(route, href) {
    const here = navSection(route && route.name);
    const there = hrefSection(href);
    return !!here && here === there;
  }

  function goHash(next) {
    const wanted = next || "#/";
    const here = location.hash || "#/";
    if (here === wanted || (wanted === "#/" && (here === "#" || here === ""))) {
      render();
      return;
    }
    if (STATE.scrollKey) SCROLLS[STATE.scrollKey] = pageY();
    scrollFreeze = true;
    location.hash = wanted;
  }

  function placeTabMenu() {
    const menu = document.querySelector(".tab-menu");
    const caret = document.querySelector('.tab-caret[aria-expanded="true"]');
    if (!menu || !caret) return;
    if (window.innerWidth < 500) {
      menu.style.left = "";
      menu.style.top = "";
      return;
    }
    const item = caret.getBoundingClientRect();
    const width = menu.offsetWidth || 220;
    let left = item.left;
    const limit = window.innerWidth - 8;
    if (left + width > limit) left = Math.max(8, limit - width);
    menu.style.left = Math.max(8, left) + "px";
    menu.style.top = (item.bottom + 4) + "px";
  }

  function placeBellMenu() {
    const menu = document.querySelector(".bell-menu");
    const btn = document.querySelector('.notify-bell[aria-expanded="true"]');
    if (!menu) return;
    if (window.innerWidth < 500 || !btn) {
      menu.style.left = "";
      menu.style.top = "";
      return;
    }
    const item = btn.getBoundingClientRect();
    const width = menu.offsetWidth || 300;
    const height = menu.offsetHeight || 220;
    let left = item.right - width;
    if (left < 8) left = 8;
    if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - width);
    let top = item.bottom + 6;
    if (top + height > window.innerHeight - 8) top = Math.max(8, item.top - height - 6);
    menu.style.left = left + "px";
    menu.style.top = top + "px";
  }

  let tabScrollLeft = null;
  let tabScrollRoute = "";

  function revealSelectedTab(scroller) {
    const current = scroller.querySelector(".tab-pair.on") || scroller.querySelector(".tab.on");
    if (!current) return;
    const pad = 48;
    const box = current.getBoundingClientRect();
    const host = scroller.getBoundingClientRect();
    if (box.right > host.right - pad) scroller.scrollLeft += box.right - (host.right - pad);
    else if (box.left < host.left + pad) scroller.scrollLeft -= host.left + pad - box.left;
  }

  function syncTabArrows() {
    const scroller = document.querySelector(".tabs");
    const bar = document.querySelector(".tabs-bar");
    const left = document.querySelector(".tab-arrow.left");
    const right = document.querySelector(".tab-arrow.right");
    if (!scroller || !left || !right) return;
    const route = routeScrollKey();
    if (scroller.dataset.seen !== "1") {
      scroller.dataset.seen = "1";
      const sameTab = tabScrollRoute === route && tabScrollLeft != null;
      tabScrollRoute = route;
      if (sameTab) scroller.scrollLeft = tabScrollLeft;
      else revealSelectedTab(scroller);
    }
    const max = scroller.scrollWidth - scroller.clientWidth;
    const canLeft = max > 2 && scroller.scrollLeft > 2;
    const canRight = max > 2 && scroller.scrollLeft < max - 2;
    left.hidden = !canLeft;
    right.hidden = !canRight;
    if (bar) {
      bar.classList.toggle("is-fade-left", canLeft);
      bar.classList.toggle("is-fade-right", canRight);
    }
    tabScrollLeft = scroller.scrollLeft;
    if (scroller.dataset.arrows !== "1") {
      scroller.dataset.arrows = "1";
      scroller.addEventListener("scroll", syncTabArrows, { passive: true });
    }
  }

  function render(opts) {
    const bare = (location.hash || "#/").split("?")[0];
    if (bare === "#/bookmarks" || bare === "#/history") {
      history.replaceState(null, "", location.pathname + location.search + "#/history/bookmarks");
    }
    const gen = (STATE.renderGen = (STATE.renderGen || 0) + 1);
    const route = parseRoute();
    syncHomeFromQuery(route);
    const currentTab = route.name === "home" ? (route.tab || "foryou") : "";
    if (!(route.name === "home" && STATE.tabMenu === currentTab)) STATE.tabMenu = null;
    const nextKey = routeScrollKey();
    const routeChanged = !!STATE.scrollKey && STATE.scrollKey !== nextKey;
    if (route.name !== "watch") STATE.notedWatch = "";
    if (route.name !== "status") STATE.notedStatus = "";
    if (route.name !== "article") STATE.notedArticle = "";
    if (route.name === "article") {
      if (STATE.embedFor !== String(route.id || "")) {
        STATE.embedFor = String(route.id || "");
        STATE.embedBudget = 0;
      }
    } else if (STATE.embedFor) {
      STATE.embedFor = "";
      STATE.embedBudget = 0;
    }
    if (route.name === "status") {
      const sid = String(route.id || "");
      if (STATE.openReply !== sid) {
        STATE.openReply = sid;
        STATE.forceReply = sid;
      }
    } else STATE.openReply = "";
    const wasWatch = !!STATE.openWatch;
    if (route.name === "watch") {
      const sid = String(route.id || "");
      if (STATE.openWatch !== sid) {
        STATE.openWatch = sid;
        STATE.forceWatch = sid;
      }
    } else STATE.openWatch = "";
    const leavingWatch = routeChanged && wasWatch && route.name !== "watch";
    if (routeChanged) {
      STATE.scrolled = false;
      STATE.subsHover = null;
    }
    if (route.name !== "status") STATE.focusId = "";
    const reset = opts && opts.reset;
    if (opts && Object.prototype.hasOwnProperty.call(opts, "y")) STATE.holdY = opts.y;
    if (STATE.snapTop) STATE.holdY = 0;
    let y = STATE.holdY != null ? STATE.holdY : (reset ? 0 : window.scrollY);
    if (leavingWatch) {
      y = 0;
      SCROLLS[nextKey] = 0;
    }
    const focus = document.activeElement;
    const focusId = focus && focus.id;
    const caret = focus && typeof focus.selectionStart === "number" ? focus.selectionStart : null;
    if (leavingWatch) stopWatchPlayback();
    rememberPlayback();
    if (leavingWatch) STATE.playing = null;
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const transition = routeChanged && document.startViewTransition && !reduced;
    const apply = () => {
      if (gen !== STATE.renderGen) return;
      if (STATE.snapTop) y = 0;
      else if (STATE.holdY != null) y = STATE.holdY;
      else if (!(opts && Object.prototype.hasOwnProperty.call(opts, "y"))) y = window.scrollY;
      document.getElementById("app").innerHTML = shell(view(route), route);
      if (route.name === "article" && STATE.scrollKey !== nextKey) {
        const saved = articleScroll(route.id);
        if (saved > 0.02) {
          const max = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
          y = Math.round(saved * max);
        }
      }
      previewAnchor = y;
      const liveName = route.name === "user" ? ((STATE.liveUsers[liveKey(route.platform, route.handle)] || {}).profile || {}).name : "";
      const personName = window.FeedsPeople && window.FeedsPeople.titleFor ? window.FeedsPeople.titleFor(route) : "";
      const discordTitle = window.FeedsDiscord && window.FeedsDiscord.titleFor ? window.FeedsDiscord.titleFor(route) : "";
      document.title = (discordTitle || personName || (route.name === "home" ? "Home" : route.name === "status" ? "Post" : route.name === "user" ? (liveName || route.handle || "Profile") : route.name === "incoming" ? "Add account" : route.name[0].toUpperCase() + route.name.slice(1))) + " / SuperintelApp";
      window.scrollTo(0, y);
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
      if (route.name === "subscriptions" && route.channel && (routeChanged || !STATE.scrollKey)) revealSubsChannel();
      STATE.scrollKey = nextKey;
      lastKey = location.hash;
      if (routeChanged && !transition) {
        const center = document.querySelector(".center");
        if (center) center.classList.add("route-in");
      }
      watchHydration();
      scheduleDetect();
      if (window.FeedsTranslate) window.FeedsTranslate.paint();
      syncMediaSession();
      if (window.Spaces && window.Spaces.afterRender) window.Spaces.afterRender(route);
      bindPlayers();
      resumePlayback();
      placeTabMenu();
      placeBellMenu();
      syncTabArrows();
      if (window.FeedsDiscord && window.FeedsDiscord.mount) window.FeedsDiscord.mount(route);
    };
    const endRoute = () => {
      if (gen !== STATE.renderGen) return;
      if (STATE.snapTop) y = 0;
      else if (STATE.holdY != null) y = STATE.holdY;
      else if (!(opts && Object.prototype.hasOwnProperty.call(opts, "y"))) y = window.scrollY;
      if (!STATE.snapTop && window.scrollY > y + 4) y = window.scrollY;
      window.scrollTo(0, y);
      if (STATE.scrollKey) SCROLLS[STATE.scrollKey] = y;
      if (STATE.holdY === y) STATE.holdY = null;
      routing = false;
      scrollFreeze = false;
      if (opts && opts.done) opts.done();
    };
    if (transition) {
      let change = null;
      try { change = document.startViewTransition(apply); } catch (err) { apply(); endRoute(); return; }
      if (change && change.ready) change.ready.catch(() => {});
      if (change && change.finished) change.finished.then(endRoute).catch(endRoute);
      else endRoute();
    } else {
      apply();
      endRoute();
    }
  }

  function toast(message) {
    const el = document.getElementById("toast");
    el.hidden = false;
    el.textContent = message;
    clearTimeout(toast._t);
    toast._t = setTimeout(() => { el.hidden = true; }, 1800);
  }

  let tabSheetClose = 0;
  let tabSheetDrag = null;
  let swallowTabSheet = false;

  function closeTabMenu() {
    const menu = document.querySelector(".menu.tab-menu");
    const phone = !!(menu && window.innerWidth < 500);
    STATE.tabMenu = null;
    if (!phone) {
      render();
      return;
    }
    const token = ++tabSheetClose;
    menu.style.transition = "transform .2s ease";
    menu.style.transform = "translateY(100%)";
    const sheet = menu.parentElement;
    if (sheet && sheet.classList.contains("tab-sheet")) {
      sheet.style.transition = "background .2s ease";
      sheet.style.background = "transparent";
    }
    setTimeout(() => {
      if (token !== tabSheetClose || STATE.tabMenu) return;
      render();
    }, 200);
  }

  function openListModal(list) {
    STATE.draft = list ? { id: list.id, name: list.name, description: list.description || "", bannerColor: list.bannerColor || COLORS[0] } : { name: "", description: "", bannerColor: COLORS[0] };
    STATE.modal = "list";
    render();
  }

  function tapHaptic() {
    if (!navigator.vibrate) return;
    try { navigator.vibrate(10); } catch (err) { /* haptics are optional */ }
  }

  function onAct(el) {
    const act = el.dataset.act;
    if (act === "stop") return;
    if (act === "spoiler") { el.classList.toggle("open"); return; }
    if (act === "skip") {
      const main = document.querySelector("main.center");
      if (main) main.focus();
      return;
    }
    if (act === "htab" || act === "like" || act === "bookmark" || act === "follow" || act === "back" || act === "view") tapHaptic();
    if (act === "close-viewer") { closeViewer(); return; }
    if (act === "back") {
      if (STATE.viewer) { closeViewer(); return; }
      if (history.length > 1) history.back();
      else goHash("#/");
      return;
    }
    if (act === "view") {
      openViewer(el.dataset.id, Number(el.dataset.mi) || 0);
      return;
    }
    if (act === "reload") { boot(); return; }
    if (act === "drawer") { STATE.drawer = true; render(); return; }
    if (act === "close-drawer") { STATE.drawer = false; render(); return; }
    if (act === "compose") { STATE.modal = "compose"; render(); return; }
    if (act === "close-modal" || act === "close-remove") { STATE.modal = null; STATE.confirm = null; STATE.histClear = ""; STATE.removeFeed = null; render(); return; }
    if (act === "ask-remove") {
      const id = el.dataset.id || "";
      const feed = feedById(id);
      STATE.removeFeed = { id: id, handle: (feed && feed.handle) || "" };
      render();
      return;
    }
    if (act === "confirm-remove") {
      const pending = STATE.removeFeed;
      const url = pending && pending.id ? followIssueUrlForId("unfollow", pending.id) : "";
      STATE.removeFeed = null;
      if (url) window.open(url, "_blank", "noopener,noreferrer");
      render();
      return;
    }
    if (act === "compose-post") { STATE.modal = null; render(); toast("Posts come from your feeds"); return; }
    if (act === "close-tab-menu") {
      closeTabMenu();
      return;
    }
    if (act === "htab" || act === "tab-options") {
      const tab = el.dataset.tab || (el.dataset.id ? "list:" + el.dataset.id : "following");
      const route = parseRoute();
      const selected = route.name === "home" && (route.tab || "foryou") === tab;
      if (!selected) {
        STATE.tabMenu = null;
        goHash(homeHash(tab));
        return;
      }
      if (pageY() > 4) {
        smoothTop();
        return;
      }
      STATE.snapTop = false;
      STATE.tabMenu = STATE.tabMenu === tab ? null : tab;
      render();
      return;
    }
    if (act === "tab-view") {
      const view = el.dataset.view === "reposts" ? "reposts" : "all";
      const tab = el.dataset.tab || "foryou";
      setTabView(tab, view);
      STATE.tabMenu = null;
      saveSettings();
      const next = homeHash(tab);
      if ((location.hash || "#/") !== next) history.replaceState(null, "", next);
      SCROLLS[routeScrollKey()] = 0;
      render({ y: 0 });
      return;
    }
    if (act === "follow-sort") {
      const sort = el.dataset.sort === "popular" ? "popular" : "recent";
      const tab = el.dataset.list ? "list:" + el.dataset.list : "following";
      if (el.dataset.list) {
        const list = (STATE.settings.lists || []).find((item) => item.id === el.dataset.list);
        if (list) list.sort = sort;
      } else STATE.settings.followingSort = sort;
      STATE.tabMenu = null;
      saveSettings();
      const next = homeHash(tab);
      if ((location.hash || "#/") !== next) history.replaceState(null, "", next);
      SCROLLS[routeScrollKey()] = 0;
      render({ y: 0 });
      return;
    }
    if (act === "foryou-toggle") {
      const key = el.dataset.key === "replies" ? "forYouReplies" : "forYouReposts";
      STATE.settings[key] = STATE.settings[key] === false;
      saveSettings();
      const next = homeHash("foryou");
      if ((location.hash || "#/") !== next) history.replaceState(null, "", next);
      STATE.tabMenu = "foryou";
      SCROLLS[routeScrollKey()] = 0;
      render({ y: 0 });
      return;
    }
    if (act === "manage-tabs") {
      STATE.tabMenu = null;
      STATE.modal = "tabs";
      render();
      return;
    }
    if (act === "tab-scroll") {
      const scroller = document.querySelector(".tabs");
      if (!scroller) return;
      const dir = Number(el.dataset.dir) || 1;
      const max = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
      const amount = scroller.clientWidth || 240;
      const next = Math.max(0, Math.min(max, scroller.scrollLeft + dir * amount));
      const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      tabScrollLeft = next;
      tabScrollRoute = routeScrollKey();
      scroller.scrollTo({ left: next, behavior: reduced ? "auto" : "smooth" });
      syncTabArrows();
      return;
    }
    if (act === "tab-move") {
      const lists = STATE.settings.lists || [];
      const pinnedAt = [];
      lists.forEach((list, index) => { if (list && list.pinned) pinnedAt.push(index); });
      const from = pinnedAt.findIndex((index) => lists[index].id === el.dataset.id);
      const to = from + (Number(el.dataset.dir) || 0);
      if (from < 0 || to < 0 || to >= pinnedAt.length) return;
      const swap = lists[pinnedAt[from]];
      lists[pinnedAt[from]] = lists[pinnedAt[to]];
      lists[pinnedAt[to]] = swap;
      saveSettings();
      render();
      return;
    }
    if (act === "tab-unpin") {
      const list = (STATE.settings.lists || []).find((item) => item.id === el.dataset.id);
      if (list) list.pinned = false;
      STATE.tabMenu = null;
      saveSettings();
      const route = parseRoute();
      if (route.name === "home" && route.tab === "list:" + el.dataset.id) goHash(homeHash("following"));
      else render();
      return;
    }
    if (act === "repost-off") {
      const id = el.dataset.id;
      const list = STATE.settings.repostOff || (STATE.settings.repostOff = []);
      const index = list.indexOf(id);
      if (index >= 0) list.splice(index, 1);
      else if (id) list.push(id);
      STATE.menu = null;
      saveSettings();
      render();
      return;
    }
    if (act === "unmute-word" || act === "unmute-account") {
      const key = act === "unmute-word" ? "mutedWords" : "mutedAccounts";
      const value = act === "unmute-word" ? el.dataset.word : el.dataset.account;
      STATE.settings[key] = (STATE.settings[key] || []).filter((item) => item !== value);
      saveSettings();
      render();
      return;
    }
    if (act === "translate") { translateNow(el.dataset.key); return; }
    if (act === "show-original") {
      if (window.FeedsTranslate) window.FeedsTranslate.showOriginal(el.dataset.key);
      else { STATE.originalShown[el.dataset.key] = true; render(); }
      return;
    }
    if (act === "follow-request") {
      const id = el.dataset.id;
      if (id && STATE.settings.follows.indexOf(id) < 0) STATE.settings.follows.push(id);
      saveSettings();
      toast("Follow request opened. Submit it on GitHub and the next sync will add this account.");
      return;
    }
    if (act === "follow") {
      const ids = String(el.dataset.ids || el.dataset.id || "").split(",").map((part) => part.trim()).filter(Boolean);
      if (!ids.length) return;
      const on = ids.some((item) => isFollowed(item));
      ids.forEach((item) => {
        const i = STATE.settings.follows.indexOf(item);
        if (on) {
          if (i >= 0) STATE.settings.follows.splice(i, 1);
          rememberUnfollow(item);
        } else if (i < 0) STATE.settings.follows.push(item);
      });
      saveSettings();
      render();
      return;
    }
    if (act === "subs-layout") {
      STATE.subsLayout = el.dataset.layout === "list" ? "list" : "grid";
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
        if (act === "like") histRemove("likes", id);
        if (act === "bookmark") histRemove("bookmarks", id);
      } else {
        STATE.settings[bucket][id] = Date.now();
        const likedPost = findAnyPost(id);
        if (act === "bookmark") {
          rememberBookmark(id);
          histUpsert("bookmarks", likedPost || findAnyPost(id), { id: id });
          if (!navigator.onLine) toast("Saved. Images download when you’re back online.");
        }
        if (act === "like") histUpsert("likes", likedPost, { id: id });
      }
      saveSettings();
      render();
      return;
    }
    if (act === "open-article") {
      const post = findAnyPost(el.dataset.id);
      if (post) noteArticle(post, {});
      return;
    }
    if (act === "open-link") {
      const post = findAnyPost(el.dataset.id);
      if (post) noteArticle(post, {});
      return;
    }
    if (act === "hist-pause") {
      const tab = el.dataset.tab;
      STATE.settings.historyPause = cleanHistoryPause(STATE.settings.historyPause);
      if (tab === "videos") STATE.settings.historyPause.videos = !STATE.settings.historyPause.videos;
      if (tab === "articles") STATE.settings.historyPause.articles = !STATE.settings.historyPause.articles;
      saveSettings();
      render();
      return;
    }
    if (act === "hist-chip") {
      STATE.histPlat = el.dataset.plat || "";
      render();
      return;
    }
    if (act === "hist-clear") {
      STATE.histClear = el.dataset.tab || "bookmarks";
      render();
      return;
    }
    if (act === "hist-clear-go") {
      wipeHistory(STATE.histClear || "bookmarks");
      STATE.histClear = "";
      render();
      return;
    }
    if (act === "hist-remove") {
      const tab = el.dataset.tab || "bookmarks";
      const id = el.dataset.id || "";
      if (tab === "bookmarks") {
        delete STATE.settings.bookmarks[id];
        if (STATE.settings.savedPosts) delete STATE.settings.savedPosts[id];
        saveSettings();
      } else if (tab === "likes") {
        delete STATE.settings.likes[id];
        saveSettings();
      }
      histRemove(tab, id);
      STATE.menu = null;
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
    if (act === "autoplay") {
      const mode = el.dataset.mode;
      STATE.settings.autoplay = mode === "wifi" || mode === "never" ? mode : "all";
      saveSettings();
      render();
      return;
    }
    if (act === "mute") {
      const tile = el.closest(".vplay");
      if (tile && tile.querySelector(".gif-badge")) return;
      if (tile && tile.querySelector("iframe") && !tile.querySelector("video")) {
        STATE.sound = true;
        openFullVideo(tile);
        return;
      }
      STATE.sound = !STATE.sound;
      document.querySelectorAll(".vplay[data-preview='feed'] video").forEach((video) => {
        const owner = video.closest(".vplay");
        if (!owner || owner.querySelector(".gif-badge") || owner.dataset.preview === "subs") return;
        video.muted = !STATE.sound;
        if (STATE.sound && owner === STATE.autoEl) video.play().catch(() => {});
      });
      document.querySelectorAll(".vmute").forEach(paintMute);
      return;
    }
    if (act === "notify") {
      enableNotifications();
      return;
    }
    if (act === "bell") {
      const id = el.dataset.id || "";
      if (STATE.bellMenu && STATE.bellMenu.id === id) STATE.bellMenu = null;
      else STATE.bellMenu = { id: id, handle: String(el.dataset.handle || "").replace(/^@/, "") };
      render();
      return;
    }
    if (act === "close-bell") {
      STATE.bellMenu = null;
      render();
      return;
    }
    if (act === "bell-mode") {
      const id = el.dataset.id || (STATE.bellMenu && STATE.bellMenu.id) || "";
      const handle = (STATE.bellMenu && STATE.bellMenu.handle) || el.dataset.handle || "";
      const mode = el.dataset.mode || "off";
      STATE.bellMenu = null;
      setBellMode(id, mode, handle);
      return;
    }
    if (act === "pip") {
      const tile = document.querySelector(".player.vplay") || document.querySelector(".player");
      const video = tile && tile.querySelector("video");
      if (!document.pictureInPictureEnabled) return;
      if (video) {
        const done = document.pictureInPictureElement ? document.exitPictureInPicture() : video.requestPictureInPicture();
        Promise.resolve(done).catch(() => {});
        return;
      }
      if (tile && tile.classList.contains("vplay")) {
        tile.addEventListener("playing", (ev) => {
          const node = ev.target;
          if (node && node.requestPictureInPicture) node.requestPictureInPicture().catch(() => {});
        }, { once: true, capture: true });
        startPlayback(tile, {});
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
      toast(el.dataset.note || "Copied to clipboard");
      return;
    }
    if (act === "open-status") {
      const post = posts().find((p) => p.id === el.dataset.id);
      if (post) goHash(statusHash(post));
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
    if (act === "play" || act === "video-retry") {
      const tile = el.closest(".vplay") || el;
      if (act === "video-retry") {
        tile.classList.remove("is-failed", "is-playing", "is-shown");
        tile._gen = (tile._gen || 0) + 1;
        tile._recovered = 0;
        delete tile._sources;
        delete tile._prefetch;
        clearPlayer(tile);
        startPlayback(tile, tile.dataset.preview ? { preview: true } : {});
        return;
      }
      if (tile.dataset.preview && !tile.classList.contains("player")) {
        openFullVideo(tile);
        return;
      }
      startPlayback(tile, {});
      return;
    }
    if (act === "new-list") { openListModal(null); return; }
    if (act === "edit-list") {
      STATE.tabMenu = null;
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
      goHash("#/lists");
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
    if (act === "subs-group") {
      const id = el.dataset.group || "";
      const known = !!(id && (STATE.settings.groups || []).some((group) => group.id === id));
      STATE.settings.subsGroup = known ? id : "";
      STATE.groupMenu = null;
      saveSettings();
      goSubs(known ? id : "");
      return;
    }
    if (act === "group-new") {
      openGroupSheet(null, el.dataset.feed || "");
      return;
    }
    if (act === "group-edit") {
      const group = (STATE.settings.groups || []).find((item) => item.id === el.dataset.group);
      if (group) openGroupSheet(group);
      return;
    }
    if (act === "group-toggle") {
      const draft = STATE.draft;
      if (!draft) return;
      const id = el.dataset.id || "";
      const feed = feedById(id) || { id: id, platform: id.split(":")[0], handle: id.split(":").slice(1).join(":") };
      const keys = feedKeys(feed);
      if (window.FeedsPeople && window.FeedsPeople.followIds) {
        window.FeedsPeople.followIds(id).forEach((item) => { if (keys.indexOf(item) < 0) keys.push(item); });
      }
      draft.members = draft.members || [];
      if (keys.some((key) => draft.members.indexOf(key) >= 0)) draft.members = draft.members.filter((item) => keys.indexOf(item) < 0);
      else keys.forEach((key) => {
        if (draft.members.length < 200 && draft.members.indexOf(key) < 0) draft.members.push(key);
      });
      render();
      return;
    }
    if (act === "group-save") {
      const nameEl = document.getElementById("group-name");
      const iconEl = document.getElementById("group-icon");
      const name = String((nameEl && nameEl.value) || (STATE.draft && STATE.draft.name) || "").replace(/\s+/g, " ").trim().slice(0, 40);
      if (!name) return;
      const typed = String((iconEl && iconEl.value) || "").trim();
      const icon = /^https:\/\//.test(typed) && typed.length <= 300 ? typed : "";
      const members = ((STATE.draft && STATE.draft.members) || []).slice(0, 200);
      const editing = STATE.draft && STATE.draft.id;
      STATE.settings.groups = STATE.settings.groups || [];
      if (!editing && STATE.settings.groups.length >= 40) {
        toast("You can keep 40 groups");
        return;
      }
      let id = editing || "";
      if (editing) {
        const group = STATE.settings.groups.find((item) => item.id === editing);
        if (group) {
          group.name = name;
          group.icon = icon;
          group.members = members;
        }
      } else {
        id = "grp_" + Date.now().toString(36);
        STATE.settings.groups.push({ id: id, name: name, icon: icon, members: members });
      }
      STATE.settings.groupsOwn = true;
      STATE.settings.groups = cleanGroups(STATE.settings.groups);
      saveSettings();
      STATE.modal = null;
      STATE.draft = null;
      if (typed && !icon) toast("Icon needs an https URL");
      if (editing) render();
      else goSubs(id);
      return;
    }
    if (act === "group-delete") {
      const id = el.dataset.group || (STATE.draft && STATE.draft.id) || "";
      STATE.settings.groups = (STATE.settings.groups || []).filter((group) => group.id !== id);
      if (STATE.settings.subsGroup === id) STATE.settings.subsGroup = "";
      STATE.settings.groupsOwn = true;
      saveSettings();
      STATE.modal = null;
      STATE.groupMenu = null;
      STATE.draft = null;
      const encoded = encodeURIComponent(id);
      if (id && location.hash.indexOf("group=") >= 0 && location.hash.indexOf(encoded) >= 0) goHash("#/subscriptions");
      else render();
      return;
    }
    if (act === "group-move") {
      const groups = STATE.settings.groups || [];
      const index = groups.findIndex((group) => group.id === el.dataset.group);
      const dir = Number(el.dataset.dir) || 0;
      const next = index + dir;
      if (index < 0 || next < 0 || next >= groups.length) return;
      const swap = groups[index];
      groups[index] = groups[next];
      groups[next] = swap;
      STATE.settings.groupsOwn = true;
      STATE.groupMenu = null;
      saveSettings();
      render();
      return;
    }
    if (act === "group-add") {
      const group = (STATE.settings.groups || []).find((item) => item.id === el.dataset.group);
      const feedId = el.dataset.feed || "";
      if (!group || !feedId) return;
      const feed = feedById(feedId) || { id: feedId, platform: feedId.split(":")[0], handle: feedId.split(":").slice(1).join(":") };
      group.members = group.members || [];
      if (draftHas(group, feed)) group.members = group.members.filter((item) => feedKeys(feed).indexOf(item) < 0);
      else if (group.members.indexOf(feed.id) < 0 && group.members.length < 200) group.members.push(feed.id);
      STATE.settings.groupsOwn = true;
      saveSettings();
      render();
      return;
    }
    if (act === "group-publish") {
      window.open(groupsIssueUrl(), "_blank", "noopener,noreferrer");
      toast("Submit the issue on GitHub. Groups stay on this device until that list is published.");
      return;
    }
    if (act === "export") {
      const blob = new Blob([JSON.stringify({ version: 1, follows: STATE.settings.follows, seenFeeds: STATE.settings.seenFeeds || [], seenDefaults: STATE.settings.seenDefaults || STATE.settings.seenFeeds || [], lists: STATE.settings.lists, likes: STATE.settings.likes, bookmarks: STATE.settings.bookmarks, reposts: STATE.settings.reposts, savedPosts: STATE.settings.savedPosts || {}, appearance: STATE.settings.appearance || "lightsout", notify: !!STATE.settings.notify, autoplay: STATE.settings.autoplay || "all", mutedWords: STATE.settings.mutedWords || [], mutedAccounts: STATE.settings.mutedAccounts || [], repostOff: STATE.settings.repostOff || [], groups: STATE.settings.groups || [], groupsOwn: !!STATE.settings.groupsOwn, subsGroup: STATE.settings.subsGroup || "", followingSort: STATE.settings.followingSort === "popular" ? "popular" : "recent", forYouReposts: STATE.settings.forYouReposts !== false, forYouReplies: STATE.settings.forYouReplies !== false, tabViews: cleanTabViews(STATE.settings.tabViews), translateTo: (window.FeedsTranslate ? window.FeedsTranslate.normalize(STATE.settings.translateTo) : (STATE.settings.translateTo || "en")), bells: cleanBells(STATE.settings.bells), bellNotes: cleanBellNotes(STATE.settings.bellNotes), bellSeen: (STATE.settings.bellSeen || []).slice(-500), bellRead: Number(STATE.settings.bellRead) || 0, historyPause: cleanHistoryPause(STATE.settings.historyPause) }, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "superintelapp-settings.json";
      a.click();
      return;
    }
  }

  document.addEventListener("pointerdown", (event) => {
    if (window.innerWidth >= 500 || !STATE.tabMenu) return;
    const menu = event.target.closest && event.target.closest(".menu.tab-menu");
    if (!menu) return;
    const grab = event.target.closest(".tab-grab");
    if (!grab && menu.scrollTop > 2) return;
    tabSheetDrag = { id: event.pointerId, y: event.clientY, menu, dy: 0, grab: !!grab };
  });
  document.addEventListener("pointermove", (event) => {
    if (!tabSheetDrag || event.pointerId !== tabSheetDrag.id) return;
    const dy = event.clientY - tabSheetDrag.y;
    if (dy < 6 && !tabSheetDrag.grab) return;
    tabSheetDrag.dy = Math.max(0, dy);
    if (tabSheetDrag.dy < 8) return;
    tabSheetDrag.menu.style.transition = "none";
    tabSheetDrag.menu.style.transform = "translateY(" + tabSheetDrag.dy + "px)";
    if (event.cancelable) event.preventDefault();
  }, { passive: false });
  const endTabSheetDrag = (event) => {
    if (!tabSheetDrag || (event && event.pointerId !== tabSheetDrag.id)) return;
    const drag = tabSheetDrag;
    tabSheetDrag = null;
    if (drag.dy > 10) swallowTabSheet = true;
    if (drag.dy > 72) {
      closeTabMenu();
      return;
    }
    drag.menu.style.transition = "transform .18s ease";
    drag.menu.style.transform = "";
  };
  document.addEventListener("pointerup", endTabSheetDrag);
  document.addEventListener("pointercancel", endTabSheetDrag);

  document.addEventListener("click", (event) => {
    if (swallowTabSheet) {
      swallowTabSheet = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    const actEl = event.target.closest("[data-act]");
    if (actEl) {
      if (actEl.dataset.act !== "stop" && actEl.tagName !== "A") event.preventDefault();
      if (actEl.dataset.act !== "stop") event.stopPropagation();
      onAct(actEl);
      return;
    }
    if (window.innerWidth < 500 && event.target.closest(".topbar") && !event.target.closest("button, a, input, textarea, select")) {
      smoothTop();
      return;
    }
    if (event.target.closest("a, button, video, input, textarea, label")) return;
    const post = event.target.closest("[data-href], [data-open]");
    if (!post) return;
    if (post.dataset.href) window.open(post.dataset.href, "_blank", "noopener,noreferrer");
    else goHash(post.dataset.open);
  });

  let groupPress = 0;
  let groupPoint = null;
  let swallowGroupClick = false;
  document.addEventListener("contextmenu", (event) => {
    const target = groupTarget(event.target);
    if (!target) return;
    event.preventDefault();
    if (groupPoint) swallowGroupClick = true;
    clearTimeout(groupPress);
    groupPoint = null;
    openGroupMenu(target, event.clientX, event.clientY);
  });
  document.addEventListener("touchstart", (event) => {
    const target = groupTarget(event.target);
    if (!target || event.touches.length !== 1) return;
    const touch = event.touches[0];
    groupPoint = { x: touch.clientX, y: touch.clientY, target: target };
    clearTimeout(groupPress);
    groupPress = setTimeout(() => {
      swallowGroupClick = true;
      const point = groupPoint;
      groupPoint = null;
      if (point) openGroupMenu(point.target, point.x, point.y);
    }, 500);
  }, { passive: true });
  document.addEventListener("touchmove", (event) => {
    if (!groupPoint || !event.touches.length) return;
    const touch = event.touches[0];
    const dx = touch.clientX - groupPoint.x;
    const dy = touch.clientY - groupPoint.y;
    if (dx * dx + dy * dy > 100) {
      clearTimeout(groupPress);
      groupPoint = null;
    }
  }, { passive: true });
  const endGroupPress = () => { clearTimeout(groupPress); groupPoint = null; };
  document.addEventListener("touchend", endGroupPress, { passive: true });
  document.addEventListener("touchcancel", endGroupPress, { passive: true });
  document.addEventListener("click", (event) => {
    if (!STATE.tabMenu) return;
    if (event.target.closest && event.target.closest(".tab-menu, .tab-caret")) return;
    STATE.tabMenu = null;
    if (!(event.target.closest && event.target.closest("[data-act], a, [data-open]"))) setTimeout(render, 0);
  }, true);

  document.addEventListener("click", (event) => {
    if (swallowGroupClick) {
      swallowGroupClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (STATE.groupMenu && !(event.target.closest && event.target.closest(".group-menu"))) {
      STATE.groupMenu = null;
      setTimeout(render, 0);
    }
  }, true);

  document.addEventListener("input", (event) => {
    const el = event.target;
    if (el.id === "compose-text") {
      const btn = document.getElementById("compose-post");
      if (btn) btn.disabled = !el.value.trim();
      return;
    }
    if (el.id === "hist-q") {
      STATE.histQ = el.value;
      render();
      return;
    }
    if (el.dataset && el.dataset.field) {
      STATE.draft[el.dataset.field] = el.value;
      if (el.dataset.field === "name") {
        const save = document.querySelector("[data-act='save-list'], [data-act='group-save']");
        if (save) save.disabled = !el.value.trim();
      }
      if (el.dataset.field === "q" || el.dataset.field === "gq" || el.dataset.field === "icon") render();
    }
  });

  document.addEventListener("submit", (event) => {
    if (event.target.closest && event.target.closest("form.hist-search")) {
      event.preventDefault();
      const input = event.target.querySelector("#hist-q");
      STATE.histQ = input ? input.value : STATE.histQ;
      render();
      return;
    }
    const muteForm = event.target.closest("form.mute-form");
    if (muteForm) {
      event.preventDefault();
      const input = muteForm.querySelector("input");
      const raw = input ? input.value.trim() : "";
      if (!raw) return;
      const kind = muteForm.dataset.mute === "account" ? "mutedAccounts" : "mutedWords";
      let value = raw.replace(/^@/, "");
      if (kind === "mutedAccounts") {
        const parsed = parseAccountInput(raw);
        if (parsed && /^https?:/i.test(parsed.account)) {
          value = parsed.platform + ":" + (parsed.account.split("/").filter(Boolean).pop() || "").replace(/^@/, "");
        } else if (parsed) {
          const account = parsed.account.replace(/^@/, "");
          value = account.toLowerCase().indexOf(parsed.platform + ":") === 0 ? account : parsed.platform + ":" + account;
        }
      }
      value = value.trim();
      const list = STATE.settings[kind] || (STATE.settings[kind] = []);
      if (value && !list.some((item) => item.toLowerCase() === value.toLowerCase())) list.push(value);
      saveSettings();
      render();
      return;
    }
    const addForm = event.target.closest("form.add-account");
    if (addForm) {
      event.preventDefault();
      const input = addForm.querySelector("input");
      const parsed = parseAccountInput(input && input.value);
      if (!parsed) {
        toast("Use a profile URL, @handle, or an https feed");
        return;
      }
      window.open(followIssueUrl("follow", parsed.account, parsed.platform), "_blank", "noopener,noreferrer");
      toast("Follow request opened. Submit it on GitHub and the next sync will add this account.");
      return;
    }
    const form = event.target.closest("[data-act='search-form']");
    if (!form) return;
    event.preventDefault();
    const input = form.querySelector("input");
    const q = (input && input.value || "").trim();
    goHash("#/explore" + (q ? "?q=" + encodeURIComponent(q) : ""));
  });

  document.addEventListener("change", (event) => {
    if (event.target.id === "translate-to" && window.FeedsTranslate) {
      window.FeedsTranslate.setTarget(event.target.value);
      return;
    }
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
        if (Array.isArray(data.seenDefaults)) STATE.settings.seenDefaults = data.seenDefaults;
        else if (Array.isArray(data.seenFeeds)) STATE.settings.seenDefaults = data.seenFeeds.slice();
        if (Array.isArray(data.seenFeeds)) STATE.settings.seenFeeds = data.seenFeeds;
        if (Array.isArray(STATE.settings.seenDefaults)) STATE.settings.seenFeeds = STATE.settings.seenDefaults.slice();
        if (data.appearance) STATE.settings.appearance = data.appearance;
        if (data.autoplay === "all" || data.autoplay === "wifi" || data.autoplay === "never") STATE.settings.autoplay = data.autoplay;
        if (Array.isArray(data.mutedWords)) STATE.settings.mutedWords = data.mutedWords;
        if (Array.isArray(data.mutedAccounts)) STATE.settings.mutedAccounts = data.mutedAccounts;
        if (Array.isArray(data.repostOff)) STATE.settings.repostOff = data.repostOff;
        if (Array.isArray(data.groups)) {
          STATE.settings.groups = cleanGroups(data.groups);
          STATE.settings.groupsOwn = true;
        }
        if (typeof data.subsGroup === "string") STATE.settings.subsGroup = data.subsGroup;
        if (data.followingSort === "popular" || data.followingSort === "recent") STATE.settings.followingSort = data.followingSort;
        if (data.forYouReposts === false || data.forYouReposts === true) STATE.settings.forYouReposts = data.forYouReposts;
        if (data.forYouReplies === false || data.forYouReplies === true) STATE.settings.forYouReplies = data.forYouReplies;
        if (data.tabViews && typeof data.tabViews === "object") STATE.settings.tabViews = cleanTabViews(data.tabViews);
        if (data.translateTo && window.FeedsTranslate) STATE.settings.translateTo = window.FeedsTranslate.normalize(data.translateTo);
        if (data.bells && typeof data.bells === "object") STATE.settings.bells = cleanBells(data.bells);
        if (Array.isArray(data.bellNotes)) STATE.settings.bellNotes = cleanBellNotes(data.bellNotes);
        if (Array.isArray(data.bellSeen)) STATE.settings.bellSeen = data.bellSeen.map((id) => String(id)).slice(-500);
        if (data.bellRead) STATE.settings.bellRead = Number(data.bellRead) || 0;
        if (data.historyPause) STATE.settings.historyPause = cleanHistoryPause(data.historyPause);
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
    if (event.key === "Escape" && STATE.viewer && STATE.viewer.video) { closeViewer(); return; }
    if (event.key === "Escape" && (STATE.modal || STATE.drawer || STATE.menu || STATE.share || STATE.groupMenu || STATE.tabMenu || STATE.bellMenu || STATE.removeFeed)) {
      STATE.modal = null;
      STATE.drawer = false;
      STATE.menu = null;
      STATE.share = null;
      STATE.groupMenu = null;
      STATE.tabMenu = null;
      STATE.bellMenu = null;
      STATE.confirm = null;
      STATE.histClear = "";
      STATE.removeFeed = null;
      render();
    }
  });

  document.addEventListener("error", (event) => {
    const img = event.target;
    if (!img || (img.tagName !== "IMG" && img.tagName !== "VIDEO")) return;
    if (img.dataset.fallback === "avatar") {
      if (useArchiveMedia(img)) return;
      finishMediaError(img);
      return;
    }
    if (img.dataset && img.dataset.falls) {
      if (advancePoster(img)) return;
      if (useArchiveMedia(img)) return;
      finishMediaError(img);
      return;
    }
    const player = img.closest(".vplay");
    if (player) {
      if (img.tagName === "VIDEO") return;
      if (useArchiveMedia(img)) return;
      return;
    }
    const next = img.dataset.refresh || "";
    if (next && img.dataset.tried !== "1") {
      img.dataset.tried = "1";
      img.removeAttribute("data-refresh");
      img.src = next;
      return;
    }
    if (useArchiveMedia(img)) return;
    finishMediaError(img);
  }, true);

  let lastY = 0;
  window.addEventListener("message", (event) => {
    const host = String(event.origin || "");
    if (host.indexOf("youtube.com") < 0 && host.indexOf("youtube-nocookie.com") < 0) return;
    let data = event.data;
    if (typeof data === "string") {
      try { data = JSON.parse(data); } catch (err) { return; }
    }
    if (!data || typeof data !== "object") return;
    document.querySelectorAll(".vplay iframe").forEach((frame) => {
      if (frame.contentWindow !== event.source) return;
      const tile = frame.closest(".vplay");
      if (!tile) return;
      if (data.event === "onReady" && tile._nudge) {
        notePlay(tile, "youtube-ready");
        tile._nudge();
      }
      const info = data.info;
      let state = null;
      if (data.event === "onStateChange") state = info;
      else if (info && typeof info === "object" && info.playerState != null) state = info.playerState;
      if (info && typeof info === "object" && info.videoData && info.videoData.errorCode && !tile.classList.contains("is-shown")) notePlay(tile, "youtube-" + info.videoData.errorCode);
      if (state == null || state === "") return;
      const stateNum = Number(state);
      if (!isFinite(stateNum)) return;
      const current = info && typeof info === "object" ? Number(info.currentTime || 0) : 0;
      if (current >= 3) {
        const post = playPost(tile);
        if (post) noteVideo(post, { position: current, touch: false });
      }
      if (stateNum === 1 && !tile._ytClock) {
        tile._ytClock = setInterval(() => {
          if (!tile.isConnected) { clearInterval(tile._ytClock); tile._ytClock = 0; return; }
          try {
            frame.contentWindow.postMessage(JSON.stringify({ event: "command", func: "getCurrentTime", args: [], id: frame.id, channel: "widget" }), "*");
          } catch (err) { /* the embed may have moved */ }
        }, 2000);
      }
      if (stateNum === 1 || current > 0.15) {
        notePlay(tile, stateNum === 1 ? "youtube-playing" : "youtube-time");
        markShown(tile);
      } else if (stateNum === -1 || stateNum === 5) {
        notePlay(tile, "youtube-state-" + stateNum);
        tile._ytNudge = (tile._ytNudge || 0) + 1;
        if (tile._ytNudge <= 2 && tile._nudge && tile.dataset.want === "1") tile._nudge();
      } else if (stateNum === 0 || stateNum === 2 || stateNum === 3) {
        notePlay(tile, "youtube-state-" + stateNum);
      }
    });
  });
  window.addEventListener("scroll", () => {
    if (!routing && Math.abs(window.scrollY - previewAnchor) >= 24) STATE.scrolled = true;
    schedulePreview();
  }, { passive: true });
  window.addEventListener("resize", () => schedulePreview(), { passive: true });
  document.addEventListener("mouseover", (event) => {
    if (!subsDesktop()) return;
    const card = event.target.closest && event.target.closest(".yt-item, .yt-card, .short-card");
    if (!card) return;
    const thumb = card.querySelector(".vplay[data-preview='subs']");
    if (!thumb || STATE.subsHover === thumb) return;
    STATE.subsHover = thumb;
    schedulePreview();
  });
  document.addEventListener("mouseout", (event) => {
    const card = event.target.closest && event.target.closest(".yt-item, .yt-card, .short-card");
    if (!card || !STATE.subsHover || !card.contains(STATE.subsHover)) return;
    const to = event.relatedTarget;
    if (to && card.contains(to)) return;
    STATE.subsHover = null;
    schedulePreview();
  });
  const previewNet = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
  if (previewNet && previewNet.addEventListener) previewNet.addEventListener("change", () => schedulePreview());
  if (window.matchMedia) {
    const motion = window.matchMedia("(prefers-reduced-motion: reduce)");
    if (motion.addEventListener) motion.addEventListener("change", () => schedulePreview());
  }
  window.addEventListener("resize", () => { syncTabArrows(); placeTabMenu(); placeBellMenu(); });
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
    box.innerHTML = `<div class="hcard"><div class="hbanner" style="background:${profile.banner ? "url(" + encodeURI(profile.banner) + ") center/cover" : "var(--banner)"}"></div><div class="hbody"><div class="pava-row">${avatar(profile.avatar, profile.name, "pava")}${followButtonClean(id)}</div><div class="name" style="font-weight:800;margin-top:8px">${esc(profile.name || profile.handle || "")}${badge(profile.verifiedType)}</div>${handle ? `<div class="phandle">@${esc(handle)}</div>` : ""}${profile.bio ? `<div class="hbio">${esc(profile.bio)}</div>` : ""}${audienceCounts(profile)}</div></div>`;
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
    const feed = feedById(id) || catalogAccount(platform, handle);
    const live = STATE.liveUsers[liveKey(platform, handle)];
    const profile = feed || (live && live.profile);
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
  let scrollFreeze = false;
  window.addEventListener("scroll", () => {
    if (pageY() <= 4) STATE.snapTop = false;
    if (routing || scrollFreeze || !STATE.scrollKey) return;
    SCROLLS[STATE.scrollKey] = window.scrollY;
    const route = parseRoute();
    if (route.name !== "article") return;
    clearTimeout(STATE.articleScrollTimer);
    STATE.articleScrollTimer = setTimeout(() => {
      const post = findArticle(route.id);
      if (!post) return;
      const max = document.documentElement.scrollHeight - window.innerHeight;
      const ratio = max > 80 ? Math.max(0, Math.min(1, pageY() / max)) : 0;
      noteArticle(post, { scroll: ratio, touch: false });
    }, 400);
  }, { passive: true });
  document.addEventListener("click", (event) => {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const navLink = event.target.closest && event.target.closest(".nav-item, .bottom-nav a");
    if (navLink) {
      const href = navLink.getAttribute("href") || "";
      if (sameNavSection(parseRoute(), href)) {
        event.preventDefault();
        event.stopPropagation();
        if (pageY() > 4) smoothTop();
        else reloadAtTop();
        return;
      }
    }
    if (!STATE.scrollKey) return;
    const link = event.target.closest && event.target.closest("a[href^='#']");
    const openerEl = !link && event.target.closest ? event.target.closest("[data-open]") : null;
    const opener = openerEl && !(event.target.closest && event.target.closest("a, button, input, textarea")) ? openerEl : null;
    const tab = event.target.closest && event.target.closest("[data-act='htab']");
    let next = "";
    if (link) next = link.getAttribute("href") || "";
    else if (opener) next = opener.dataset.open || "";
    else if (tab) {
      const id = tab.dataset.tab || "";
      const route = parseRoute();
      if (route.name === "home" && (route.tab || "foryou") === id) return;
      if (id) next = homeHash(id);
    }
    if (!next || next === (location.hash || "#/") || next === location.hash) return;
    SCROLLS[STATE.scrollKey] = window.scrollY;
    scrollFreeze = true;
  }, true);
  window.addEventListener("hashchange", () => {
    const nextHash = location.hash || "#/";
    const prevHash = lastKey || "";
    if (/^#\/messages(?:[/?]|$)/.test(prevHash) && /^#\/messages(?:[/?]|$)/.test(nextHash) && window.FeedsDiscord && window.FeedsDiscord.syncFromHash) {
      lastKey = nextHash;
      STATE.scrollKey = "#/messages";
      routing = false;
      scrollFreeze = false;
      window.FeedsDiscord.syncFromHash();
      return;
    }
    routing = true;
    scrollFreeze = true;
    STATE.modal = null;
    STATE.drawer = false;
    STATE.menu = null;
    STATE.share = null;
    STATE.groupMenu = null;
    STATE.bellMenu = null;
    STATE.headerHidden = false;
    const key = routeScrollKey();
    const y = SCROLLS[key] || 0;
    showPill(pendingPillPosts());
    render({
      y: y,
      done: () => {
        routing = false;
        scrollFreeze = false;
      }
    });
  });

  function resolvedTheme() {
    const mode = (STATE.settings && STATE.settings.appearance) || "lightsout";
    if (mode === "auto") return matchMedia("(prefers-color-scheme: light)").matches ? "default" : "lightsout";
    return THEME_COLORS[mode] ? mode : "lightsout";
  }

  function applyTheme() {
    const theme = resolvedTheme();
    document.documentElement.setAttribute("data-theme", theme);
    const color = THEME_COLORS[theme] || "#000000";
    document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => meta.setAttribute("content", color));
    const scheme = document.querySelector('meta[name="color-scheme"]');
    if (scheme) scheme.setAttribute("content", theme === "default" ? "light" : "dark");
    const bar = document.querySelector('meta[name="apple-mobile-web-app-status-bar-style"]');
    if (bar) bar.setAttribute("content", "black-translucent");
  }

  function slimPost(post) {
    if (!post) return null;
    const media = (post.media || []).slice(0, 4).map((item) => ({ type: item.type, url: item.url || "", poster: item.poster || "", alt: item.alt || "" }));
    const row = {
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
    const article = slimArticle(post.article);
    if (article) row.article = article;
    if (post.link && post.link.url) row.link = { url: post.link.url, title: post.link.title || "", description: post.link.description || "", image: post.link.image || "", site: post.link.site || "" };
    return row;
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
    queueBookmarkMedia(urls);
  }

  function queueBookmarkMedia(urls) {
    const list = (urls || []).filter((url) => /^https:/.test(url || ""));
    if (!list.length) return;
    const worker = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (worker && navigator.onLine) {
      worker.postMessage({ type: "cache-bookmark", urls: list });
      return;
    }
    let queued = [];
    try { queued = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch (err) { queued = []; }
    if (!Array.isArray(queued)) queued = [];
    list.forEach((url) => { if (queued.indexOf(url) < 0 && queued.length < 80) queued.push(url); });
    try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queued)); } catch (err) { /* the bookmark itself is already stored */ }
  }

  function flushBookmarkQueue() {
    if (!navigator.onLine) return;
    let queued = [];
    try { queued = JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]"); } catch (err) { queued = []; }
    if (!Array.isArray(queued) || !queued.length) return;
    const worker = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!worker) return;
    worker.postMessage({ type: "cache-bookmark", urls: queued });
    try { localStorage.removeItem(QUEUE_KEY); } catch (err) { /* retry on the next online event */ }
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

  const LIVE_REFRESH_MS = 2 * 60 * 1000;

  function pendingPillPosts() {
    const live = (STATE.pendingLive || []).filter(Boolean);
    const doc = STATE.pendingFeed;
    if (!doc || !Array.isArray(doc.posts)) return live;
    const current = {};
    ((STATE.data && STATE.data.posts) || []).forEach((post) => {
      if (!post) return;
      current[canonicalPostId(post)] = true;
      if (post.id) current[String(post.id)] = true;
    });
    const added = doc.posts.filter((post) => post && !current[canonicalPostId(post)] && !current[String(post.id || "")]);
    return added.concat(live);
  }

  function showPill(posts) {
    const el = document.getElementById("new-posts");
    if (!el) return;
    const route = parseRoute();
    let list = Array.isArray(posts) ? posts.filter(Boolean) : [];
    if (route.name !== "home") { el.hidden = true; return; }
    list = list.filter((post) => homeShows(post, route));
    if (!list.length) { el.hidden = true; return; }
    const faces = [];
    const seen = {};
    list.forEach((post) => {
      const who = post.repostedBy || {};
      const src = who.avatar || post.avatar || "";
      const seenKey = who.handle || post.handle || src;
      if (!src || seen[seenKey] || faces.length >= 3) return;
      seen[seenKey] = true;
      faces.push(src);
    });
    const avatars = faces.map((src) => `<img class="pill-ava" alt="" src="${esc(src)}">`).join("");
    el.innerHTML = (avatars ? `<span class="pill-faces">${avatars}</span>` : "") + "<span>New posts</span>";
    el.hidden = false;
  }

  function memoryPosts() {
    if (!STATE.memoryPosts) STATE.memoryPosts = [];
    return STATE.memoryPosts;
  }

  function memoryKey(post) {
    return (post && post.platform || "") + ":" + (canonicalPostId(post) || (post && post.id) || "");
  }

  function rememberTimeline(items) {
    const have = {};
    memoryPosts().forEach((post) => { have[memoryKey(post)] = true; });
    (items || []).forEach((post) => {
      if (!post || !post.id) return;
      const key = memoryKey(post);
      if (have[key]) return;
      have[key] = true;
      memoryPosts().push(post);
    });
  }

  function withMemory(doc) {
    if (!doc) return doc;
    const posts = (doc.posts || []).slice();
    const have = {};
    posts.forEach((post) => { have[memoryKey(post)] = true; });
    memoryPosts().forEach((post) => {
      const key = memoryKey(post);
      if (have[key]) return;
      have[key] = true;
      posts.push(post);
    });
    return Object.assign({}, doc, { posts: posts });
  }

  function belongsToFeed(post, feed) {
    if (!post || !feed) return false;
    if (post.feedId && post.feedId === feed.id) return true;
    const platform = post.platform || feed.platform || "";
    const handle = String(feed.handle || "").toLowerCase();
    if (platform === (feed.platform || "") && String(post.handle || "").toLowerCase() === handle) return true;
    const by = post.repostedBy && String(post.repostedBy.handle || "").toLowerCase();
    return !!by && by === handle && platform === (feed.platform || "");
  }

  function takeFresh(feed, incoming) {
    const known = {};
    let newest = 0;
    posts().forEach((post) => {
      if (!belongsToFeed(post, feed)) return;
      known[canonicalPostId(post)] = true;
      known[String(post.id || "")] = true;
      const ms = timeMs(post.sortDate || post.date || "");
      if (ms > newest) newest = ms;
    });
    const out = [];
    (incoming || []).forEach((post) => {
      if (!post || out.length >= 20) return;
      const id = canonicalPostId(post);
      if (!id) return;
      post.feedId = feed.id;
      if (!post.platform) post.platform = feed.platform;
      if ((post.platform || "") === "youtube" && String(post.id || "").indexOf("repost:") !== 0) {
        post.id = id;
        post.statusId = id;
      }
      if (post.kind === "repost" && post.repostedBy && !post.repostedBy.avatar && feed.avatar) post.repostedBy.avatar = feed.avatar;
      if (post.kind === "repost" && post.repostedBy && feed.name && post.repostedBy.name === post.repostedBy.handle) post.repostedBy.name = feed.name;
      if (known[id] || known[String(post.id || "")]) return;
      const ms = timeMs(post.sortDate || post.date || "");
      if (!ms || (newest && ms <= newest)) return;
      known[id] = true;
      out.push(post);
    });
    return out;
  }

  function settlePublishTimes(feed, incoming) {
    const byId = {};
    posts().forEach((post) => {
      if (!belongsToFeed(post, feed)) return;
      const id = canonicalPostId(post);
      if (id) byId[id] = post;
    });
    (incoming || []).forEach((post) => {
      const known = byId[canonicalPostId(post)];
      if (!known) return;
      const next = earlierIso(known.date, post.date);
      if (next && next !== known.date) known.date = next;
    });
  }

  function lockDocDates(doc) {
    if (!doc || !Array.isArray(doc.posts)) return doc;
    const previous = {};
    const consider = (post) => {
      if (!post) return;
      const id = canonicalPostId(post);
      if (!id) return;
      previous[id] = earlierIso(previous[id], post.date);
    };
    ((STATE.data && STATE.data.posts) || []).forEach(consider);
    memoryPosts().forEach(consider);
    doc.posts.forEach((post) => {
      const id = canonicalPostId(post);
      if ((post.platform || "") === "youtube" && id && String(post.id || "").indexOf("repost:") !== 0) {
        post.id = id;
        post.statusId = id;
      }
      if (id && previous[id]) post.date = earlierIso(previous[id], post.date);
    });
    return doc;
  }

  function seenPostIds() {
    const ids = [];
    const have = {};
    const add = (id) => {
      id = String(id || "");
      if (!id || have[id] || ids.length >= 400) return;
      have[id] = true;
      ids.push(id);
    };
    posts().forEach((post) => {
      add(canonicalPostId(post));
      add(post && post.id);
    });
    return ids;
  }

  function mapLimit(items, limit, fn) {
    const out = new Array(items.length);
    let next = 0;
    const workers = [];
    const count = Math.min(limit, items.length);
    for (let i = 0; i < count; i++) {
      workers.push((async function () {
        while (next < items.length) {
          const index = next++;
          try { out[index] = await fn(items[index]); }
          catch (err) { out[index] = []; }
        }
      })());
    }
    return Promise.all(workers).then(() => out);
  }

  function loadCatalog() {
    if (STATE.catalog) return Promise.resolve(STATE.catalog);
    if (STATE.catalogP) return STATE.catalogP;
    STATE.catalogP = fetch("feeds.config.json", { cache: "no-cache" }).then((res) => (res.ok ? res.json() : null)).then((doc) => {
      STATE.catalog = doc;
      return doc;
    }).catch(() => null);
    return STATE.catalogP;
  }

  function expandSource(template, config, feed) {
    return String(template || "")
      .replaceAll("{rsshubBase}", (config && config.rsshubBase) || "")
      .replaceAll("{fxtwitterBase}", (config && config.fxtwitterBase) || "")
      .replaceAll("{base}", (config && config.rsshubBase) || "")
      .replaceAll("{handle}", (feed && feed.handle) || "")
      .replaceAll("{channelId}", (feed && feed.channelId) || "");
  }

  function httpsSources(config, entry) {
    const urls = [];
    const add = (list) => (list || []).forEach((raw) => {
      const url = expandSource(raw, config, entry);
      if (/^https:\/\//i.test(url)) urls.push(url);
    });
    add(entry && entry.source_urls);
    ((entry && entry.fallbacks) || []).forEach((fallback) => add(fallback.source_urls));
    return urls;
  }

  function xmlText(node, names) {
    const all = node.getElementsByTagName("*");
    const want = {};
    names.forEach((name) => { want[name] = true; });
    const found = {};
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      const tag = String(el.localName || el.tagName || "").toLowerCase();
      if (want[tag] && found[tag] == null) found[tag] = (el.textContent || "").trim();
    }
    for (let i = 0; i < names.length; i++) {
      if (found[names[i]]) return found[names[i]];
    }
    return "";
  }

  function parseFeedXml(xml, feed) {
    if (!xml || typeof DOMParser === "undefined") return [];
    const doc = new DOMParser().parseFromString(xml, "text/xml");
    if (!doc || doc.querySelector("parsererror")) return [];
    const nodes = doc.getElementsByTagName("item");
    const entries = nodes.length ? nodes : doc.getElementsByTagName("entry");
    const out = [];
    for (let i = 0; i < entries.length && out.length < 20; i++) {
      const node = entries[i];
      const title = ((node.getElementsByTagName("title")[0] && node.getElementsByTagName("title")[0].textContent) || "").trim();
      const linkNode = node.getElementsByTagName("link")[0];
      const link = (linkNode && (linkNode.getAttribute("href") || linkNode.textContent)) || "";
      const published = xmlText(node, ["published", "pubdate", "updated"]);
      const summary = (node.getElementsByTagName("description")[0] && node.getElementsByTagName("description")[0].textContent)
        || (node.getElementsByTagName("summary")[0] && node.getElementsByTagName("summary")[0].textContent)
        || (node.getElementsByTagName("content")[0] && node.getElementsByTagName("content")[0].textContent)
        || "";
      const holder = document.createElement("div");
      holder.innerHTML = summary;
      const text = (holder.textContent || "").replace(/\s+/g, " ").trim() || title;
      const videoId = xmlText(node, ["videoid"]);
      const guid = xmlText(node, ["guid", "id"]) || link || title;
      if (!text && !title) continue;
      const post = {
        id: String(guid).slice(0, 180),
        statusId: String(guid).slice(0, 180),
        platform: feed.platform || "rss",
        feedId: feed.id,
        kind: "post",
        author: feed.name || feed.handle || "",
        handle: feed.handle || "",
        avatar: feed.avatar || "",
        text: text,
        title: title,
        date: isoDate(published),
        url: link,
        media: [],
        stats: {}
      };
      if ((feed.platform || "") === "youtube") {
        const cid = canonicalPostId({ platform: "youtube", id: videoId || guid, url: link });
        if (cid) {
          post.id = cid;
          post.statusId = cid;
        }
      }
      out.push(post);
    }
    return out;
  }

  function liveX(feed) {
    const handle = feed.handle;
    if (!handle || LIVE.fxDown) return nitterPosts(handle || "").then((rows) => rows || []);
    return nitterPosts(handle).then((rows) => {
      if (rows && rows.length) return rows;
      return fxTimeline(handle, "home", "").then((pack) => (pack && pack.posts) || []);
    }).then((rows) => {
      (rows || []).forEach((post) => {
        post.feedId = feed.id;
        post.platform = "x";
        if (post.kind === "repost" && post.repostedBy) {
          if (!post.repostedBy.avatar && feed.avatar) post.repostedBy.avatar = feed.avatar;
          if (feed.name && (!post.repostedBy.name || post.repostedBy.name === post.repostedBy.handle)) post.repostedBy.name = feed.name;
        }
      });
      return rows || [];
    });
  }

  function mergeLiveYoutube(feed, incoming, rssRows) {
    const rssDate = {};
    (rssRows || []).forEach((post) => {
      const id = canonicalPostId(post);
      if (id && post.date) rssDate[id] = earlierIso(rssDate[id], post.date);
    });
    const stored = {};
    posts().forEach((post) => {
      if (!belongsToFeed(post, feed)) return;
      const id = canonicalPostId(post);
      if (id) stored[id] = earlierIso(stored[id], post.date);
    });
    const seen = {};
    const out = [];
    (incoming || []).concat(rssRows || []).forEach((post) => {
      if (!post) return;
      const id = canonicalPostId(post);
      if (!id || seen[id]) return;
      seen[id] = true;
      const copy = Object.assign({}, post);
      copy.id = id;
      copy.statusId = id;
      copy.feedId = feed.id;
      copy.platform = "youtube";
      copy.date = earlierIso(stored[id], earlierIso(rssDate[id], copy.date || ""));
      out.push(copy);
    });
    return out;
  }

  function liveYoutube(feed, config) {
    const id = feed.channelId || feed.handle;
    if (!id) return Promise.resolve([]);
    const profile = {
      name: feed.name || feed.handle || "",
      displayHandle: feed.handle || "",
      channelId: feed.channelId || id,
      avatar: feed.avatar || "",
      verifiedType: feed.verifiedType || ""
    };
    const videosP = rotate(ivBases(), "/api/v1/channels/" + encodeURIComponent(id), 3, "ivBase").then((data) => {
      const authorId = (data && data.authorId) || feed.channelId || (/^UC[\w-]{10,}$/.test(id) ? id : "");
      const videos = ivVideoPosts({ videos: (data && (data.latestVideos || data.videos)) || [] }, profile);
      if (!authorId) return videos;
      return rotate(ivBases(), "/api/v1/channels/" + encodeURIComponent(authorId) + "/community", 3, "ivBase").then((community) => {
        const posts = ((community && community.comments) || []).map((item) => ivCommunityPost(item, profile)).filter((post) => post && post.text);
        return videos.concat(posts);
      }).catch(() => videos);
    }).catch(() => []);
    return Promise.all([videosP, liveConfigured(feed, config)]).then((pair) => mergeLiveYoutube(feed, pair[0], pair[1]));
  }

  function liveConfigured(feed, config) {
    const entry = ((config && config.feeds) || []).find((item) => item && item.id === feed.id) || null;
    const urls = httpsSources(config, entry);
    if (!urls.length) return Promise.resolve([]);
    const url = urls[0];
    return fetch(url, { cache: "no-cache", signal: AbortSignal.timeout(8000) }).then((res) => {
      if (!res.ok) throw new Error(String(res.status));
      return res.text();
    }).then((xml) => {
      if ((entry && entry.adapter) === "nitter_rss" || /<item/i.test(xml) && /RT by @/i.test(xml)) return parseNitterRss(xml, feed.handle);
      return parseFeedXml(xml, feed);
    }).catch(() => []);
  }

  function livePostsForFeed(feed, config) {
    const platform = feed.platform || "";
    if (platform === "x") return liveX(feed);
    if (platform === "vk") return Promise.resolve([]);
    if (platform === "youtube") return liveYoutube(feed, config);
    return liveConfigured(feed, config);
  }

  function attachParents(items) {
    const need = [];
    (items || []).forEach((post) => {
      if (!post || post.kind !== "reply" || post.replyParent) return;
      const id = post.replyingTo && post.replyingTo.id;
      if (!id) return;
      const have = posts().find((item) => String(item.statusId || item.id) === String(id));
      if (have) { post.replyParent = have; return; }
      if (need.length < 4) need.push(post);
    });
    return Promise.all(need.map((post) => fxStatusPost(post.replyingTo.id).then((parent) => {
      if (parent) post.replyParent = parent;
    })));
  }

  function followedFeeds() {
    const follows = (STATE.settings && STATE.settings.follows) || [];
    return feeds().filter((feed) => feed && feed.id && follows.indexOf(feed.id) >= 0);
  }

  function applyLive(items, scroll) {
    if (!items.length) return;
    rememberTimeline(items);
    if (STATE.data) STATE.data = withMemory(STATE.data);
    STATE.pendingLive = [];
    showPill([]);
    render(scroll ? { y: 0 } : undefined);
    ensureVideoOwners();
      }

  let liveRefreshFlight = null;
  function refreshLiveTimeline(apply) {
    if (liveRefreshFlight) return liveRefreshFlight;
    const job = loadCatalog().then((config) => {
      const selected = followedFeeds();
      return mapLimit(selected, 3, (feed) => livePostsForFeed(feed, config).catch(() => [])).then((lists) => {
        let incoming = [];
        lists.forEach((list, index) => {
          const feed = selected[index];
          stampActivity(list || []);
          settlePublishTimes(feed, list || []);
          incoming = incoming.concat(takeFresh(feed, list || []));
        });
        if (!incoming.length) return;
        return attachParents(incoming).then(() => {
          const route = parseRoute();
          const atTop = window.scrollY < 80 && route.name === "home";
          if (apply || atTop) applyLive(incoming, true);
          else {
            STATE.pendingLive = (STATE.pendingLive || []).concat(incoming);
            showPill(STATE.pendingLive);
            if (document.hidden) updateBadge(STATE.pendingLive.length);
          }
        });
      });
    }).catch(() => {});
    liveRefreshFlight = job.finally(() => { liveRefreshFlight = null; });
    return liveRefreshFlight;
  }

  async function fetchFeeds(fresh) {
    const headers = fresh ? { "X-Feed-Refresh": "1" } : {};
    const init = fresh ? { cache: "no-store", headers: headers } : { credentials: "omit" };
    const res = await fetch("feeds.json", init);
    if (!res.ok) throw new Error(String(res.status));
    return res.json();
  }

  function catalogSignature(doc) {
    return ((doc && doc.feeds) || []).map((feed) => {
      if (!feed || !feed.id) return "";
      return feed.id + (feed.configured ? "*" : "");
    }).sort().join("|");
  }

  function adoptFeeds(doc) {
    if (!doc || !STATE.data) return;
    STATE.data.feeds = doc.feeds || [];
    STATE.settings = loadSettings();
    saveSettings();
  }

  async function refreshFeeds(apply) {
    try {
      const doc = lockDocDates(await fetchFeeds(true));
      if (!doc || !Array.isArray(doc.posts)) return;
      const current = {};
      ((STATE.data && STATE.data.posts) || []).forEach((post) => {
        current[canonicalPostId(post)] = true;
        if (post.id) current[String(post.id)] = true;
      });
      const added = doc.posts.filter((post) => post && !current[canonicalPostId(post)] && !current[String(post.id || "")]);
      const feedsChanged = catalogSignature(STATE.data) !== catalogSignature(doc);
      if (apply || !STATE.data || (feedsChanged && !added.length)) {
        notePublished(doc);
        STATE.data = withMemory(doc);
        STATE.error = null;
        STATE.pendingFeed = null;
        if (!(STATE.pendingLive || []).length) showPill([]);
        if (feedsChanged) adoptFeeds(doc);
        render();
        scanBellPosts(doc.posts);
        ensureVideoOwners();
        return;
      }
      if (feedsChanged) {
        adoptFeeds(doc);
        render();
      }
      scanBellPosts(doc.posts);
      if (!added.length) return;
      STATE.pendingFeed = doc;
      showPill(added.concat(STATE.pendingLive || []));
      const since = Number(localStorage.getItem("rss-feeds-seen-at") || 0);
      const fresh = added.filter((post) => followedSince(post, since) && !coveredByBell(post));
      if (document.hidden) updateBadge(Math.max(fresh.length, bellUnread()));
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
        artist: post.author || post.handle || "SuperintelApp",
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
    el.textContent = "You're offline. Showing saved posts.";
    if (was && !offline) {
      toast("You're back online");
      flushBookmarkQueue();
    }
  }

  function scheduleIdleReload() {
    if (STATE.idleReload) return;
    if (sessionStorage.getItem("rss-feeds-sw-reload") === "1") return;
    STATE.idleReload = true;
    let timer = 0;
    const go = () => {
      if (sessionStorage.getItem("rss-feeds-sw-reload") === "1") return;
      const busy = [...document.querySelectorAll("video")].some((video) => video && !video.paused && !video.ended) || !!(window.Spaces && window.Spaces.playing && window.Spaces.playing());
      if (busy && document.visibilityState === "visible") {
        timer = setTimeout(go, 4000);
        return;
      }
      sessionStorage.setItem("rss-feeds-sw-reload", "1");
      location.reload();
    };
    const bump = () => {
      clearTimeout(timer);
      timer = setTimeout(go, 1600);
    };
    ["pointerdown", "keydown", "touchstart", "wheel"].forEach((name) => window.addEventListener(name, bump, { passive: true }));
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") go();
    });
    bump();
  }

  function showUpdate() {
    const el = document.getElementById("update");
    if (el) el.hidden = false;
    scheduleIdleReload();
  }

  function photoList(post) {
    return ((post && post.media) || []).filter((item) => item && item.type !== "video" && item.type !== "animated_gif" && item.type !== "embed" && (item.url || item.poster));
  }

  function paintViewer() {
    const box = document.getElementById("viewer");
    if (!box) return;
    const view = STATE.viewer;
    if (!view) { box.hidden = true; box.innerHTML = ""; return; }
    if (view.video) {
      const post = findAnyPost(view.id);
      const media = view.media || ((post && post.media) || []).find((item) => item && (item.type === "video" || item.type === "animated_gif")) || {};
      box.hidden = false;
      box.innerHTML = `<button class="viewer-x" type="button" data-act="close-viewer" aria-label="Close">×</button><video id="viewer-video" playsinline controls></video>`;
      const video = document.getElementById("viewer-video");
      if (!video) return;
      video.playsInline = true;
      video.muted = false;
      video.preload = "auto";
      const seek = () => {
        if (view.time > 0.3) { try { video.currentTime = view.time; } catch (err) { /* not seekable yet */ } }
      };
      const startFile = (url, kind) => {
        const go = () => { seek(); video.play().catch(() => {}); };
        if (kind === "hls" && !video.canPlayType("application/vnd.apple.mpegurl")) {
          loadHls().then((Hls) => {
            if (!STATE.viewer || !STATE.viewer.video || !Hls || !Hls.isSupported) return;
            const hls = new Hls();
            hls.loadSource(url);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, go);
          });
          return;
        }
        video.src = url;
        if (video.readyState >= 1) go();
        else video.addEventListener("loadedmetadata", go, { once: true });
      };
      if (view.src && playableFile(view.src)) {
        startFile(view.src, /\.m3u8(\?|$)/i.test(view.src) ? "hls" : "mp4");
        return;
      }
      sourcesFor(post || {}, media, 0).then((list) => {
        if (!STATE.viewer || !STATE.viewer.video) return;
        const file = (list || []).find((row) => row && row.kind !== "iframe" && row.url);
        if (!file) {
          const poster = (media && (media.poster || media.url)) || "";
          const href = originalOf(post || {}, media);
          box.innerHTML = `<button class="viewer-x" type="button" data-act="close-viewer" aria-label="Close">×</button>${poster ? `<img alt="" src="${esc(poster)}" referrerpolicy="no-referrer">` : ""}<a class="open-original" data-act="stop" target="_blank" rel="noopener noreferrer" href="${esc(href || "#")}">${esc(watchOn((post && post.platform) || ""))}</a>`;
          return;
        }
        startFile(file.url, file.kind === "hls" ? "hls" : "mp4");
      }).catch(() => {});
      return;
    }
    const post = findAnyPost(view.id);
    const photos = photoList(post);
    const item = photos[view.index] || photos[0];
    if (!item) { STATE.viewer = null; box.hidden = true; box.innerHTML = ""; return; }
    box.hidden = false;
    box.innerHTML = `<button class="viewer-x" type="button" data-act="close-viewer" aria-label="Close">×</button><img id="viewer-img" alt="${esc(item.alt || "")}" src="${esc(item.url || item.poster)}" referrerpolicy="no-referrer" decoding="async" draggable="false"><div class="viewer-count">${photos.length > 1 ? (view.index + 1) + " / " + photos.length : ""}</div>`;
    const img = document.getElementById("viewer-img");
    if (img) img.style.transform = "translate3d(0,0,0) scale(1)";
  }

  function openVideoViewer(post, media, src, time) {
    if (STATE.autoEl) pausePreview(STATE.autoEl);
    STATE.autoEl = null;
    const clean = src && src.indexOf("about:blank") < 0 ? src : "";
    STATE.viewer = { id: post.id, index: 0, scale: 1, x: 0, y: 0, video: true, time: time || 0, src: clean, media: media || null };
    paintViewer();
  }

  function openViewer(id, index) {
    const post = findAnyPost(id);
    const photos = photoList(post);
    if (!photos.length) return;
    const at = Math.max(0, Math.min(photos.length - 1, index || 0));
    STATE.viewer = { id: id, index: at, scale: 1, x: 0, y: 0 };
    paintViewer();
  }

  function closeViewer() {
    const box = document.getElementById("viewer");
    if (box) box.querySelectorAll("video").forEach((video) => {
      try { video.pause(); video.removeAttribute("src"); video.load(); } catch (err) { /* the viewer is closing */ }
    });
    STATE.viewer = null;
    paintViewer();
    schedulePreview();
  }

  function shiftViewer(delta) {
    const view = STATE.viewer;
    if (!view) return;
    const photos = photoList(findAnyPost(view.id));
    if (photos.length < 2) return;
    view.index = (view.index + delta + photos.length) % photos.length;
    view.scale = 1;
    view.x = 0;
    view.y = 0;
    paintViewer();
  }

  function parseSharedLink(raw) {
    const found = String(raw || "").match(/https?:\/\/[^\s]+/);
    const text = found ? found[0].replace(/[),.;]+$/, "") : "";
    if (!text) return null;
    let loc;
    try { loc = new URL(text); } catch (err) { return null; }
    const host = loc.hostname.replace(/^www\./, "").toLowerCase();
    const parts = loc.pathname.split("/").filter(Boolean).map((part) => {
      try { return decodeURIComponent(part); } catch (err) { return part; }
    });
    const skip = { home: 1, share: 1, intent: 1, search: 1, i: 1, explore: 1, stories: 1 };
    const known = posts().find((post) => {
      const url = String(post.url || "").split("?")[0].replace(/\/$/, "");
      const clean = text.split("?")[0].replace(/\/$/, "");
      return url && (url === clean || clean.indexOf(url) >= 0);
    });
    if (known && known.platform === "youtube" && (known.media || []).some((item) => item && item.type === "video")) return watchHash(known);
    if (known) return statusHash(known);
    if (host === "x.com" || host === "twitter.com" || host === "mobile.x.com" || host === "mobile.twitter.com") {
      const handle = (parts[0] || "").replace(/^@/, "");
      if (handle && parts[1] === "status" && parts[2]) return statusHash({ platform: "x", handle: handle, statusId: parts[2].split("?")[0] });
      if (handle && !skip[handle]) return accountHash("x", handle);
    }
    if (host === "threads.com" || host === "threads.net") {
      const handle = (parts[0] || "").replace(/^@/, "");
      if (handle && parts[1] === "post" && parts[2]) {
        const hit = posts().find((post) => post.platform === "threads" && String(post.url || "").indexOf(parts[2]) >= 0);
        return hit ? statusHash(hit) : accountHash("threads", handle);
      }
      if (parts[0] === "t" && parts[1]) {
        const hit = posts().find((post) => post.platform === "threads" && String(post.url || "").indexOf(parts[1]) >= 0);
        if (hit) return statusHash(hit);
      }
      if (handle && !skip[handle]) return accountHash("threads", handle);
    }
    if (host === "instagram.com") {
      if ((parts[0] === "p" || parts[0] === "reel" || parts[0] === "tv") && parts[1]) {
        const hit = posts().find((post) => post.platform === "instagram" && String(post.url || "").indexOf(parts[1]) >= 0);
        if (hit) return statusHash(hit);
        return "";
      }
      const handle = parts[0] || "";
      if (handle && !skip[handle]) return accountHash("instagram", handle);
    }
    if (host === "youtu.be" && parts[0]) return "#/watch/youtube:" + encodeURIComponent(parts[0]);
    if (host === "youtube.com" || host === "m.youtube.com" || host === "music.youtube.com") {
      if (parts[0] === "watch") {
        const id = loc.searchParams.get("v") || "";
        if (id) return "#/watch/youtube:" + encodeURIComponent(id);
      }
      if ((parts[0] === "shorts" || parts[0] === "embed" || parts[0] === "live") && parts[1]) return "#/watch/youtube:" + encodeURIComponent(parts[1]);
      if (parts[0] === "post" && parts[1]) {
        const hit = posts().find((post) => String(post.id) === parts[1] || String(post.url || "").indexOf(parts[1]) >= 0);
        if (hit) return statusHash(hit);
      }
      if ((parts[0] || "").charAt(0) === "@") return accountHash("youtube", parts[0].slice(1));
      if (parts[0] === "channel" && parts[1]) return accountHash("youtube", parts[1]);
    }
    if (host === "vk.com" || host === "m.vk.com" || host === "vk.ru") {
      const wall = (parts[0] || "").match(/^wall(-?\d+_\d+)$/);
      if (wall) {
        const hit = posts().find((post) => String(post.statusId || post.id) === wall[1] || String(post.url || "").indexOf("wall" + wall[1]) >= 0 || String(post.url || "").indexOf("wall-" + wall[1].replace(/^-/, "")) >= 0);
        if (hit) return statusHash(hit);
      }
      const handle = parts[0] || "";
      if (handle && handle.indexOf("wall") !== 0 && !skip[handle]) return accountHash("vk", handle);
    }
    const feed = feeds().find((item) => item.url && text.indexOf(item.url) === 0);
    if (feed) return accountHash(feed.platform, feed.channelId || feed.handle);
    return "";
  }

  function consumeShareTarget() {
    const params = new URLSearchParams(location.search);
    if (!params.has("url") && !params.has("text") && !params.has("title")) return;
    STATE.incoming = { title: params.get("title") || "", text: params.get("text") || "", url: params.get("url") || "" };
    const shared = parseSharedLink([params.get("url"), params.get("text"), params.get("title")].filter(Boolean).join(" "));
    const hash = shared || (location.hash && location.hash !== "#/" && location.hash !== "#/home" ? location.hash : "#/incoming");
    history.replaceState(null, "", location.pathname + hash);
  }

  function postIsLiveVideo(post) {
    if (!post) return false;
    if (post.live || post.isLive || post.premiere) return true;
    if (post.kind === "live" || post.kind === "premiere") return true;
    const media = post.media || [];
    for (let i = 0; i < media.length; i++) {
      const item = media[i];
      if (item && (item.live || item.premiere)) return true;
    }
    const blob = [post.url, post.title, post.text].join("\n");
    if ((post.platform || "") !== "youtube") return false;
    if (/\/live(\/|$|\?)/i.test(blob)) return true;
    return /\bpremieres?\b|\blive stream\b|\blive now\b|\bis live\b/i.test(blob);
  }

  function bellTargets(id) {
    const ids = [];
    const handles = [];
    const addId = (value) => {
      const text = String(value || "");
      if (text && ids.indexOf(text) < 0 && ids.length < 12) ids.push(text);
    };
    const addHandle = (platform, handle) => {
      const key = ((platform || "x") + ":" + String(handle || "").replace(/^@/, "")).toLowerCase();
      if (key.length > 2 && handles.indexOf(key) < 0 && handles.length < 24) handles.push(key);
    };
    const followed = window.FeedsPeople && window.FeedsPeople.followIds ? window.FeedsPeople.followIds(id) : [id];
    (followed.length ? followed : [id]).forEach(addId);
    addId(id);
    ids.slice().forEach((fid) => {
      const feed = feedById(fid);
      if (!feed) {
        const cut = fid.indexOf(":");
        if (cut > 0) addHandle(fid.slice(0, cut), fid.slice(cut + 1));
        return;
      }
      addHandle(feed.platform, feed.handle);
      if (feed.channelId) addHandle(feed.platform, feed.channelId);
    });
    let person = null;
    if (window.FeedsPeople) {
      person = window.FeedsPeople.byId(String(id).replace(/^person:/, ""));
      if (!person && window.FeedsPeople.match) {
        const feed = feedById(id);
        if (feed) person = window.FeedsPeople.match(feed.platform, feed.handle);
      }
    }
    if (person && person.accounts) {
      person.accounts.forEach((account) => {
        if (account.feedId) addId(account.feedId);
        addHandle(account.platform, account.handle);
        if (account.channelId) addHandle(account.platform, account.channelId);
      });
    }
    return { ids: ids, handles: handles };
  }

  function bellKeyFor(id, targets) {
    const bells = (STATE.settings && STATE.settings.bells) || {};
    const keys = Object.keys(bells);
    for (let i = 0; i < keys.length; i++) {
      const row = bells[keys[i]] || {};
      if (keys[i] === id || (row.ids || []).some((item) => (targets.ids || []).indexOf(item) >= 0)) return keys[i];
    }
    return (targets.ids && targets.ids[0]) || id;
  }

  function bellHandle(id) {
    const feed = feedById(id) || liveProfileById(id);
    if (feed && feed.handle) return String(feed.handle).replace(/^@/, "");
    const cut = String(id).indexOf(":");
    return cut > 0 ? id.slice(cut + 1) : String(id || "");
  }

  function bellName(id) {
    const feed = feedById(id) || liveProfileById(id);
    return (feed && (feed.name || feed.handle)) || bellHandle(id);
  }

  function bellMatches(post, row) {
    if (!post || !row) return false;
    const feedId = String(post.feedId || "");
    if (feedId && (row.ids || []).indexOf(feedId) >= 0) return true;
    const key = ((post.platform || "x") + ":" + (post.handle || "")).toLowerCase();
    if ((row.handles || []).indexOf(key) >= 0) return true;
    const plain = (post.platform || "x") + ":" + (post.handle || "");
    return (row.ids || []).indexOf(plain) >= 0;
  }

  function bellStillFollowed(post, row) {
    if (isFollowed(post.feedId) || isFollowed((post.platform || "x") + ":" + (post.handle || ""))) return true;
    return (row.ids || []).some((item) => isFollowed(item));
  }

  function postImageUrl(post) {
    const media = (post && post.media) || [];
    let poster = "";
    for (let i = 0; i < media.length; i++) {
      const item = media[i];
      if (!item) continue;
      if (item.type === "photo" && httpsUrl(item.url)) return item.url;
      if (!poster && httpsUrl(item.poster)) poster = item.poster;
    }
    return poster;
  }

  function bellNoteFrom(post, row) {
    const text = String(post.text || post.title || "").replace(/\s+/g, " ").trim().slice(0, 180);
    return {
      id: String(canonicalPostId(post) || post.id || ""),
      at: Date.now(),
      handle: (row && row.handle) || post.handle || "",
      name: post.author || (row && row.name) || post.handle || "",
      text: text,
      avatar: httpsUrl(post.avatar),
      image: postImageUrl(post),
      hash: statusHash(post)
    };
  }

  function rememberLoadedPosts() {
    const seen = {};
    (STATE.settings.bellSeen || []).forEach((id) => { if (id) seen[String(id)] = true; });
    posts().forEach((post) => {
      const id = String(canonicalPostId(post) || (post && post.id) || "");
      if (id) seen[id] = true;
      if (post && post.id) seen[String(post.id)] = true;
    });
    STATE.settings.bellSeen = Object.keys(seen).slice(-500);
  }

  function paintBellBadge() {
    const count = bellUnread();
    updateBadge(count);
    document.querySelectorAll(".nav-badge").forEach((el) => el.remove());
    if (!count || parseRoute().name === "notifications") return;
    const label = count > 20 ? "20+" : String(count);
    document.querySelectorAll('a[href="#/notifications"]').forEach((link) => {
      const host = link.querySelector(".nav-ico") || link;
      if (host.querySelector(".nav-badge")) return;
      const span = document.createElement("span");
      span.className = "nav-badge";
      span.textContent = label;
      host.appendChild(span);
    });
  }

  function commitBellNotes(list) {
    const seen = {};
    (STATE.settings.bellSeen || []).forEach((id) => { if (id) seen[String(id)] = true; });
    const have = {};
    (STATE.settings.bellNotes || []).forEach((note) => { if (note && note.id) have[String(note.id)] = true; });
    const added = [];
    (list || []).forEach((note) => {
      if (!note || !note.id) return;
      const id = String(note.id);
      if (seen[id] || have[id]) return;
      seen[id] = true;
      have[id] = true;
      added.push(note);
    });
    if (!added.length) return;
    STATE.settings.bellSeen = Object.keys(seen).slice(-500);
    STATE.settings.bellNotes = cleanBellNotes(added.concat(STATE.settings.bellNotes || []));
    saveSettings();
    if (parseRoute().name === "notifications") render();
    else paintBellBadge();
  }

  function showLocalNotification(note) {
    if (!note || typeof Notification === "undefined" || Notification.permission !== "granted") return;
    try {
      const item = new Notification(note.name || ("@" + (note.handle || "post")), {
        body: note.text || "New post",
        icon: note.avatar || "icons/icon-192.png",
        tag: "bell-" + note.id
      });
      item.onclick = () => {
        window.focus();
        location.hash = note.hash || "#/";
        item.close();
      };
    } catch (err) { /* the in-app list still has the post */ }
  }

  function showPageNotification(note) {
    const payload = {
      body: note.text || "New post",
      icon: note.avatar || "icons/icon-192.png",
      image: note.image || undefined,
      tag: "bell-" + note.id,
      data: { hash: note.hash || "#/" }
    };
    const title = note.name || ("@" + (note.handle || "post"));
    const viaRegistration = () => {
      if (!("serviceWorker" in navigator)) return Promise.reject();
      return navigator.serviceWorker.ready.then((reg) => {
        if (!reg || !reg.showNotification) return Promise.reject();
        return reg.showNotification(title, payload);
      });
    };
    const timed = new Promise((_, reject) => setTimeout(() => reject(new Error("notify")), 2000));
    Promise.race([viaRegistration(), timed]).catch(() => showLocalNotification(note));
  }

  function deliverBellNotes(notes) {
    const list = (notes || []).filter((note) => note && note.id);
    if (!list.length) return;
    const worker = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (!worker) {
      commitBellNotes(list);
      list.forEach(showPageNotification);
      return;
    }
    worker.postMessage({ type: "bell-deliver", notes: list });
  }

  function pullBellQueue() {
    const worker = navigator.serviceWorker && navigator.serviceWorker.controller;
    if (worker) worker.postMessage({ type: "bell-pull" });
  }

  function scanBellPosts(list) {
    if (!STATE.settings) return;
    const bells = STATE.settings.bells || {};
    const keys = Object.keys(bells);
    if (!keys.length) return;
    const seen = {};
    (STATE.settings.bellSeen || []).forEach((id) => { if (id) seen[String(id)] = true; });
    const fresh = [];
    (list || posts()).forEach((post) => {
      if (!post || hiddenPost(post)) return;
      const id = String(canonicalPostId(post) || post.id || "");
      if (!id || seen[id] || seen[String(post.id || "")]) return;
      const when = Date.parse(post.date || "") || 0;
      if (!when) return;
      let hit = null;
      for (let i = 0; i < keys.length; i++) {
        const row = bells[keys[i]];
        if (!row || (row.mode !== "all" && row.mode !== "live")) continue;
        if (!bellMatches(post, row) || !bellStillFollowed(post, row)) continue;
        if (when < Number(row.since || 0)) continue;
        if (row.mode === "live" && !postIsLiveVideo(post)) continue;
        hit = row;
        break;
      }
      if (!hit) return;
      const note = bellNoteFrom(post, hit);
      if (!note.id) return;
      seen[note.id] = true;
      fresh.push(note);
    });
    if (fresh.length) deliverBellNotes(fresh);
  }

  function coveredByBell(post) {
    const bells = (STATE.settings && STATE.settings.bells) || {};
    const keys = Object.keys(bells);
    for (let i = 0; i < keys.length; i++) {
      const row = bells[keys[i]];
      if (!row || !bellMatches(post, row)) continue;
      if (row.mode === "live" && !postIsLiveVideo(post)) continue;
      if (row.mode === "all" || row.mode === "live") return true;
    }
    return false;
  }

  async function ensureNotifyPermission() {
    if (typeof Notification === "undefined") return true;
    let permission = Notification.permission;
    if (permission !== "granted") {
      try { permission = await Notification.requestPermission(); }
      catch (err) { permission = "denied"; }
    }
    if (permission !== "granted") return false;
    registerPeriodic();
    return true;
  }

  async function setBellMode(id, mode, handle) {
    if (!id || !STATE.settings) return;
    if (!STATE.settings.bells || typeof STATE.settings.bells !== "object" || Array.isArray(STATE.settings.bells)) STATE.settings.bells = {};
    const targets = bellTargets(id);
    const key = bellKeyFor(id, targets);
    const prev = STATE.settings.bells[key];
    STATE.bellMenu = null;
    if (mode !== "all" && mode !== "live") {
      delete STATE.settings.bells[key];
      saveSettings();
      render();
      return;
    }
    if (prev && prev.mode === mode) {
      render();
      return;
    }
    render();
    const allowed = await ensureNotifyPermission();
    if (!allowed) {
      toast("Notifications stay off");
      return;
    }
    STATE.settings.bells[key] = {
      mode: mode,
      since: Date.now(),
      ids: targets.ids,
      handles: targets.handles,
      handle: String(handle || bellHandle(id)).replace(/^@/, ""),
      name: bellName(id)
    };
    rememberLoadedPosts();
    saveSettings();
    registerPeriodic();
    render();
    toast("You'll get notified when @" + STATE.settings.bells[key].handle + " posts.");
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
      follows: STATE.settings.follows || [],
      ids: seenPostIds(),
      bells: cleanBells(STATE.settings.bells),
      bellSeen: (STATE.settings.bellSeen || []).slice(-500),
      mutedWords: STATE.settings.mutedWords || [],
      mutedAccounts: STATE.settings.mutedAccounts || [],
      repostOff: STATE.settings.repostOff || [],
      notifyAll: !!STATE.settings.notify
    });
  }

  let swStarted = false;
  function registerSW() {
    if (!("serviceWorker" in navigator) || swStarted) return;
    swStarted = true;
    navigator.serviceWorker.register("sw.js", { updateViaCache: "none" }).then((reg) => {
      if (reg && reg.update) reg.update().catch(() => {});
      syncWorkerState();
      if (STATE.settings && STATE.settings.notify && typeof Notification !== "undefined" && Notification.permission === "granted") registerPeriodic();
    }).catch(() => {});
    navigator.serviceWorker.addEventListener("message", (event) => {
      const data = event.data || {};
      if (data.type === "data" && /feeds\.json$/.test(data.url || "")) refreshFeeds(false);
      if (data.type === "feeds-updated") refreshFeeds(false);
      if (data.type === "bell-delivered" || data.type === "bell-queue") commitBellNotes(data.notes || []);
      if (data.type === "reload-when-idle") {
        STATE.swUpdate = true;
        showUpdate();
      }
    });
  }

  let shellBound = false;
  function bindShell() {
    if (shellBound) return;
    shellBound = true;
    window.addEventListener("online", () => setOffline(false));
    window.addEventListener("offline", () => setOffline(true));
    setOffline(!navigator.onLine);
    const updateGo = document.getElementById("update-go");
    if (updateGo) updateGo.addEventListener("click", () => location.reload());
    setTimeout(() => {
      if (!STATE.idleReload) sessionStorage.removeItem("rss-feeds-sw-reload");
    }, 8000);
    if ("serviceWorker" in navigator) {
      const armServiceWorker = () => {
        const worker = navigator.serviceWorker.controller;
        if (worker) worker.postMessage({ type: "reload-armed" });
      };
      let hadController = !!navigator.serviceWorker.controller;
      armServiceWorker();
      navigator.serviceWorker.addEventListener("controllerchange", () => {
        armServiceWorker();
        if (!hadController) { hadController = true; return; }
        if (sessionStorage.getItem("rss-feeds-sw-reload") === "1") return;
        sessionStorage.setItem("rss-feeds-sw-reload", "1");
        location.reload();
      });
    }
    bindGestures();
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
      if (parseRoute().name !== "home") { showPill(pendingPillPosts()); return; }
      const pending = STATE.pendingLive || [];
      if (!STATE.pendingFeed && !pending.length) { showPill([]); return; }
      if (STATE.pendingFeed) {
        notePublished(STATE.pendingFeed);
        STATE.data = STATE.pendingFeed;
      }
      STATE.pendingFeed = null;
      if (pending.length) rememberTimeline(pending);
      STATE.pendingLive = [];
      if (STATE.data) STATE.data = withMemory(STATE.data);
      showPill([]);
      ensureVideoOwners();
      localStorage.setItem("rss-feeds-seen-at", String(Date.now()));
      updateBadge(bellUnread());
      const worker = navigator.serviceWorker && navigator.serviceWorker.controller;
      if (worker) worker.postMessage({ type: "seen", ids: seenPostIds() });
      const route = parseRoute();
      const popular = route.name === "home" && tabSort(route.tab || "foryou") === "popular";
      render(popular ? undefined : { y: 0 });
    });
    let pullStart = 0;
    let pulling = false;
    document.addEventListener("touchstart", (event) => {
      if (STATE.viewer || window.scrollY > 2 || event.touches.length !== 1) { pulling = false; return; }
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
        refreshLiveTimeline(true);
      }
    }, { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        localStorage.setItem("rss-feeds-seen-at", String(Date.now()));
        updateBadge(bellUnread());
        const worker = navigator.serviceWorker && navigator.serviceWorker.controller;
        if (worker) worker.postMessage({ type: "seen", ids: seenPostIds() });
        pullBellQueue();
        refreshFeeds(false);
        refreshLiveTimeline(false);
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

  function bindGestures() {
    let swipe = null;
    let pinch = null;
    const viewerBox = () => document.getElementById("viewer");
    document.addEventListener("touchstart", (event) => {
      const box = viewerBox();
      if (box && !box.hidden && event.target.closest("#viewer")) {
        if (event.touches.length === 2 && STATE.viewer) {
          const a = event.touches[0];
          const b = event.touches[1];
          pinch = { dist: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, scale: STATE.viewer.scale || 1 };
          swipe = null;
          return;
        }
        if (event.touches.length === 1) {
          swipe = { x: event.touches[0].clientX, y: event.touches[0].clientY, viewer: true };
        }
        return;
      }
      if (event.touches.length !== 1) return;
      swipe = { x: event.touches[0].clientX, y: event.touches[0].clientY, viewer: false };
    }, { passive: true });
    document.addEventListener("touchmove", (event) => {
      const view = STATE.viewer;
      const img = document.getElementById("viewer-img");
      if (!view || !img) return;
      if (event.touches.length === 2 && pinch) {
        const a = event.touches[0];
        const b = event.touches[1];
        const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1;
        view.scale = Math.max(1, Math.min(4, pinch.scale * (dist / pinch.dist)));
        img.style.transform = "translate3d(" + (view.x || 0) + "px," + (view.y || 0) + "px,0) scale(" + view.scale + ")";
        return;
      }
      if (!swipe || !swipe.viewer || event.touches.length !== 1) return;
      const dx = event.touches[0].clientX - swipe.x;
      const dy = event.touches[0].clientY - swipe.y;
      if ((view.scale || 1) > 1.05) {
        view.x = dx;
        view.y = dy;
      }
      img.style.transform = "translate3d(" + dx + "px," + dy + "px,0) scale(" + (view.scale || 1) + ")";
    }, { passive: true });
    document.addEventListener("touchend", (event) => {
      const view = STATE.viewer;
      if (pinch && event.touches.length < 2) pinch = null;
      if (!swipe) return;
      const end = event.changedTouches[0];
      const dx = end.clientX - swipe.x;
      const dy = end.clientY - swipe.y;
      const fromViewer = swipe.viewer;
      const startX = swipe.x;
      swipe = null;
      if (fromViewer && view) {
        if (view.video) {
          if (dy > 90 && Math.abs(dy) > Math.abs(dx)) closeViewer();
          return;
        }
        if ((view.scale || 1) <= 1.05 && dy > 90 && Math.abs(dy) > Math.abs(dx)) { closeViewer(); return; }
        if ((view.scale || 1) <= 1.05 && Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy)) { shiftViewer(dx < 0 ? 1 : -1); return; }
        view.scale = (view.scale || 1) < 1.05 ? 1 : view.scale;
        view.x = 0;
        view.y = 0;
        const img = document.getElementById("viewer-img");
        if (img) img.style.transform = "translate3d(0,0,0) scale(" + (view.scale || 1) + ")";
        return;
      }
      if (Math.abs(dx) < 72 || Math.abs(dx) < Math.abs(dy) * 1.2) {
        if (startX < 28 && dx > 72 && Math.abs(dy) < 80 && parseRoute().name !== "home") history.back();
        return;
      }
      const route = parseRoute();
      if (route.name !== "home") {
        if (startX < 28 && dx > 72) history.back();
        return;
      }
      const tab = route.tab === "following" ? "following" : "foryou";
      if (dx < 0 && tab === "foryou") goHash(homeHash("following"));
      else if (dx > 0 && tab === "following") goHash(homeHash("foryou"));
    }, { passive: true });
  }

  async function boot() {
    consumeShareTarget();
    bindShell();
    registerSW();
    STATE.error = null;
    loadStatus();
    STATE.settings = loadSettings();
    applyTheme();
    histLoad().then(() => { histSyncSaves(); if (parseRoute().name === "history") render(); });
    loadCatalog().then((config) => { if (absorbSiteGroups(config)) render(); }).catch(() => {});
    const snap = loadTimelineSnap();
    if (snap) {
      notePublished(snap);
      STATE.data = snap;
      STATE.loading = false;
      render({ reset: true });
      ensureVideoOwners();
    } else {
      STATE.loading = true;
      render();
    }
    flushBookmarkQueue();
    const params = new URLSearchParams(location.search);
    try {
      if (params.get("error") === "1") throw new Error("forced");
      const loaded = lockDocDates(await fetchFeeds(false));
      notePublished(loaded);
      STATE.data = loaded;
      saveTimelineSnap(STATE.data);
      ensureVideoOwners();
      applyIaPreview(STATE.data);
      STATE.settings = loadSettings();
      applyTheme();
      STATE.loading = false;
      saveSettings();
      Promise.resolve(STATE.histLoading).then(() => histSyncSaves());
      if (STATE.incoming && (location.hash === "#/incoming" || location.hash === "#/" || location.hash === "")) {
        const shared = parseSharedLink([STATE.incoming.url, STATE.incoming.text, STATE.incoming.title].filter(Boolean).join(" "));
        if (shared) {
          history.replaceState(null, "", location.pathname + shared);
        }
      }
      render({ reset: true });
      loadNewestShard().then(() => {
        if (applyIaPreview(STATE.data)) render({ reset: true });
        revealArchive();
      });
      const since = Number(localStorage.getItem("rss-feeds-seen-at") || 0);
      const seenIds = {};
      ((snap && snap.posts) || []).forEach((post) => {
        seenIds[canonicalPostId(post)] = true;
        if (post && post.id) seenIds[String(post.id)] = true;
      });
      const fresh = (STATE.data.posts || []).filter((post) => followedSince(post, since) && !seenIds[canonicalPostId(post)] && !seenIds[String(post.id || "")] && !coveredByBell(post));
      const periodic = "serviceWorker" in navigator && "periodicSync" in ServiceWorkerRegistration.prototype;
      if (since && fresh.length && STATE.settings.notify && !periodic && typeof Notification !== "undefined" && Notification.permission === "granted") {
        try { new Notification("New posts", { body: fresh.length + " new posts from accounts you follow", icon: "icons/icon-192.png", tag: "feeds" }); } catch (err) { /* already handled by the pill when a later refresh arrives */ }
      }
      if (document.visibilityState === "visible") {
        localStorage.setItem("rss-feeds-seen-at", String(Date.now()));
        updateBadge(bellUnread());
      } else if (fresh.length || bellUnread()) updateBadge(Math.max(fresh.length, bellUnread()));
      scanBellPosts(STATE.data.posts);
      if ("serviceWorker" in navigator) navigator.serviceWorker.ready.then(() => pullBellQueue()).catch(() => {});
      refreshLiveTimeline(false);
      if (!STATE.liveTimer) {
        STATE.liveTimer = setInterval(() => {
          if (document.visibilityState === "visible") refreshLiveTimeline(false);
        }, LIVE_REFRESH_MS);
      }
    } catch (err) {
      STATE.loading = false;
      if (STATE.data && Array.isArray(STATE.data.posts) && STATE.data.posts.length) {
        STATE.error = null;
        if (!navigator.onLine) setOffline(true);
        render();
      } else {
        STATE.error = err;
        render({ reset: true });
      }
    }
  }

  if (window.FeedsTV && window.FeedsTV.attach) window.FeedsTV.attach();
  if (window.FeedsTranslate) window.FeedsTranslate.bind({ state: STATE, linkify: linkify, esc: esc, render: render, save: saveSettings, textHtml: textHtml });
  if (window.FeedsPeople) {
    window.FeedsPeople.bind({
      esc: esc, avatar: avatar, icon: icon, bioBlock: bioBlock, card: card, formatCount: formatCount,
      followButtonClean: followButtonClean, bellButton: bellButton, emptyBlock: emptyBlock, archiveSentinel: archiveSentinel,
      sourceBadge: sourceBadge, posts: posts, feeds: feeds, ensureYtMeta: ensureYtMeta,
      statusHash: statusHash, watchHash: watchHash, render: render
    });
    window.FeedsPeople.start();
  }
  if (window.FeedsDiscord) {
    window.FeedsDiscord.bind({
      esc: esc,
      render: render,
      stay: () => { scrollFreeze = false; routing = false; },
      noteHash: (hash) => {
        lastKey = hash || (location.hash || "#/");
        STATE.scrollKey = "#/messages";
      }
    });
    window.FeedsDiscord.start();
  }
  if (window.Spaces) {
    window.Spaces.bind({
      isFollowed: isFollowed,
      render: render,
      findFeed: findFeed,
      shareRoot: shareRoot,
      toast: toast
    });
    window.Spaces.start();
  }
  boot();
})();
