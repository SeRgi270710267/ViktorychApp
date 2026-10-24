/**
 * YouTube HTML5 Video Player Architecture
 * Faithful recreation of YouTube's HTML5 web player DOM, CSS styling, and behavior.
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
    play: '<path d="M 12,26 18.5,22 18.5,14 12,10 z M 18.5,22 25,18 25,18 18.5,14 z"></path>',
    pause: '<path d="M 12,26 16,26 16,10 12,10 z M 21,26 25,26 25,10 21,10 z"></path>',
    replay: '<path d="M 18,11 V 7 l -5,5 5,5 v -4 c 3.3,0 6,2.7 6,6 0,3.3 -2.7,6 -6,6 -3.3,0 -6,-2.7 -6,-6 h -2 c 0,4.4 3.6,8 8,8 4.4,0 8,-3.6 8,-8 0,-4.4 -3.6,-8 -8,-8 z"></path>',
    volumeHigh: '<path d="M8,21 L12,21 L17,26 L17,10 L12,15 L8,15 L8,21 Z M19,14 C20.49,14.74 21.5,16.25 21.5,18 C21.5,19.75 20.49,21.26 19,22 L19,20.24 C19.64,19.69 20,18.89 20,18 C20,17.11 19.64,16.31 19,15.76 L19,14 Z M19,11.23 L19,9 C22.89,9.89 25.5,13.62 25.5,18 C25.5,22.38 22.89,26.11 19,27 L19,24.77 C21.72,23.96 23.5,21.24 23.5,18 C23.5,14.76 21.72,12.04 19,11.23 Z"></path>',
    volumeLow: '<path d="M8,21 L12,21 L17,26 L17,10 L12,15 L8,15 L8,21 Z M19,14 C20.49,14.74 21.5,16.25 21.5,18 C21.5,19.75 20.49,21.26 19,22 L19,20.24 C19.64,19.69 20,18.89 20,18 C20,17.11 19.64,16.31 19,15.76 L19,14 Z"></path>',
    volumeMuted: '<path d="m 21.48,17.98 -1.77,-1.77 c 0.03,-0.17 0.05,-0.34 0.05,-0.51 0,-1.3 -0.74,-2.42 -1.84,-2.98 v 2.11 l 3.56,3.56 c 0,-0.14 0,-0.27 0,-0.41 z m 1.94,0 c 0,0.71 -0.16,1.41 -0.44,2.03 l 1.5,1.51 C 24.88,20.5 25.42,19.29 25.42,17.98 25.42,14.33 22.85,11.3 19.42,10.53 v 2.05 c 2.33,0.72 4,2.91 4,5.4 z M 5.66,6.39 4.25,7.8 8.45,12 H 5 v 8 h 4 l 5,5 v -7.55 l 4.24,4.24 C 17.65,21.94 17.06,22.18 16.42,22.33 v 2.05 c 1.18,-0.24 2.26,-0.75 3.19,-1.42 l 2.8,2.8 1.41,-1.41 L 5.66,6.39 Z M 14,9.45 11.89,11.56 14,13.67 V 9.45 Z"></path>',
    settings: '<path d="m 23.94,18.76 c 0.03,-0.25 0.06,-0.51 0.06,-0.76 0,-0.25 -0.03,-0.5 -0.06,-0.76 l 2.28,-1.78 c 0.2,-0.16 0.26,-0.46 0.13,-0.69 l -2.16,-3.74 c -0.13,-0.23 -0.41,-0.32 -0.65,-0.23 l -2.69,1.08 c -0.56,-0.43 -1.18,-0.78 -1.84,-1.05 l -0.41,-2.86 c -0.04,-0.26 -0.27,-0.45 -0.54,-0.45 h -4.32 c -0.27,0 -0.5,0.19 -0.54,0.45 l -0.41,2.86 c -0.66,0.27 -1.28,0.62 -1.84,1.05 l -2.69,-1.08 c -0.24,-0.09 -0.52,0 -0.65,0.23 L 5.64,15.47 c -0.13,0.23 -0.07,0.53 0.13,0.69 l 2.28,1.78 c -0.03,0.26 -0.06,0.51 -0.06,0.76 0,0.25 0.03,0.5 0.06,0.76 l -2.28,1.78 c -0.2,0.16 -0.26,0.46 -0.13,0.69 l 2.16,3.74 c 0.13,0.23 0.41,0.32 0.65,0.23 l 2.69,-1.08 c 0.56,0.43 1.18,0.78 1.84,1.05 l 0.41,2.86 c 0.04,0.26 0.27,0.45 0.54,0.45 h 4.32 c 0.27,0 0.5,-0.19 0.54,-0.45 l 0.41,-2.86 c 0.66,-0.27 1.28,-0.62 1.84,-1.05 l 2.69,1.08 c 0.24,0.09 0.52,0 0.65,-0.23 l 2.16,-3.74 c 0.13,-0.23 0.07,-0.53 -0.13,-0.69 l -2.28,-1.78 z M 18,21.5 c -1.93,0 -3.5,-1.57 -3.5,-3.5 0,-1.93 1.57,-3.5 3.5,-3.5 1.93,0 3.5,1.57 3.5,3.5 0,1.93 -1.57,3.5 -3.5,3.5 z"></path>',
    pip: '<path d="M19 7h-8v6h8V7zm2-4H3c-1.1 0-2 .9-2 2v14c0 1.1.9 1.98 2 1.98h18c1.1 0 2-.88 2-1.98V5c0-1.1-.9-2-2-2zm0 16.01H3V4.98h18v14.03z"></path>',
    fullscreenEnter: '<path d="M 10,16 h 2 v -4 h 4 v -2 h -6 v 6 z m 2,8 h -2 v 6 h 6 v -2 h -4 v -4 z m 14,0 h -4 v 2 h 6 v -6 h -2 v 4 z m 0,-14 h -4 v 2 h 4 v 4 h 2 v -6 h -2 z"></path>',
    fullscreenExit: '<path d="m 14,14 h -4 v 2 h 6 v -6 h -2 v 4 z m 0,8 h -2 v 4 h 4 v -6 h -4 v 2 z m 8,0 h -2 v 6 h 4 v -4 h 2 v -2 z m 0,-8 h 2 v -4 h 4 v -2 h -6 v 6 z"></path>',
    forward10: '<path d="M4 18l8.5-6L4 6v12zm9-12v12l8.5-6L13 6z"></path>',
    replay10: '<path d="M11 18V6l-8.5 6 8.5 6zm.5-6l8.5 6V6l-8.5 6z"></path>'
  };

  function svg(pathHtml, viewBox) {
    return '<svg viewBox="' + (viewBox || "0 0 36 36") + '" width="100%" height="100%">' + pathHtml + '</svg>';
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

    this.initDom_();
    this.bindEvents_();
    this.updateControls_();
  }

  YtPlayer.prototype.initDom_ = function () {
    var self = this;
    var opts = this.options;

    var player = document.createElement("div");
    player.className = "html5-video-player paused-mode";
    player.tabIndex = 0;
    player.setAttribute("role", "region");
    player.setAttribute("aria-label", "Video player");
    this.el = player;

    var videoContainer = document.createElement("div");
    videoContainer.className = "html5-video-container";

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
    this.video = video;
    videoContainer.appendChild(video);
    player.appendChild(videoContainer);

    var gradTop = document.createElement("div");
    gradTop.className = "ytp-gradient-top";
    player.appendChild(gradTop);

    var gradBottom = document.createElement("div");
    gradBottom.className = "ytp-gradient-bottom";
    player.appendChild(gradBottom);

    var bezel = document.createElement("div");
    bezel.className = "ytp-bezel";
    bezel.innerHTML = '<div class="ytp-bezel-icon"></div>';
    this.bezel_ = bezel;
    player.appendChild(bezel);

    var quickSeekLeft = document.createElement("div");
    quickSeekLeft.className = "ytp-quick-seek ytp-quick-seek-left";
    quickSeekLeft.innerHTML = '<div class="ytp-bezel-icon">' + svg(ICONS.replay10, "0 0 24 24") + '</div><div class="ytp-quick-seek-text">10s</div>';
    this.quickSeekLeft_ = quickSeekLeft;
    player.appendChild(quickSeekLeft);

    var quickSeekRight = document.createElement("div");
    quickSeekRight.className = "ytp-quick-seek ytp-quick-seek-right";
    quickSeekRight.innerHTML = '<div class="ytp-bezel-icon">' + svg(ICONS.forward10, "0 0 24 24") + '</div><div class="ytp-quick-seek-text">10s</div>';
    this.quickSeekRight_ = quickSeekRight;
    player.appendChild(quickSeekRight);

    var spinner = document.createElement("div");
    spinner.className = "ytp-spinner";
    spinner.innerHTML = '<div class="ytp-spinner-container"><div class="ytp-spinner-rotator"></div></div>';
    this.spinner_ = spinner;
    player.appendChild(spinner);

    this.createChromeBottom_();
    this.createSettingsMenu_();

    if (this.container) {
      this.container.appendChild(player);
    }
  };

  YtPlayer.prototype.createChromeBottom_ = function () {
    var self = this;
    var chrome = document.createElement("div");
    chrome.className = "ytp-chrome-bottom";
    this.chromeBottom_ = chrome;

    // Progress bar
    var progressContainer = document.createElement("div");
    progressContainer.className = "ytp-progress-bar-container";
    progressContainer.setAttribute("role", "slider");
    progressContainer.setAttribute("aria-label", "Seek slider");
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

    // Controls row
    var controls = document.createElement("div");
    controls.className = "ytp-chrome-controls";

    // Left controls
    var leftControls = document.createElement("div");
    leftControls.className = "ytp-left-controls";

    var playBtn = document.createElement("button");
    playBtn.className = "ytp-play-button ytp-button";
    playBtn.setAttribute("type", "button");
    playBtn.setAttribute("title", tr("Play") + " (k)");
    playBtn.setAttribute("aria-label", tr("Play"));
    playBtn.innerHTML = svg(ICONS.play);
    this.playBtn_ = playBtn;
    leftControls.appendChild(playBtn);

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
    volumePanel.setAttribute("aria-label", "Volume slider");

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
    leftControls.appendChild(volumeArea);

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
    leftControls.appendChild(timeDisplay);
    controls.appendChild(leftControls);

    // Right controls
    var rightControls = document.createElement("div");
    rightControls.className = "ytp-right-controls";

    var settingsBtn = document.createElement("button");
    settingsBtn.className = "ytp-settings-button ytp-button";
    settingsBtn.setAttribute("type", "button");
    settingsBtn.setAttribute("title", tr("Settings"));
    settingsBtn.setAttribute("aria-label", tr("Settings"));
    settingsBtn.innerHTML = svg(ICONS.settings);
    this.settingsBtn_ = settingsBtn;
    rightControls.appendChild(settingsBtn);

    if (document.pictureInPictureEnabled) {
      var pipBtn = document.createElement("button");
      pipBtn.className = "ytp-pip-button ytp-button";
      pipBtn.setAttribute("type", "button");
      pipBtn.setAttribute("title", tr("Picture in picture") + " (i)");
      pipBtn.setAttribute("aria-label", tr("Picture in picture"));
      pipBtn.innerHTML = svg(ICONS.pip);
      this.pipBtn_ = pipBtn;
      rightControls.appendChild(pipBtn);
    }

    var fsBtn = document.createElement("button");
    fsBtn.className = "ytp-fullscreen-button ytp-button";
    fsBtn.setAttribute("type", "button");
    fsBtn.setAttribute("title", tr("Full screen") + " (f)");
    fsBtn.setAttribute("aria-label", tr("Full screen"));
    fsBtn.innerHTML = svg(ICONS.fullscreenEnter);
    this.fsBtn_ = fsBtn;
    rightControls.appendChild(fsBtn);

    controls.appendChild(rightControls);
    chrome.appendChild(controls);
    this.el.appendChild(chrome);
  };

  YtPlayer.prototype.createSettingsMenu_ = function () {
    var self = this;
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

    // Playback Speed Row
    var speedRow = document.createElement("div");
    speedRow.className = "ytp-menuitem";
    var curRate = this.video.playbackRate || 1;
    var rateLabel = curRate === 1 ? tr("Normal") : curRate + "x";
    speedRow.innerHTML = '<div class="ytp-menuitem-label">' + tr("Playback speed") + '</div><div class="ytp-menuitem-content">' + rateLabel + ' ▸</div>';
    speedRow.addEventListener("click", function (e) {
      e.stopPropagation();
      self.renderSettingsSpeedMenu_();
    });
    menu.appendChild(speedRow);

    // Loop Row
    var loopRow = document.createElement("div");
    loopRow.className = "ytp-menuitem" + (this.video.loop ? " ytp-menuitem-active" : "");
    loopRow.innerHTML = '<div class="ytp-menuitem-label">' + tr("Loop") + '</div><div class="ytp-menuitem-content">' + (this.video.loop ? "✓" : "") + '</div>';
    loopRow.addEventListener("click", function (e) {
      e.stopPropagation();
      self.video.loop = !self.video.loop;
      self.renderSettingsMainMenu_();
      self.showBezel_(self.video.loop ? ICONS.replay : ICONS.play);
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
    var curRate = this.video.playbackRate || 1;
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

  YtPlayer.prototype.bindEvents_ = function () {
    var self = this;
    var video = this.video;
    var player = this.el;

    // Video events
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
    });

    video.addEventListener("progress", function () {
      self.updateBuffer_();
    });

    video.addEventListener("loadedmetadata", function () {
      self.updateControls_();
      self.updateProgress_();
      self.updateBuffer_();
    });

    video.addEventListener("durationchange", function () {
      self.updateControls_();
    });

    video.addEventListener("volumechange", function () {
      self.updateVolume_();
    });

    video.addEventListener("waiting", function () {
      if (self.spinner_) self.spinner_.classList.add("ytp-visible");
    });

    video.addEventListener("playing", function () {
      if (self.spinner_) self.spinner_.classList.remove("ytp-visible");
    });

    video.addEventListener("canplay", function () {
      if (self.spinner_) self.spinner_.classList.remove("ytp-visible");
    });

    // Control clicks
    this.playBtn_.addEventListener("click", function (e) {
      e.stopPropagation();
      self.togglePlay();
    });

    this.muteBtn_.addEventListener("click", function (e) {
      e.stopPropagation();
      self.toggleMute();
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

    // Video click / double tap interaction
    player.addEventListener("click", function (e) {
      if (e.target.closest(".ytp-chrome-bottom") || e.target.closest(".ytp-settings-menu")) {
        return;
      }
      self.toggleSettingsMenu(false);
      var now = Date.now();
      var rect = player.getBoundingClientRect();
      var clickX = e.clientX - rect.left;
      var ratio = clickX / rect.width;

      if (now - self.lastTapTime_ < 320) {
        // Double click / double tap
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
    });

    // Scrubber interaction
    this.bindScrubber_();
    this.bindVolumeSlider_();

    // Mouse movement / Autohide
    player.addEventListener("mousemove", function () {
      self.resetAutoHide_();
    });

    player.addEventListener("mouseleave", function () {
      if (!self.video.paused && !self.isScrubbing_) {
        self.setAutoHide_(true);
      }
    });

    // Document fullscreen change
    var onFsChange = function () {
      var isFs = document.fullscreenElement === player || document.webkitFullscreenElement === player || player.classList.contains("ytp-fullscreen");
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
    document.addEventListener("fullscreenchange", onFsChange);
    document.addEventListener("webkitfullscreenchange", onFsChange);
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
    document.addEventListener("click", onDocClick);
    this.onDocClick_ = onDocClick;
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
      var dur = self.video.duration || 0;
      var hoverTime = data.ratio * dur;
      if (tooltip) {
        tooltip.textContent = formatTime(hoverTime);
        tooltip.style.left = data.pos + "px";
        tooltip.classList.add("ytp-visible");
      }
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
      e.preventDefault();
      self.isScrubbing_ = true;
      self.el.classList.add("ytp-seeking");
      var data = getRatio(e);
      var dur = self.video.duration || 0;
      self.seekTo(data.ratio * dur);

      var onDrag = function (ev) {
        var dragData = getRatio(ev);
        self.seekTo(dragData.ratio * (self.video.duration || 0));
        if (tooltip) {
          tooltip.textContent = formatTime(dragData.ratio * (self.video.duration || 0));
          tooltip.style.left = dragData.pos + "px";
        }
      };

      var onUp = function () {
        self.isScrubbing_ = false;
        self.el.classList.remove("ytp-seeking");
        if (tooltip) tooltip.classList.remove("ytp-visible");
        window.removeEventListener("mousemove", onDrag);
        window.removeEventListener("mouseup", onUp);
        window.removeEventListener("touchmove", onDrag);
        window.removeEventListener("touchend", onUp);
      };

      window.addEventListener("mousemove", onDrag);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("touchmove", onDrag);
      window.addEventListener("touchend", onUp);
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
      e.stopPropagation();
      e.preventDefault();
      self.el.classList.add("ytp-volume-slider-active");
      setVol(e);

      var onDrag = function (ev) {
        setVol(ev);
      };

      var onUp = function () {
        self.el.classList.remove("ytp-volume-slider-active");
        window.removeEventListener("mousemove", onDrag);
        window.removeEventListener("mouseup", onUp);
        window.removeEventListener("touchmove", onDrag);
        window.removeEventListener("touchend", onUp);
      };

      window.addEventListener("mousemove", onDrag);
      window.addEventListener("mouseup", onUp);
      window.addEventListener("touchmove", onDrag);
      window.addEventListener("touchend", onUp);
    };

    panel.addEventListener("mousedown", onMouseDown);
    panel.addEventListener("touchstart", onMouseDown, { passive: false });
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
      this.setVolume(Math.min(1, this.video.volume + 0.05));
      this.showBezel_(ICONS.volumeHigh);
      handled = true;
    } else if (key === "ArrowDown") {
      this.setVolume(Math.max(0, this.video.volume - 0.05));
      this.showBezel_(this.video.volume <= 0.05 ? ICONS.volumeMuted : ICONS.volumeLow);
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
      this.seekTo((this.video.duration || 0) * pct);
      handled = true;
    } else if (key === "<" || (e.shiftKey && key === ",")) {
      this.setPlaybackRate(Math.max(0.25, (this.video.playbackRate || 1) - 0.25));
      handled = true;
    } else if (key === ">" || (e.shiftKey && key === ".")) {
      this.setPlaybackRate(Math.min(2, (this.video.playbackRate || 1) + 0.25));
      handled = true;
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
      this.resetAutoHide_();
    }
  };

  YtPlayer.prototype.updateControls_ = function () {
    var dur = this.video.duration || 0;
    var cur = this.video.currentTime || 0;
    if (this.timeCurrent_) this.timeCurrent_.textContent = formatTime(cur);
    if (this.timeDuration_) this.timeDuration_.textContent = formatTime(dur);
    this.updatePlayBtn_();
    this.updateVolume_();
  };

  YtPlayer.prototype.updatePlayBtn_ = function () {
    if (!this.playBtn_) return;
    if (this.video.ended) {
      this.playBtn_.setAttribute("title", tr("Replay"));
      this.playBtn_.setAttribute("aria-label", tr("Replay"));
      this.playBtn_.innerHTML = svg(ICONS.replay);
    } else if (this.video.paused) {
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
    var dur = this.video.duration || 0;
    var cur = this.video.currentTime || 0;
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
    var video = this.video;
    if (!video) return;
    var vol = video.muted ? 0 : video.volume;
    if (this.volumeFill_) this.volumeFill_.style.width = (vol * 100) + "%";
    if (this.volumeHandle_) this.volumeHandle_.style.left = (vol * 100) + "%";

    if (!this.muteBtn_) return;
    if (vol === 0 || video.muted) {
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
    // Trigger reflow
    void bezel.offsetWidth;
    bezel.classList.add("ytp-bezel-animate");
  };

  YtPlayer.prototype.showQuickSeek_ = function (direction) {
    var el = direction === "left" ? this.quickSeekLeft_ : this.quickSeekRight_;
    if (!el) return;
    el.classList.remove("ytp-quick-seek-animate");
    void el.offsetWidth;
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
    if (!this.video.paused) {
      this.autoHideTimer_ = setTimeout(function () {
        if (!self.video.paused && !self.isScrubbing_) {
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

  // Public Methods
  YtPlayer.prototype.play = function () {
    var self = this;
    var p = this.video.play();
    this.showBezel_(ICONS.play);
    return p;
  };

  YtPlayer.prototype.pause = function () {
    this.video.pause();
    this.showBezel_(ICONS.pause);
  };

  YtPlayer.prototype.togglePlay = function () {
    if (this.video.paused || this.video.ended) {
      this.play();
    } else {
      this.pause();
    }
  };

  YtPlayer.prototype.seekTo = function (time) {
    var t = Math.max(0, Math.min(this.video.duration || 0, time));
    try {
      this.video.currentTime = t;
    } catch (err) {}
    this.updateProgress_();
  };

  YtPlayer.prototype.seekRelative = function (seconds) {
    var cur = this.video.currentTime || 0;
    this.seekTo(cur + seconds);
    this.showBezel_(seconds > 0 ? ICONS.forward10 : ICONS.replay10);
  };

  YtPlayer.prototype.setVolume = function (level) {
    var vol = Math.max(0, Math.min(1, level));
    this.video.volume = vol;
    if (vol > 0 && this.video.muted) {
      this.video.muted = false;
    }
    if (vol > 0) {
      this.lastVolume_ = vol;
    }
    this.updateVolume_();
  };

  YtPlayer.prototype.toggleMute = function () {
    if (this.video.muted || this.video.volume === 0) {
      this.video.muted = false;
      this.setVolume(this.lastVolume_ > 0 ? this.lastVolume_ : 1);
      this.showBezel_(ICONS.volumeHigh);
    } else {
      this.lastVolume_ = this.video.volume;
      this.video.muted = true;
      this.updateVolume_();
      this.showBezel_(ICONS.volumeMuted);
    }
  };

  YtPlayer.prototype.setPlaybackRate = function (rate) {
    this.video.playbackRate = rate;
    this.renderSettingsMainMenu_();
  };

  YtPlayer.prototype.togglePip = function () {
    if (!document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement === this.video) {
      document.exitPictureInPicture().catch(function () {});
    } else {
      this.video.requestPictureInPicture().catch(function () {});
    }
  };

  YtPlayer.prototype.toggleFullscreen = function () {
    var player = this.el;
    var isFs = document.fullscreenElement === player || document.webkitFullscreenElement === player || player.classList.contains("ytp-fullscreen");

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
      } else if (this.video.webkitEnterFullscreen) {
        // iOS Safari on iPhone
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
    if (this.onFsChange_) {
      document.removeEventListener("fullscreenchange", this.onFsChange_);
      document.removeEventListener("webkitfullscreenchange", this.onFsChange_);
    }
    if (this.onDocClick_) {
      document.removeEventListener("click", this.onDocClick_);
    }
    if (this.el && this.el.parentNode) {
      this.el.parentNode.removeChild(this.el);
    }
  };

  return YtPlayer;
});
