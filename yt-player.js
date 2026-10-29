/**
 * Modern YouTube (2026) HTML5 Video Player
 * Unified player engine for native <video> elements and YouTube iframes.
 *
 * Features:
 * - Real-Time Dynamic Ambient Mode (canvas backlight glow)
 * - Modern Floating Frosted Glass Pill/Capsule Controls (.ytp-pill-left, .ytp-pill-right)
 * - Press & Hold 2x Speed with Top-Center Floating Speed Badge
 * - Pill-Shaped Timeline Scrubber with Timestamp Hover Tooltip
 * - Next & Replay buttons in Left Capsule Pod
 * - Glassmorphic Settings Menu with Ambient Mode & Loop Toggles
 * - Center Bezel Pulse & Double-Tap 10s Quick-Seek Ripples
 * - Seamless support for both HTML5 <video> and YouTube <iframe> embeds
 */

(function (root, factory) {
  if (typeof define === "function" && define.amd) {
    define([], factory);
  } else if (typeof module === "object" && module.exports) {
    module.exports = factory();
  } else {
    root.YtPlayer = factory();
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  function tr(key) {
    if (typeof window !== "undefined" && typeof window.tr === "function") {
      return window.tr(key);
    }
    return key;
  }

  function formatTime(sec) {
    if (!isFinite(sec) || isNaN(sec) || sec < 0) sec = 0;
    var total = Math.floor(sec);
    var h = Math.floor(total / 3600);
    var m = Math.floor((total % 3600) / 60);
    var s = total % 60;
    var sStr = s < 10 ? "0" + s : String(s);
    if (h > 0) {
      var mStr = m < 10 ? "0" + m : String(m);
      return h + ":" + mStr + ":" + sStr;
    }
    return m + ":" + sStr;
  }

  var ICONS = {
    play: '<path d="M8 5v14l11-7z"></path>',
    pause: '<path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"></path>',
    replay: '<path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"></path>',
    next: '<path d="M6 18l8.5-6L6 6v12zM16 6v12h2V6h-2z"></path>',
    prev: '<path d="M6 6h2v12H6V6zm3.5 6l8.5 6V6l-8.5 6z"></path>',
    download: '<path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"></path>',
    volumeHigh: '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"></path>',
    volumeLow: '<path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z"></path>',
    volumeMuted: '<path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"></path>',
    settings: '<path d="M19.14,12.94c0.04-0.3,0.06-0.61,0.06-0.94c0-0.32-0.02-0.64-0.07-0.94l2.03-1.58c0.18-0.14,0.23-0.41,0.12-0.61 l-1.92-3.32c-0.12-0.22-0.37-0.29-0.59-0.22l-2.39,0.96c-0.5-0.38-1.03-0.7-1.62-0.94L14.4,2.81c-0.04-0.24-0.24-0.41-0.48-0.41 h-3.84c-0.24,0-0.43,0.17-0.47,0.41L9.25,5.35C8.66,5.59,8.12,5.92,7.63,6.29L5.24,5.33c-0.22-0.08-0.47,0-0.59,0.22L2.73,8.87 c-0.11,0.2-0.06,0.47,0.12,0.61l2.03,1.58c-0.05,0.3-0.09,0.63-0.09,0.94s0.02,0.64,0.07,0.94l-2.03,1.58 c-0.18,0.14-0.23,0.41-0.12,0.61l1.92,3.32c0.12,0.22,0.37,0.29,0.59,0.22l2.39-0.96c0.5,0.38,1.03,0.7,1.62,0.94l0.36,2.54 c0.05,0.24,0.24,0.41,0.48,0.41h3.84c0.24,0,0.44-0.17,0.47-0.41l0.36-2.54c0.59-0.24,1.13-0.56,1.62-0.94l2.39,0.96 c0.22,0.08,0.47,0,0.59-0.22l1.92-3.32c0.11-0.2,0.07-0.47-0.12-0.61L19.14,12.94z M12,15.6c-1.98,0-3.6-1.62-3.6-3.6 s1.62-3.6,3.6-3.6s3.6,1.62,3.6,3.6S13.98,15.6,12,15.6z"></path>',
    pip: '<path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 1.98 2 1.98h18c1.1 0 2-.88 2-1.98V5c0-1.1-.9-2-2-2zm0 16.01H3V4.98h18v14.03z"></path>',
    fullscreenEnter: '<path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"></path>',
    fullscreenExit: '<path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-14v3h3v2h-5V5h2z"></path>',
    ambient: '<path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm1 17.93V17a1 1 0 0 0-2 0v2.93A8 8 0 0 1 4.07 13H7a1 1 0 0 0 0-2H4.07A8 8 0 0 1 11 4.07V7a1 1 0 0 0 2 0V4.07A8 8 0 0 1 19.93 11H17a1 1 0 0 0 0 2h2.93A8 8 0 0 1 13 19.93z"></path>',
    forward10: '<path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"></path>',
    replay10: '<path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"></path>'
  };

  function svg(pathHtml, viewBox) {
    return '<svg viewBox="' + (viewBox || "0 0 24 24") + '" width="100%" height="100%">' + pathHtml + '</svg>';
  }

  function YtPlayer(container, options) {
    options = options || {};
    this.container = container;
    this.options = options;
    this.autoHideTimer_ = 0;
    this.lastTapTime_ = 0;
    this.lastTapX_ = 0;
    this.lastVolume_ = 1;
    this.isScrubbing_ = false;
    this.disposed_ = false;
    this.ambientEnabled_ = true;
    this.holdTimer_ = 0;
    this.isHolding_ = false;
    this.origRateBeforeHold_ = 1;

    // State for iframes
    this.isIframe_ = !!options.iframe;
    this.iframe_ = options.iframe || null;
    this.iframeDuration_ = 0;
    this.iframeCurrentTime_ = 0;
    this.iframeVolume_ = 1;
    this.iframeMuted_ = false;
    this.iframeRate_ = 1;
    this.iframePaused_ = false;
    this.iframeTicker_ = 0;

    try {
      var savedAmbient = localStorage.getItem("yt-ambient-mode");
      if (savedAmbient === "0") this.ambientEnabled_ = false;
    } catch (e) {}

    this.initDom_();
    this.bindEvents_();
    this.updateControls_();
    this.startAmbientLoop_();
  }

  YtPlayer.prototype.initDom_ = function () {
    var opts = this.options;

    var player = document.createElement("div");
    player.className = "html5-video-player paused-mode" + (this.ambientEnabled_ ? "" : " ytp-ambient-off");
    player.tabIndex = 0;
    player.setAttribute("role", "region");
    player.setAttribute("aria-label", tr("YouTube video player"));
    this.el = player;

    // Ambient Canvas (Real-Time Color Bleed Glow)
    var ambientCanvas = document.createElement("canvas");
    ambientCanvas.className = "ytp-ambient-glow";
    ambientCanvas.width = 16;
    ambientCanvas.height = 9;
    this.ambientCanvas_ = ambientCanvas;
    this.ambientCtx_ = ambientCanvas.getContext ? ambientCanvas.getContext("2d", { willReadFrequently: false }) : null;
    player.appendChild(ambientCanvas);

    // Video Stage Container
    var videoContainer = document.createElement("div");
    videoContainer.className = "html5-video-container";

    if (this.isIframe_) {
      var frame = this.iframe_;
      frame.classList.add("video-stream", "html5-main-video");
      videoContainer.appendChild(frame);

      // Transparent click shield over iframe so clicks/gestures don't get trapped in cross-origin frame
      var clickShield = document.createElement("div");
      clickShield.className = "ytp-video-click-target";
      videoContainer.appendChild(clickShield);
      this.clickShield_ = clickShield;
    } else {
      var video = opts.video;
      if (!video) {
        video = document.createElement("video");
        video.playsInline = true;
        video.setAttribute("playsinline", "");
        video.setAttribute("webkit-playsinline", "");
        video.setAttribute("referrerpolicy", "no-referrer");
        if (opts.src) video.src = opts.src;
      }
      video.controls = false;
      video.classList.add("video-stream", "html5-main-video");
      var poster = opts.poster || (opts.media && (opts.media.poster || opts.media.url)) || (opts.post && (opts.post.thumbnail || opts.post.avatar || opts.post.poster)) || "";
      if (poster && !video.poster && typeof poster === "string" && poster.indexOf(".mp4") < 0) {
        video.poster = poster;
      }
      this.video = video;
      videoContainer.appendChild(video);
    }
    player.appendChild(videoContainer);

    // Subtle modern vignette gradients
    var gradTop = document.createElement("div");
    gradTop.className = "ytp-gradient-top";
    player.appendChild(gradTop);

    var gradBottom = document.createElement("div");
    gradBottom.className = "ytp-gradient-bottom";
    player.appendChild(gradBottom);

    // Press and Hold 2x Speed Floating Badge
    var speedBadge = document.createElement("div");
    speedBadge.className = "ytp-speed-indicator";
    speedBadge.innerHTML = '<span class="ytp-speed-arrow">▶▶</span> <span class="ytp-speed-label">' + tr("2x Speed") + '</span>';
    this.speedBadge_ = speedBadge;
    player.appendChild(speedBadge);

    // Center Pulse Bezel
    var bezel = document.createElement("div");
    bezel.className = "ytp-bezel";
    bezel.innerHTML = '<div class="ytp-bezel-icon"></div>';
    this.bezel_ = bezel;
    player.appendChild(bezel);

    // Double-tap Quick Seek Ripples
    var quickSeekLeft = document.createElement("div");
    quickSeekLeft.className = "ytp-quick-seek ytp-quick-seek-left";
    quickSeekLeft.innerHTML = '<div class="ytp-bezel-icon">' + svg(ICONS.replay10) + '</div><div class="ytp-quick-seek-text">10s</div>';
    this.quickSeekLeft_ = quickSeekLeft;
    player.appendChild(quickSeekLeft);

    var quickSeekRight = document.createElement("div");
    quickSeekRight.className = "ytp-quick-seek ytp-quick-seek-right";
    quickSeekRight.innerHTML = '<div class="ytp-bezel-icon">' + svg(ICONS.forward10) + '</div><div class="ytp-quick-seek-text">10s</div>';
    this.quickSeekRight_ = quickSeekRight;
    player.appendChild(quickSeekRight);

    // Top Chrome (Video Title)
    var title = (opts.post && (opts.post.title || opts.post.text)) || "";
    if (title) {
      var chromeTop = document.createElement("div");
      chromeTop.className = "ytp-chrome-top";
      var titlePill = document.createElement("div");
      titlePill.className = "ytp-title-pill";
      var titleText = document.createElement("span");
      titleText.className = "ytp-title-text";
      titleText.textContent = String(title).slice(0, 75);
      titlePill.appendChild(titleText);
      chromeTop.appendChild(titlePill);
      player.appendChild(chromeTop);
      this.chromeTop_ = chromeTop;
    }

    this.createChromeBottom_();
    this.createSettingsMenu_();

    if (this.container) {
      this.container.appendChild(player);
    }
  };

  YtPlayer.prototype.createChromeBottom_ = function () {
    var opts = this.options || {};
    var chrome = document.createElement("div");
    chrome.className = "ytp-chrome-bottom";
    this.chromeBottom_ = chrome;

    // Timeline Progress Bar
    var progressContainer = document.createElement("div");
    progressContainer.className = "ytp-progress-bar-container";
    progressContainer.setAttribute("role", "slider");
    progressContainer.setAttribute("aria-label", tr("Seek"));
    this.progressBarContainer_ = progressContainer;

    var progressBar = document.createElement("div");
    progressBar.className = "ytp-progress-bar";

    var progressList = document.createElement("div");
    progressList.className = "ytp-progress-list";

    var loadProgress = document.createElement("div");
    loadProgress.className = "ytp-load-progress";
    this.loadProgress_ = loadProgress;

    var hoverProgress = document.createElement("div");
    hoverProgress.className = "ytp-hover-progress";
    this.hoverProgress_ = hoverProgress;

    var playProgress = document.createElement("div");
    playProgress.className = "ytp-play-progress";
    this.playProgress_ = playProgress;

    progressList.appendChild(loadProgress);
    progressList.appendChild(hoverProgress);
    progressList.appendChild(playProgress);
    progressBar.appendChild(progressList);

    var scrubberContainer = document.createElement("div");
    scrubberContainer.className = "ytp-scrubber-container";
    var scrubberBtn = document.createElement("div");
    scrubberBtn.className = "ytp-scrubber-button";
    scrubberContainer.appendChild(scrubberBtn);
    this.scrubberContainer_ = scrubberContainer;
    progressBar.appendChild(scrubberContainer);

    var tooltip = document.createElement("div");
    tooltip.className = "ytp-tooltip";
    this.tooltip_ = tooltip;
    progressContainer.appendChild(tooltip);

    progressContainer.appendChild(progressBar);
    chrome.appendChild(progressContainer);

    // Controls Shelf
    var controls = document.createElement("div");
    controls.className = "ytp-chrome-controls";

    // Left Floating Capsule Pod
    var pillLeft = document.createElement("div");
    pillLeft.className = "ytp-pill-left";

    var playBtn = document.createElement("button");
    playBtn.className = "ytp-play-button ytp-button";
    playBtn.setAttribute("type", "button");
    playBtn.setAttribute("title", tr("Play") + " (k)");
    playBtn.setAttribute("aria-label", tr("Play"));
    playBtn.innerHTML = svg(ICONS.play);
    this.playBtn_ = playBtn;
    pillLeft.appendChild(playBtn);

    if (typeof opts.onPrevious === "function") {
      var prevBtn = document.createElement("button");
      prevBtn.className = "ytp-prev-button ytp-button";
      prevBtn.setAttribute("type", "button");
      prevBtn.setAttribute("title", tr("Previous recording"));
      prevBtn.setAttribute("aria-label", tr("Previous recording"));
      prevBtn.innerHTML = svg(ICONS.prev);
      this.prevBtn_ = prevBtn;
      pillLeft.appendChild(prevBtn);
    }

    var nextBtn = document.createElement("button");
    nextBtn.className = "ytp-next-button ytp-button";
    nextBtn.setAttribute("type", "button");
    var nextLabel = typeof opts.onNext === "function" ? tr("Next recording") : tr("Next");
    nextBtn.setAttribute("title", nextLabel);
    nextBtn.setAttribute("aria-label", nextLabel);
    nextBtn.innerHTML = svg(ICONS.next);
    this.nextBtn_ = nextBtn;
    pillLeft.appendChild(nextBtn);

    var volumeArea = document.createElement("span");
    volumeArea.className = "ytp-volume-area";
    this.volumeArea_ = volumeArea;

    var muteBtn = document.createElement("button");
    muteBtn.className = "ytp-mute-button ytp-button";
    muteBtn.setAttribute("type", "button");
    muteBtn.setAttribute("title", tr("Mute") + " (m)");
    muteBtn.setAttribute("aria-label", tr("Mute"));
    muteBtn.innerHTML = svg(ICONS.volumeHigh);
    this.muteBtn_ = muteBtn;
    volumeArea.appendChild(muteBtn);

    var volumePanel = document.createElement("div");
    volumePanel.className = "ytp-volume-panel";
    volumePanel.setAttribute("role", "slider");
    volumePanel.setAttribute("aria-label", tr("Volume"));

    var volumeSlider = document.createElement("div");
    volumeSlider.className = "ytp-volume-slider";
    var volumeFill = document.createElement("div");
    volumeFill.className = "ytp-volume-slider-fill";
    var volumeHandle = document.createElement("div");
    volumeHandle.className = "ytp-volume-slider-handle";
    volumeSlider.appendChild(volumeFill);
    volumeSlider.appendChild(volumeHandle);
    volumePanel.appendChild(volumeSlider);
    this.volumeFill_ = volumeFill;
    this.volumeHandle_ = volumeHandle;
    this.volumePanel_ = volumePanel;
    volumeArea.appendChild(volumePanel);
    pillLeft.appendChild(volumeArea);

    var timeDisplay = document.createElement("div");
    timeDisplay.className = "ytp-time-display";
    var timeCurrent = document.createElement("span");
    timeCurrent.className = "ytp-time-current";
    timeCurrent.textContent = "0:00";
    var timeSep = document.createElement("span");
    timeSep.className = "ytp-time-separator";
    timeSep.textContent = " / ";
    var timeDuration = document.createElement("span");
    timeDuration.className = "ytp-time-duration";
    timeDuration.textContent = "0:00";
    timeDisplay.appendChild(timeCurrent);
    timeDisplay.appendChild(timeSep);
    timeDisplay.appendChild(timeDuration);
    this.timeCurrent_ = timeCurrent;
    this.timeDuration_ = timeDuration;
    pillLeft.appendChild(timeDisplay);
    controls.appendChild(pillLeft);

    // Right Floating Capsule Pod
    var pillRight = document.createElement("div");
    pillRight.className = "ytp-pill-right";

    if (typeof opts.onDownload === "function") {
      var downloadBtn = document.createElement("button");
      downloadBtn.className = "ytp-download-button ytp-button";
      downloadBtn.setAttribute("type", "button");
      downloadBtn.setAttribute("title", tr("Download original"));
      downloadBtn.setAttribute("aria-label", tr("Download original"));
      downloadBtn.innerHTML = svg(ICONS.download);
      this.downloadBtn_ = downloadBtn;
      pillRight.appendChild(downloadBtn);
    }

    var loopBtn = document.createElement("button");
    loopBtn.className = "ytp-loop-button ytp-button";
    loopBtn.setAttribute("type", "button");
    loopBtn.setAttribute("title", tr("Loop"));
    loopBtn.setAttribute("aria-label", tr("Loop"));
    loopBtn.innerHTML = svg(ICONS.replay);
    this.loopBtn_ = loopBtn;
    pillRight.appendChild(loopBtn);

    var ambientBtn = document.createElement("button");
    ambientBtn.className = "ytp-ambient-button ytp-button";
    ambientBtn.setAttribute("type", "button");
    ambientBtn.setAttribute("title", tr("Ambient mode"));
    ambientBtn.setAttribute("aria-label", tr("Ambient mode"));
    ambientBtn.innerHTML = svg(ICONS.ambient);
    this.ambientBtn_ = ambientBtn;
    pillRight.appendChild(ambientBtn);

    var settingsBtn = document.createElement("button");
    settingsBtn.className = "ytp-settings-button ytp-button";
    settingsBtn.setAttribute("type", "button");
    settingsBtn.setAttribute("title", tr("Settings"));
    settingsBtn.setAttribute("aria-label", tr("Settings"));
    settingsBtn.innerHTML = svg(ICONS.settings);
    this.settingsBtn_ = settingsBtn;
    pillRight.appendChild(settingsBtn);

    if (typeof document !== "undefined" && document.pictureInPictureEnabled) {
      var pipBtn = document.createElement("button");
      pipBtn.className = "ytp-pip-button ytp-button";
      pipBtn.setAttribute("type", "button");
      pipBtn.setAttribute("title", tr("Picture in picture") + " (i)");
      pipBtn.setAttribute("aria-label", tr("Picture in picture"));
      pipBtn.innerHTML = svg(ICONS.pip);
      this.pipBtn_ = pipBtn;
      pillRight.appendChild(pipBtn);
    }

    var fsBtn = document.createElement("button");
    fsBtn.className = "ytp-fullscreen-button ytp-button";
    fsBtn.setAttribute("type", "button");
    fsBtn.setAttribute("title", tr("Full screen") + " (f)");
    fsBtn.setAttribute("aria-label", tr("Full screen"));
    fsBtn.innerHTML = svg(ICONS.fullscreenEnter);
    this.fsBtn_ = fsBtn;
    pillRight.appendChild(fsBtn);

    controls.appendChild(pillRight);
    chrome.appendChild(controls);
    this.el.appendChild(chrome);
  };

  YtPlayer.prototype.createSettingsMenu_ = function () {
    var menu = document.createElement("div");
    menu.className = "ytp-settings-menu";
    this.settingsMenu_ = menu;
    this.renderSettingsMainMenu_();
    this.el.appendChild(menu);
  };

  YtPlayer.prototype.renderSettingsMainMenu_ = function () {
    var self = this;
    var menu = this.settingsMenu_;
    menu.innerHTML = "";

    // Ambient Mode Toggle Switch
    var ambientRow = document.createElement("div");
    ambientRow.className = "ytp-menuitem";
    ambientRow.innerHTML = '<div class="ytp-menuitem-label">' + tr("Ambient mode") + '</div><div class="ytp-menuitem-content"><div class="ytp-switch' + (this.ambientEnabled_ ? " ytp-on" : "") + '"><div class="ytp-switch-thumb"></div></div></div>';
    ambientRow.addEventListener("click", function (e) {
      e.stopPropagation();
      self.toggleAmbientMode();
      self.renderSettingsMainMenu_();
    });
    menu.appendChild(ambientRow);

    // Playback Speed Row
    var speedRow = document.createElement("div");
    speedRow.className = "ytp-menuitem";
    var curRate = this.isIframe_ ? this.iframeRate_ : (this.video ? this.video.playbackRate : 1);
    var rateLabel = curRate === 1 ? tr("Normal") : curRate + "x";
    speedRow.innerHTML = '<div class="ytp-menuitem-label">' + tr("Playback speed") + '</div><div class="ytp-menuitem-content">' + rateLabel + ' ▸</div>';
    speedRow.addEventListener("click", function (e) {
      e.stopPropagation();
      self.renderSettingsSpeedMenu_();
    });
    menu.appendChild(speedRow);

    // Loop Row
    var isLoop = this.isIframe_ ? false : (this.video && this.video.loop);
    var loopRow = document.createElement("div");
    loopRow.className = "ytp-menuitem";
    loopRow.innerHTML = '<div class="ytp-menuitem-label">' + tr("Loop") + '</div><div class="ytp-menuitem-content"><div class="ytp-switch' + (isLoop ? " ytp-on" : "") + '"><div class="ytp-switch-thumb"></div></div></div>';
    loopRow.addEventListener("click", function (e) {
      e.stopPropagation();
      if (self.video) {
        self.video.loop = !self.video.loop;
        self.showBezel_(self.video.loop ? ICONS.replay : ICONS.play);
      }
      self.renderSettingsMainMenu_();
    });
    menu.appendChild(loopRow);
  };

  YtPlayer.prototype.renderSettingsSpeedMenu_ = function () {
    var self = this;
    var menu = this.settingsMenu_;
    menu.innerHTML = "";

    var header = document.createElement("div");
    header.className = "ytp-menu-header";
    header.innerHTML = '◂ ' + tr("Playback speed");
    header.addEventListener("click", function (e) {
      e.stopPropagation();
      self.renderSettingsMainMenu_();
    });
    menu.appendChild(header);

    var rates = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
    var curRate = this.isIframe_ ? this.iframeRate_ : (this.video ? this.video.playbackRate : 1);
    rates.forEach(function (rate) {
      var item = document.createElement("div");
      var active = Math.abs(curRate - rate) < 0.01;
      item.className = "ytp-menuitem" + (active ? " ytp-menuitem-active" : "");
      var label = rate === 1 ? tr("Normal") : String(rate);
      item.innerHTML = '<div class="ytp-menuitem-label">' + label + '</div><div class="ytp-menuitem-content">' + (active ? "✓" : "") + '</div>';
      item.addEventListener("click", function (e) {
        e.stopPropagation();
        self.setPlaybackRate(rate);
        self.toggleSettingsMenu(false);
      });
      menu.appendChild(item);
    });
  };

  YtPlayer.prototype.toggleAmbientMode = function (force) {
    this.ambientEnabled_ = typeof force === "boolean" ? force : !this.ambientEnabled_;
    if (this.ambientEnabled_) {
      this.el.classList.remove("ytp-ambient-off");
    } else {
      this.el.classList.add("ytp-ambient-off");
    }
    try {
      localStorage.setItem("yt-ambient-mode", this.ambientEnabled_ ? "1" : "0");
    } catch (e) {}
  };

  YtPlayer.prototype.startAmbientLoop_ = function () {
    var self = this;
    if (this.isIframe_) {
      var posterSrc = this.options.poster || (this.options.media && this.options.media.poster) || "";
      if (!posterSrc && this.options.post) {
        var p = this.options.post;
        posterSrc = ((p.media || [])[0] || {}).poster || p.poster || "";
      }
      if (posterSrc && this.ambientCtx_) {
        var img = typeof Image !== "undefined" ? new Image() : null;
        if (img) {
          img.crossOrigin = "anonymous";
          img.onload = function () {
            if (self.disposed_ || !self.ambientCtx_) return;
            try {
              self.ambientCtx_.drawImage(img, 0, 0, 16, 9);
            } catch (e) {}
          };
          img.src = posterSrc;
        }
      }
    }

    var draw = function () {
      if (self.disposed_) return;
      if (self.ambientEnabled_ && self.video && !self.video.paused && self.ambientCtx_ && self.video.videoWidth > 0) {
        try {
          self.ambientCtx_.drawImage(self.video, 0, 0, 16, 9);
        } catch (err) {}
      }
    };
    this.ambientInterval_ = typeof setInterval !== "undefined" ? setInterval(draw, 160) : 0;
  };

  YtPlayer.prototype.toggleSettingsMenu = function (force) {
    var menu = this.settingsMenu_;
    if (!menu) return;
    var open = typeof force === "boolean" ? force : !menu.classList.contains("ytp-visible");
    if (open) {
      this.renderSettingsMainMenu_();
      menu.classList.add("ytp-visible");
    } else {
      menu.classList.remove("ytp-visible");
    }
  };

  YtPlayer.prototype.sendIframeCommand_ = function (func, args) {
    if (!this.iframe_ || !this.iframe_.contentWindow) return;
    try {
      this.iframe_.contentWindow.postMessage(JSON.stringify({
        event: "command",
        func: func,
        args: args || [],
        id: this.iframe_.id,
        channel: "widget"
      }), "*");
    } catch (err) {}
  };

  YtPlayer.prototype.bindIframeMessages_ = function () {
    var self = this;
    var frame = this.iframe_;
    if (!frame) return;

    if (!frame.id) {
      frame.id = "ytp_" + Math.random().toString(36).slice(2, 9);
    }

    var handshake = function () {
      if (!frame.contentWindow) return;
      try {
        frame.contentWindow.postMessage(JSON.stringify({ event: "listening", id: frame.id, channel: "widget" }), "*");
      } catch (e) {}
      self.sendIframeCommand_("addEventListener", ["onReady"]);
      self.sendIframeCommand_("addEventListener", ["onStateChange"]);
      if (self.options.autoplay !== false) {
        self.sendIframeCommand_("playVideo");
      }
      if (Number(self.options.resume) > 3) {
        self.sendIframeCommand_("seekTo", [Number(self.options.resume), true]);
      }
    };

    frame.addEventListener("load", function () {
      handshake();
      setTimeout(handshake, 300);
      setTimeout(handshake, 800);
    });
    if (frame.contentWindow) {
      handshake();
      setTimeout(handshake, 300);
    }

    this.onIframeMsg_ = function (event) {
      if (!self.iframe_ || event.source !== self.iframe_.contentWindow) return;
      var data;
      try {
        data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
      } catch (err) { return; }
      if (!data) return;

      if (data.event === "onStateChange") {
        if (data.info === 1) { // Playing
          self.iframePaused_ = false;
          self.el.classList.remove("paused-mode");
          self.el.classList.add("playing-mode");
          self.updatePlayBtn_();
          self.resetAutoHide_();
          self.startIframeTicker_();
        } else if (data.info === 2 || data.info === 0) { // Paused or Ended
          self.iframePaused_ = true;
          self.el.classList.remove("playing-mode");
          self.el.classList.add("paused-mode");
          self.updatePlayBtn_();
          self.clearAutoHide_();
          self.stopIframeTicker_();
        }
      } else if ((data.event === "infoDelivery" || data.event === "initialDelivery") && data.info) {
        if (typeof data.info.currentTime === "number") {
          self.iframeCurrentTime_ = data.info.currentTime;
          if (!self.isScrubbing_) self.updateProgress_();
        }
        if (typeof data.info.duration === "number" && data.info.duration > 0) {
          self.iframeDuration_ = data.info.duration;
          self.updateControls_();
        }
        if (typeof data.info.volume === "number") {
          self.iframeVolume_ = data.info.volume / 100;
          self.updateVolume_();
        }
        if (typeof data.info.muted === "boolean") {
          self.iframeMuted_ = data.info.muted;
          self.updateVolume_();
        }
        if (typeof data.info.playbackRate === "number") {
          self.iframeRate_ = data.info.playbackRate;
        }
      }
    };

    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("message", this.onIframeMsg_);
    }
  };

  YtPlayer.prototype.startIframeTicker_ = function () {
    if (this.iframeTicker_) return;
    var self = this;
    this.iframeTicker_ = setInterval(function () {
      if (self.disposed_ || self.iframePaused_) {
        self.stopIframeTicker_();
        return;
      }
      self.sendIframeCommand_("getCurrentTime");
      if (self.iframeDuration_ > 0 && self.iframeCurrentTime_ < self.iframeDuration_) {
        self.iframeCurrentTime_ = Math.min(self.iframeDuration_, self.iframeCurrentTime_ + 0.25 * self.iframeRate_);
        if (!self.isScrubbing_) self.updateProgress_();
      }
    }, 250);
  };

  YtPlayer.prototype.stopIframeTicker_ = function () {
    if (this.iframeTicker_) {
      clearInterval(this.iframeTicker_);
      this.iframeTicker_ = 0;
    }
  };

  YtPlayer.prototype.bindEvents_ = function () {
    var self = this;
    var player = this.el;

    if (this.isIframe_) {
      this.bindIframeMessages_();
    } else if (this.video) {
      var video = this.video;
      video.addEventListener("play", function () {
        player.classList.remove("paused-mode");
        player.classList.add("playing-mode");
        self.updatePlayBtn_();
        self.resetAutoHide_();
      });

      video.addEventListener("pause", function () {
        player.classList.remove("playing-mode");
        player.classList.add("paused-mode");
        self.updatePlayBtn_();
        self.clearAutoHide_();
      });

      video.addEventListener("ended", function () {
        player.classList.remove("playing-mode");
        player.classList.add("paused-mode");
        self.updatePlayBtn_();
        self.clearAutoHide_();
      });

      video.addEventListener("timeupdate", function () {
        if (!self.isScrubbing_) {
          self.updateProgress_();
        }
        if (typeof self.options.onTime === "function") {
          self.options.onTime(video.currentTime, video.duration);
        }
      });

      video.addEventListener("progress", function () {
        self.updateBuffer_();
      });

      video.addEventListener("loadedmetadata", function () {
        self.updateControls_();
        self.updateProgress_();
        self.updateBuffer_();
        var at = Number(self.options.resume) || 0;
        var dur = video.duration;
        if (at > 3 && (!dur || !isFinite(dur) || at < dur - 8)) {
          try { video.currentTime = at; } catch (err) { /* the first frame still plays */ }
        }
      });

      video.addEventListener("durationchange", function () {
        self.updateControls_();
      });

      video.addEventListener("volumechange", function () {
        self.updateVolume_();
      });
    }

    // Control clicks
    this.playBtn_.addEventListener("click", function (e) {
      e.stopPropagation();
      self.togglePlay();
    });

    this.nextBtn_.addEventListener("click", function (e) {
      e.stopPropagation();
      if (typeof self.options.onNext === "function") {
        self.options.onNext();
        return;
      }
      self.seekRelative(10);
      self.showQuickSeek_("right");
    });

    if (this.prevBtn_) {
      this.prevBtn_.addEventListener("click", function (e) {
        e.stopPropagation();
        if (typeof self.options.onPrevious === "function") self.options.onPrevious();
      });
    }

    if (this.downloadBtn_) {
      this.downloadBtn_.addEventListener("click", function (e) {
        e.stopPropagation();
        if (typeof self.options.onDownload === "function") self.options.onDownload(self.downloadBtn_);
      });
    }

    this.muteBtn_.addEventListener("click", function (e) {
      e.stopPropagation();
      self.toggleMute();
    });

    this.loopBtn_.addEventListener("click", function (e) {
      e.stopPropagation();
      if (self.video) {
        self.video.loop = !self.video.loop;
        self.showBezel_(self.video.loop ? ICONS.replay : ICONS.play);
      } else if (self.isIframe_) {
        self.seekTo(0);
        self.play();
      }
    });

    this.ambientBtn_.addEventListener("click", function (e) {
      e.stopPropagation();
      self.toggleAmbientMode();
      self.showBezel_(ICONS.ambient);
    });

    this.settingsBtn_.addEventListener("click", function (e) {
      e.stopPropagation();
      self.toggleSettingsMenu();
    });

    if (this.pipBtn_) {
      this.pipBtn_.addEventListener("click", function (e) {
        e.stopPropagation();
        self.togglePip();
      });
    }

    this.fsBtn_.addEventListener("click", function (e) {
      e.stopPropagation();
      self.toggleFullscreen();
    });

    // Press & Hold 2x Speed Interaction + Click / Double Tap
    this.bindPointerInteractions_();

    // Scrubber interaction
    this.bindScrubber_();
    this.bindVolumeSlider_();

    // Mouse movement / Autohide
    player.addEventListener("mousemove", function () {
      self.resetAutoHide_();
    });

    player.addEventListener("mouseleave", function () {
      var isPaused = self.isIframe_ ? self.iframePaused_ : (self.video ? self.video.paused : true);
      if (!isPaused && !self.isScrubbing_) {
        self.setAutoHide_(true);
      }
    });

    // Fullscreen change
    var onFsChange = function () {
      var isFs = (typeof document !== "undefined") && (document.fullscreenElement === player || document.webkitFullscreenElement === player || player.classList.contains("ytp-fullscreen"));
      if (isFs) {
        self.fsBtn_.setAttribute("title", tr("Exit full screen") + " (f)");
        self.fsBtn_.setAttribute("aria-label", tr("Exit full screen"));
        self.fsBtn_.innerHTML = svg(ICONS.fullscreenExit);
      } else {
        self.fsBtn_.setAttribute("title", tr("Full screen") + " (f)");
        self.fsBtn_.setAttribute("aria-label", tr("Full screen"));
        self.fsBtn_.innerHTML = svg(ICONS.fullscreenEnter);
        player.classList.remove("ytp-fullscreen");
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("fullscreenchange", onFsChange);
      document.addEventListener("webkitfullscreenchange", onFsChange);
    }
    this.onFsChange_ = onFsChange;

    // Keyboard shortcuts
    player.addEventListener("keydown", function (e) {
      self.handleKeyDown_(e);
    });

    // Close settings when clicking outside
    var onDocClick = function (e) {
      if (!player.contains(e.target)) {
        self.toggleSettingsMenu(false);
      }
    };
    if (typeof document !== "undefined") {
      document.addEventListener("click", onDocClick);
    }
    this.onDocClick_ = onDocClick;
  };

  YtPlayer.prototype.bindPointerInteractions_ = function () {
    var self = this;
    var player = this.el;

    var startHold = function (e) {
      if (e.target.closest && (e.target.closest(".ytp-chrome-bottom") || e.target.closest(".ytp-settings-menu") || e.target.closest(".ytp-chrome-top"))) {
        return;
      }
      self.isHolding_ = false;
      self.holdTimer_ = setTimeout(function () {
        var isPaused = self.isIframe_ ? self.iframePaused_ : (self.video ? self.video.paused : true);
        if (!isPaused) {
          self.isHolding_ = true;
          self.origRateBeforeHold_ = self.isIframe_ ? self.iframeRate_ : (self.video ? self.video.playbackRate : 1);
          self.setPlaybackRate(2.0);
          if (self.speedBadge_) self.speedBadge_.classList.add("ytp-active");
          if (typeof navigator !== "undefined" && navigator.vibrate) try { navigator.vibrate(30); } catch (err) {}
        }
      }, 240);
    };

    var endHold = function (e) {
      if (self.holdTimer_) {
        clearTimeout(self.holdTimer_);
        self.holdTimer_ = 0;
      }
      if (self.isHolding_) {
        self.isHolding_ = false;
        self.setPlaybackRate(self.origRateBeforeHold_ || 1);
        if (self.speedBadge_) self.speedBadge_.classList.remove("ytp-active");
        return true;
      }
      return false;
    };

    var onVideoClick = function (e) {
      if (e.target.closest && (e.target.closest(".ytp-chrome-bottom") || e.target.closest(".ytp-settings-menu") || e.target.closest(".ytp-chrome-top"))) {
        return;
      }
      if (self.isHolding_) return;
      self.toggleSettingsMenu(false);

      var now = Date.now();
      var rect = player.getBoundingClientRect();
      var clientX = e.clientX != null ? e.clientX : (rect.left + rect.width / 2);
      var clickX = clientX - rect.left;
      var ratio = rect.width > 0 ? clickX / rect.width : 0.5;

      if (now - self.lastTapTime_ < 300) {
        if (ratio < 0.35) {
          self.seekRelative(-10);
          self.showQuickSeek_("left");
        } else if (ratio > 0.65) {
          self.seekRelative(10);
          self.showQuickSeek_("right");
        } else {
          self.toggleFullscreen();
        }
        self.lastTapTime_ = 0;
        return;
      }

      self.lastTapTime_ = now;
      self.lastTapX_ = clickX;
      self.togglePlay();
    };

    var targets = [player];
    if (this.clickShield_) targets.push(this.clickShield_);

    targets.forEach(function (tgt) {
      tgt.addEventListener("mousedown", startHold);
      tgt.addEventListener("touchstart", startHold, { passive: true });
      tgt.addEventListener("click", onVideoClick);
    });

    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("mouseup", endHold);
      window.addEventListener("touchend", endHold);
    }
  };

  YtPlayer.prototype.showTooltip_ = function (time, pos) {
    var tooltip = this.tooltip_;
    if (!tooltip) return;
    var label = formatTime(time);
    var image = this.options && this.options.scrubImage;
    tooltip.textContent = "";
    if (image) {
      var thumb = document.createElement("img");
      thumb.className = "ytp-tooltip-thumb";
      thumb.alt = "";
      thumb.referrerPolicy = "no-referrer";
      thumb.src = String(image);
      tooltip.appendChild(thumb);
    }
    var text = document.createElement("b");
    text.textContent = label;
    tooltip.appendChild(text);
    if (pos != null) tooltip.style.left = pos + "px";
    tooltip.classList.add("ytp-visible");
  };

  YtPlayer.prototype.bindScrubber_ = function () {
    var self = this;
    var container = this.progressBarContainer_;
    var tooltip = this.tooltip_;

    var getRatio = function (e) {
      var rect = container.getBoundingClientRect();
      var clientX = e.clientX != null ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      var pos = clientX - rect.left;
      var ratio = Math.max(0, Math.min(1, pos / rect.width));
      return { ratio: ratio, pos: pos };
    };

    var onMove = function (e) {
      var data = getRatio(e);
      var dur = self.getDuration();
      var hoverTime = data.ratio * dur;
      self.showTooltip_(hoverTime, data.pos);
      if (self.hoverProgress_) {
        self.hoverProgress_.style.width = (data.ratio * 100) + "%";
      }
      if (self.isScrubbing_) {
        self.seekTo(hoverTime);
      }
    };

    container.addEventListener("mouseenter", function (e) {
      onMove(e);
    });

    container.addEventListener("mousemove", onMove);

    container.addEventListener("mouseleave", function () {
      if (!self.isScrubbing_ && tooltip) {
        tooltip.classList.remove("ytp-visible");
      }
      if (self.hoverProgress_) {
        self.hoverProgress_.style.width = "0%";
      }
    });

    var onPointerDown = function (e) {
      if (e.preventDefault) e.preventDefault();
      self.isScrubbing_ = true;
      self.el.classList.add("ytp-seeking");
      var data = getRatio(e);
      var dur = self.getDuration();
      self.seekTo(data.ratio * dur);

      var onDrag = function (ev) {
        var dragData = getRatio(ev);
        self.seekTo(dragData.ratio * self.getDuration());
        self.showTooltip_(dragData.ratio * self.getDuration(), dragData.pos);
      };

      var onUp = function () {
        self.isScrubbing_ = false;
        self.el.classList.remove("ytp-seeking");
        if (tooltip) tooltip.classList.remove("ytp-visible");
        if (typeof window !== "undefined" && window.removeEventListener) {
          window.removeEventListener("mousemove", onDrag);
          window.removeEventListener("mouseup", onUp);
          window.removeEventListener("touchmove", onDrag);
          window.removeEventListener("touchend", onUp);
        }
      };

      if (typeof window !== "undefined" && window.addEventListener) {
        window.addEventListener("mousemove", onDrag);
        window.addEventListener("mouseup", onUp);
        window.addEventListener("touchmove", onDrag);
        window.addEventListener("touchend", onUp);
      }
    };

    container.addEventListener("mousedown", onPointerDown);
    container.addEventListener("touchstart", onPointerDown, { passive: false });
  };

  YtPlayer.prototype.bindVolumeSlider_ = function () {
    var self = this;
    var panel = this.volumePanel_;
    if (!panel) return;

    var setVol = function (e) {
      var rect = panel.getBoundingClientRect();
      var clientX = e.clientX != null ? e.clientX : (e.touches && e.touches[0] ? e.touches[0].clientX : 0);
      var pos = clientX - rect.left;
      var ratio = Math.max(0, Math.min(1, pos / rect.width));
      self.setVolume(ratio);
    };

    var onMouseDown = function (e) {
      if (e.stopPropagation) e.stopPropagation();
      if (e.preventDefault) e.preventDefault();
      self.el.classList.add("ytp-volume-slider-active");
      setVol(e);

      var onDrag = function (ev) {
        setVol(ev);
      };

      var onUp = function () {
        self.el.classList.remove("ytp-volume-slider-active");
        if (typeof window !== "undefined" && window.removeEventListener) {
          window.removeEventListener("mousemove", onDrag);
          window.removeEventListener("mouseup", onUp);
          window.removeEventListener("touchmove", onDrag);
          window.removeEventListener("touchend", onUp);
        }
      };

      if (typeof window !== "undefined" && window.addEventListener) {
        window.addEventListener("mousemove", onDrag);
        window.addEventListener("mouseup", onUp);
        window.addEventListener("touchmove", onDrag);
        window.addEventListener("touchend", onUp);
      }
    };

    panel.addEventListener("mousedown", onMouseDown);
    panel.addEventListener("touchstart", onMouseDown, { passive: false });
  };

  YtPlayer.prototype.getDuration = function () {
    if (this.isIframe_) return this.iframeDuration_ || 0;
    return (this.video && this.video.duration) || 0;
  };

  YtPlayer.prototype.getCurrentTime = function () {
    if (this.isIframe_) return this.iframeCurrentTime_ || 0;
    return (this.video && this.video.currentTime) || 0;
  };

  YtPlayer.prototype.handleKeyDown_ = function (e) {
    if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") return;
    var key = e.key;
    var handled = false;

    if (key === " " || key === "k" || key === "K") {
      this.togglePlay();
      handled = true;
    } else if (key === "ArrowLeft" || key === "j" || key === "J") {
      this.seekRelative(key === "ArrowLeft" ? -5 : -10);
      this.showQuickSeek_("left");
      handled = true;
    } else if (key === "ArrowRight" || key === "l" || key === "L") {
      this.seekRelative(key === "ArrowRight" ? 5 : 10);
      this.showQuickSeek_("right");
      handled = true;
    } else if (key === "ArrowUp") {
      var curVol = this.isIframe_ ? this.iframeVolume_ : (this.video ? this.video.volume : 1);
      this.setVolume(Math.min(1, curVol + 0.05));
      this.showBezel_(ICONS.volumeHigh);
      handled = true;
    } else if (key === "ArrowDown") {
      var curVolDown = this.isIframe_ ? this.iframeVolume_ : (this.video ? this.video.volume : 1);
      this.setVolume(Math.max(0, curVolDown - 0.05));
      this.showBezel_(curVolDown <= 0.05 ? ICONS.volumeMuted : ICONS.volumeLow);
      handled = true;
    } else if (key === "m" || key === "M") {
      this.toggleMute();
      handled = true;
    } else if (key === "f" || key === "F") {
      this.toggleFullscreen();
      handled = true;
    } else if (key === "i" || key === "I") {
      this.togglePip();
      handled = true;
    } else if (key >= "0" && key <= "9") {
      var pct = parseInt(key, 10) / 10;
      this.seekTo(this.getDuration() * pct);
      handled = true;
    } else if (key === "<" || (e.shiftKey && key === ",")) {
      var r1 = this.isIframe_ ? this.iframeRate_ : (this.video ? this.video.playbackRate : 1);
      this.setPlaybackRate(Math.max(0.25, r1 - 0.25));
      handled = true;
    } else if (key === ">" || (e.shiftKey && key === ".")) {
      var r2 = this.isIframe_ ? this.iframeRate_ : (this.video ? this.video.playbackRate : 1);
      this.setPlaybackRate(Math.min(2, r2 + 0.25));
      handled = true;
    }

    if (handled) {
      if (e.preventDefault) e.preventDefault();
      if (e.stopPropagation) e.stopPropagation();
      this.resetAutoHide_();
    }
  };

  YtPlayer.prototype.updateControls_ = function () {
    var dur = this.getDuration();
    var cur = this.getCurrentTime();
    if (this.timeCurrent_) this.timeCurrent_.textContent = formatTime(cur);
    if (this.timeDuration_) this.timeDuration_.textContent = formatTime(dur);
    this.updatePlayBtn_();
    this.updateVolume_();
  };

  YtPlayer.prototype.updatePlayBtn_ = function () {
    if (!this.playBtn_) return;
    var isEnded = !this.isIframe_ && this.video && this.video.ended;
    var isPaused = this.isIframe_ ? this.iframePaused_ : (this.video ? this.video.paused : true);

    if (isEnded) {
      this.playBtn_.setAttribute("title", tr("Replay"));
      this.playBtn_.setAttribute("aria-label", tr("Replay"));
      this.playBtn_.innerHTML = svg(ICONS.replay);
    } else if (isPaused) {
      this.playBtn_.setAttribute("title", tr("Play") + " (k)");
      this.playBtn_.setAttribute("aria-label", tr("Play"));
      this.playBtn_.innerHTML = svg(ICONS.play);
    } else {
      this.playBtn_.setAttribute("title", tr("Pause") + " (k)");
      this.playBtn_.setAttribute("aria-label", tr("Pause"));
      this.playBtn_.innerHTML = svg(ICONS.pause);
    }
  };

  YtPlayer.prototype.updateProgress_ = function () {
    var dur = this.getDuration();
    var cur = this.getCurrentTime();
    var pct = dur > 0 ? Math.min(100, Math.max(0, (cur / dur) * 100)) : 0;
    if (this.playProgress_) this.playProgress_.style.width = pct + "%";
    if (this.scrubberContainer_) this.scrubberContainer_.style.left = pct + "%";
    if (this.timeCurrent_) this.timeCurrent_.textContent = formatTime(cur);
  };

  YtPlayer.prototype.updateBuffer_ = function () {
    var video = this.video;
    if (!video || !this.loadProgress_) return;
    var dur = video.duration || 0;
    if (dur <= 0 || !video.buffered || video.buffered.length === 0) {
      this.loadProgress_.style.width = "0%";
      return;
    }
    var cur = video.currentTime;
    for (var i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= cur && cur <= video.buffered.end(i)) {
        var end = video.buffered.end(i);
        var pct = Math.min(100, (end / dur) * 100);
        this.loadProgress_.style.width = pct + "%";
        return;
      }
    }
  };

  YtPlayer.prototype.updateVolume_ = function () {
    var vol = this.isIframe_ ? this.iframeVolume_ : (this.video ? (this.video.muted ? 0 : this.video.volume) : 1);
    var muted = this.isIframe_ ? this.iframeMuted_ : (this.video ? this.video.muted : false);

    if (this.volumeFill_) this.volumeFill_.style.width = (vol * 100) + "%";
    if (this.volumeHandle_) this.volumeHandle_.style.left = (vol * 100) + "%";

    if (!this.muteBtn_) return;
    if (vol === 0 || muted) {
      this.muteBtn_.setAttribute("title", tr("Unmute") + " (m)");
      this.muteBtn_.setAttribute("aria-label", tr("Unmute"));
      this.muteBtn_.innerHTML = svg(ICONS.volumeMuted);
    } else if (vol < 0.5) {
      this.muteBtn_.setAttribute("title", tr("Mute") + " (m)");
      this.muteBtn_.setAttribute("aria-label", tr("Mute"));
      this.muteBtn_.innerHTML = svg(ICONS.volumeLow);
    } else {
      this.muteBtn_.setAttribute("title", tr("Mute") + " (m)");
      this.muteBtn_.setAttribute("aria-label", tr("Mute"));
      this.muteBtn_.innerHTML = svg(ICONS.volumeHigh);
    }
  };

  YtPlayer.prototype.showBezel_ = function (iconPath) {
    var bezel = this.bezel_;
    if (!bezel) return;
    var iconEl = bezel.querySelector(".ytp-bezel-icon");
    if (iconEl) iconEl.innerHTML = svg(iconPath);
    bezel.classList.remove("ytp-bezel-animate");
    if (typeof bezel.offsetWidth !== "undefined") void bezel.offsetWidth;
    bezel.classList.add("ytp-bezel-animate");
  };

  YtPlayer.prototype.showQuickSeek_ = function (direction) {
    var el = direction === "left" ? this.quickSeekLeft_ : this.quickSeekRight_;
    if (!el) return;
    el.classList.remove("ytp-quick-seek-animate");
    if (typeof el.offsetWidth !== "undefined") void el.offsetWidth;
    el.classList.add("ytp-quick-seek-animate");
  };

  YtPlayer.prototype.setAutoHide_ = function (hide) {
    if (hide) {
      this.el.classList.add("ytp-autohide");
      this.toggleSettingsMenu(false);
    } else {
      this.el.classList.remove("ytp-autohide");
    }
  };

  YtPlayer.prototype.resetAutoHide_ = function () {
    var self = this;
    this.setAutoHide_(false);
    if (this.autoHideTimer_) {
      clearTimeout(this.autoHideTimer_);
    }
    var isPaused = this.isIframe_ ? this.iframePaused_ : (this.video ? this.video.paused : true);
    if (!isPaused) {
      this.autoHideTimer_ = setTimeout(function () {
        var stillPaused = self.isIframe_ ? self.iframePaused_ : (self.video ? self.video.paused : true);
        if (!stillPaused && !self.isScrubbing_) {
          self.setAutoHide_(true);
        }
      }, 2500);
    }
  };

  YtPlayer.prototype.clearAutoHide_ = function () {
    if (this.autoHideTimer_) {
      clearTimeout(this.autoHideTimer_);
      this.autoHideTimer_ = 0;
    }
    this.setAutoHide_(false);
  };

  YtPlayer.prototype.play = function () {
    if (this.isIframe_) {
      this.sendIframeCommand_("playVideo");
      this.iframePaused_ = false;
      this.el.classList.remove("paused-mode");
      this.el.classList.add("playing-mode");
      this.updatePlayBtn_();
      this.startIframeTicker_();
    } else if (this.video) {
      this.video.play();
    }
    this.showBezel_(ICONS.play);
  };

  YtPlayer.prototype.pause = function () {
    if (this.isIframe_) {
      this.sendIframeCommand_("pauseVideo");
      this.iframePaused_ = true;
      this.el.classList.remove("playing-mode");
      this.el.classList.add("paused-mode");
      this.updatePlayBtn_();
      this.stopIframeTicker_();
    } else if (this.video) {
      this.video.pause();
    }
    this.showBezel_(ICONS.pause);
  };

  YtPlayer.prototype.togglePlay = function () {
    var isPaused = this.isIframe_ ? this.iframePaused_ : (this.video ? (this.video.paused || this.video.ended) : true);
    if (isPaused) {
      this.play();
    } else {
      this.pause();
    }
  };

  YtPlayer.prototype.seekTo = function (time) {
    var t = Math.max(0, Math.min(this.getDuration(), time));
    if (this.isIframe_) {
      this.iframeCurrentTime_ = t;
      this.sendIframeCommand_("seekTo", [t, true]);
      this.updateProgress_();
    } else if (this.video) {
      try { this.video.currentTime = t; } catch (err) {}
      this.updateProgress_();
    }
  };

  YtPlayer.prototype.seekRelative = function (seconds) {
    this.seekTo(this.getCurrentTime() + seconds);
  };

  YtPlayer.prototype.setVolume = function (vol) {
    vol = Math.max(0, Math.min(1, vol));
    if (this.isIframe_) {
      this.iframeVolume_ = vol;
      this.iframeMuted_ = vol === 0;
      this.sendIframeCommand_("setVolume", [vol * 100]);
      if (vol > 0) this.sendIframeCommand_("unMute");
    } else if (this.video) {
      this.video.volume = vol;
      if (vol > 0 && this.video.muted) this.video.muted = false;
    }
    if (vol > 0) this.lastVolume_ = vol;
    this.updateVolume_();
  };

  YtPlayer.prototype.toggleMute = function () {
    var muted = this.isIframe_ ? this.iframeMuted_ : (this.video ? (this.video.muted || this.video.volume === 0) : false);
    if (muted) {
      var restore = this.lastVolume_ > 0 ? this.lastVolume_ : 1;
      this.setVolume(restore);
      this.showBezel_(ICONS.volumeHigh);
    } else {
      if (this.isIframe_) {
        this.lastVolume_ = this.iframeVolume_;
        this.iframeMuted_ = true;
        this.sendIframeCommand_("mute");
      } else if (this.video) {
        this.lastVolume_ = this.video.volume;
        this.video.muted = true;
      }
      this.updateVolume_();
      this.showBezel_(ICONS.volumeMuted);
    }
  };

  YtPlayer.prototype.setPlaybackRate = function (rate) {
    if (this.isIframe_) {
      this.iframeRate_ = rate;
      this.sendIframeCommand_("setPlaybackRate", [rate]);
    } else if (this.video) {
      this.video.playbackRate = rate;
    }
    this.renderSettingsMainMenu_();
  };

  YtPlayer.prototype.togglePip = function () {
    if (typeof document === "undefined" || !document.pictureInPictureEnabled) return;
    if (this.video) {
      if (document.pictureInPictureElement === this.video) {
        document.exitPictureInPicture().catch(function () {});
      } else {
        this.video.requestPictureInPicture().catch(function () {});
      }
    }
  };

  YtPlayer.prototype.toggleFullscreen = function () {
    var player = this.el;
    var isFs = (typeof document !== "undefined") && (document.fullscreenElement === player || document.webkitFullscreenElement === player || player.classList.contains("ytp-fullscreen"));

    if (isFs) {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(function () {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      }
      player.classList.remove("ytp-fullscreen");
    } else {
      if (player.requestFullscreen) {
        player.requestFullscreen().catch(function () {
          player.classList.add("ytp-fullscreen");
        });
      } else if (player.webkitRequestFullscreen) {
        player.webkitRequestFullscreen();
      } else if (this.video && this.video.webkitEnterFullscreen) {
        this.video.webkitEnterFullscreen();
      } else {
        player.classList.add("ytp-fullscreen");
      }
    }
  };

  YtPlayer.prototype.destroy = function () {
    if (this.disposed_) return;
    this.disposed_ = true;
    this.clearAutoHide_();
    this.stopIframeTicker_();
    if (this.ambientInterval_) {
      clearInterval(this.ambientInterval_);
      this.ambientInterval_ = 0;
    }
    if (this.onFsChange_ && typeof document !== "undefined") {
      document.removeEventListener("fullscreenchange", this.onFsChange_);
      document.removeEventListener("webkitfullscreenchange", this.onFsChange_);
    }
    if (this.onDocClick_ && typeof document !== "undefined") {
      document.removeEventListener("click", this.onDocClick_);
    }
    if (this.onIframeMsg_ && typeof window !== "undefined" && window.removeEventListener) {
      window.removeEventListener("message", this.onIframeMsg_);
    }
    if (this.isIframe_) {
      try {
        this.sendIframeCommand_("pauseVideo");
        this.sendIframeCommand_("stopVideo");
      } catch (e) {}
      if (this.iframe_) {
        try { this.iframe_.src = "about:blank"; } catch (e) {}
      }
    }
    if (this.video) {
      try {
        this.video.pause();
        this.video.removeAttribute("src");
        this.video.load();
      } catch (err) {}
    }
    if (this.el && this.el.parentNode) {
      this.el.parentNode.removeChild(this.el);
    }
  };

  return YtPlayer;
});
