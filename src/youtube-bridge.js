(() => {
  const BRIDGE = "gle-youtube-caption-bridge";
  let lastFingerprint = "";

  function getPlayerResponse(player) {
    try {
      const response = player?.getPlayerResponse?.();
      if (response?.videoDetails) return response;
    } catch (_error) {
      // YouTube can expose the player before its response is ready.
    }

    if (window.ytInitialPlayerResponse?.videoDetails) return window.ytInitialPlayerResponse;

    try {
      const raw = window.ytcfg?.get?.("PLAYER_VARS")?.player_response;
      if (typeof raw === "string") return JSON.parse(raw);
    } catch (_error) {
      // Fall through while YouTube initializes or navigates between videos.
    }

    return null;
  }

  function selectedTrack(player, tracks) {
    let selected = null;
    try {
      selected = player?.getOption?.("captions", "track");
    } catch (_error) {
      // The selected track option is not available on every player state.
    }

    const selectedId = selected?.vssId;
    const selectedLanguage = selected?.languageCode;
    const exact = tracks.find(track => selectedId && track.vssId === selectedId);
    if (selectedLanguage && /^de(?:-|$)/i.test(selectedLanguage)) {
      const selectedGerman = tracks.find(track => track.languageCode === selectedLanguage);
      if (selectedGerman) return selectedGerman;
    }
    const german = tracks.find(track => /^de(?:-|$)/i.test(track.languageCode || ""));
    return german || exact || tracks.find(track => selectedLanguage && track.languageCode === selectedLanguage) || tracks[0] || null;
  }

  function emitTracks() {
    const player = document.getElementById("movie_player");
    const response = getPlayerResponse(player);
    const videoId = response?.videoDetails?.videoId || new URL(location.href).searchParams.get("v") || "";
    const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks || [];
    const captionButton = document.querySelector(".ytp-subtitles-button");
    const enabled = captionButton
      ? captionButton.getAttribute("aria-pressed") === "true" || captionButton.classList.contains("ytp-button-active")
      : Boolean(document.querySelector(".ytp-caption-segment"));
    const track = selectedTrack(player, tracks);
    const message = {
      source: BRIDGE,
      videoId,
      enabled,
      track: track ? {
        baseUrl: track.baseUrl,
        languageCode: track.languageCode,
        vssId: track.vssId,
        kind: track.kind || ""
      } : null
    };
    const fingerprint = `${videoId}|${enabled}|${message.track?.vssId || ""}|${message.track?.baseUrl || ""}`;
    if (fingerprint === lastFingerprint) return;
    lastFingerprint = fingerprint;
    window.postMessage(message, location.origin);
  }

  window.addEventListener("message", event => {
    if (event.source === window && event.origin === location.origin && event.data?.source === "gle-youtube-content" && event.data?.type === "refresh") {
      lastFingerprint = "";
      emitTracks();
    }
  });

  document.addEventListener("yt-navigate-finish", () => {
    lastFingerprint = "";
    setTimeout(emitTracks, 0);
  });
  document.addEventListener("yt-player-updated", emitTracks);
  emitTracks();
  setInterval(emitTracks, 2000);
})();
