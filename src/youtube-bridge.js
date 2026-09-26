(() => {
  const SOURCE = "gle-youtube-caption-bridge";
  const DEBUG_KEY = "__GLE_YOUTUBE_BRIDGE_DEBUG__";
  const potByVideoId = new Map();
  let lastTrackKey = "";
  let inflightKey = "";
  let lastMissingPotKey = "";

  function post(message) {
    window.postMessage({source: SOURCE, ...message}, location.origin);
  }

  function captureTimedtextUrl(value) {
    if (!value) return false;

    let raw = value;
    if (typeof Request !== "undefined" && value instanceof Request) raw = value.url;
    if (raw instanceof URL) raw = raw.href;
    if (typeof raw !== "string") return false;

    let url;
    try {
      url = new URL(raw, location.href);
    } catch (_error) {
      return false;
    }

    if (!/\/timedtext$/i.test(url.pathname)) return false;

    const videoId = url.searchParams.get("v");
    const pot = url.searchParams.get("pot");
    if (!videoId || !pot) return false;

    const changed = potByVideoId.get(videoId) !== pot;
    potByVideoId.set(videoId, pot);

    if (changed) {
      lastMissingPotKey = "";
      post({type:"pot-captured", videoId});
      setTimeout(inspectPlayer, 0);
    }

    return true;
  }

  function captureExistingResources() {
    try {
      performance.getEntriesByType("resource").forEach(entry => captureTimedtextUrl(entry.name));
    } catch (_error) {}
  }

  function installNetworkCapture() {
    if (window[DEBUG_KEY]?.installed) return;

    const originalOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      captureTimedtextUrl(url);
      return originalOpen.apply(this, arguments);
    };

    const originalFetch = window.fetch;
    if (typeof originalFetch === "function") {
      window.fetch = function(input) {
        captureTimedtextUrl(input);
        return Reflect.apply(originalFetch, this, arguments);
      };
    }

    try {
      const observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) captureTimedtextUrl(entry.name);
      });
      observer.observe({type:"resource", buffered:true});
    } catch (_error) {}

    window[DEBUG_KEY] = {
      installed:true,
      getPot(videoId) {
        return potByVideoId.get(videoId) || null;
      },
      getKnownVideoIds() {
        return [...potByVideoId.keys()];
      },
    };

    captureExistingResources();
  }

  function getPlayerResponse(player) {
    try {
      const response = player?.getPlayerResponse?.();
      if (response?.videoDetails) return response;
    } catch (_error) {}

    if (window.ytInitialPlayerResponse?.videoDetails) return window.ytInitialPlayerResponse;

    try {
      const raw = window.ytcfg?.get?.("PLAYER_VARS")?.player_response;
      if (typeof raw === "string") return JSON.parse(raw);
    } catch (_error) {}

    return null;
  }

  function selectedTrack(player, tracks) {
    let selected = null;
    try {
      selected = player?.getOption?.("captions", "track");
    } catch (_error) {}

    const selectedId = selected?.vssId || selected?.vss_id;
    const selectedLanguage = selected?.languageCode;
    const exact = tracks.find(track => selectedId && track.vssId === selectedId);
    const selectedGerman = tracks.find(track =>
      selectedLanguage && /^de(?:-|$)/i.test(selectedLanguage) && track.languageCode === selectedLanguage
    );
    const german = tracks.find(track => /^de(?:-|$)/i.test(track.languageCode || ""));

    return selectedGerman || german || exact ||
      tracks.find(track => selectedLanguage && track.languageCode === selectedLanguage) ||
      tracks[0] || null;
  }

  function captionEnabled() {
    const button = document.querySelector(".ytp-subtitles-button");
    if (button) {
      return button.getAttribute("aria-pressed") === "true" || button.classList.contains("ytp-button-active");
    }
    return Boolean(document.querySelector(".ytp-caption-segment"));
  }

  async function waitForPot(videoId, timeoutMs = 3500) {
    const started = performance.now();
    while (performance.now() - started < timeoutMs) {
      const pot = potByVideoId.get(videoId);
      if (pot) return pot;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    return potByVideoId.get(videoId) || null;
  }

  async function fetchTrack(videoId, track) {
    let url;
    try {
      url = new URL(track.baseUrl, location.href);
    } catch (_error) {
      post({type:"track-error", videoId, reason:"invalid-url"});
      return;
    }

    const pot = potByVideoId.get(videoId) || await waitForPot(videoId);
    if (!pot) {
      const missingKey = `${videoId}|${track.vssId || track.languageCode || ""}`;
      if (missingKey !== lastMissingPotKey) {
        lastMissingPotKey = missingKey;
        post({type:"track-error", videoId, reason:"missing-pot"});
      }
      return;
    }

    url.searchParams.set("fmt", "json3");
    url.searchParams.set("c", "WEB");
    url.searchParams.set("pot", pot);

    const key = `${videoId}|${track.vssId || track.languageCode || ""}|${url.href}`;
    if (key === lastTrackKey || key === inflightKey) return;

    inflightKey = key;
    try {
      const response = await fetch(url.href, {
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);

      const raw = (await response.text()).replace(/^\)\]\}'\s*/, "");
      if (!raw.trim()) throw new Error("empty-caption-response");

      const payload = JSON.parse(raw);
      lastTrackKey = key;
      lastMissingPotKey = "";
      post({
        type:"track-data",
        videoId,
        track:{
          languageCode:track.languageCode || "",
          vssId:track.vssId || "",
          kind:track.kind || "",
        },
        payload,
      });
    } catch (error) {
      post({type:"track-error", videoId, reason:String(error?.message || error)});
    } finally {
      if (inflightKey === key) inflightKey = "";
    }
  }

  function inspectPlayer() {
    const player = document.getElementById("movie_player");
    const response = getPlayerResponse(player);
    const videoId = response?.videoDetails?.videoId ||
      new URL(location.href).searchParams.get("v") || "";
    const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const enabled = captionEnabled();
    const track = selectedTrack(player, tracks);

    post({
      type:"track-status",
      videoId,
      enabled,
      hasTrack:Boolean(track?.baseUrl),
      hasPot:Boolean(videoId && potByVideoId.get(videoId)),
      languageCode:track?.languageCode || "",
      kind:track?.kind || "",
    });

    if (enabled && videoId && track?.baseUrl) fetchTrack(videoId, track);
  }

  function reset() {
    lastTrackKey = "";
    inflightKey = "";
    lastMissingPotKey = "";
    setTimeout(inspectPlayer, 0);
    setTimeout(inspectPlayer, 800);
  }

  installNetworkCapture();

  window.addEventListener("message", event => {
    if (event.source !== window || event.origin !== location.origin) return;
    if (event.data?.source === "gle-youtube-content" && event.data?.type === "refresh") {
      lastTrackKey = "";
      inspectPlayer();
    }
  });

  document.addEventListener("yt-navigate-finish", reset);
  document.addEventListener("yt-player-updated", inspectPlayer);

  inspectPlayer();
  setInterval(inspectPlayer, 2500);
})();
