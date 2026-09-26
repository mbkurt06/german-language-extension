(() => {
  const SOURCE = "gle-youtube-caption-bridge";
  let lastTrackKey = "";
  let inflightKey = "";

  function post(message) {
    window.postMessage({source: SOURCE, ...message}, location.origin);
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

    const selectedId = selected?.vssId;
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

  async function fetchTrack(videoId, track) {
    let url;
    try {
      url = new URL(track.baseUrl, location.href);
    } catch (_error) {
      post({type:"track-error", videoId, reason:"invalid-url"});
      return;
    }

    url.searchParams.set("fmt", "json3");
    const key = \`\${videoId}|\${track.vssId || track.languageCode || ""}|\${url.href}\`;
    if (key === lastTrackKey || key === inflightKey) return;

    inflightKey = key;
    try {
      const response = await fetch(url.href, {
        credentials: "include",
        cache: "no-store",
        redirect: "follow",
      });
      if (!response.ok) throw new Error(\`HTTP \${response.status}\`);

      const raw = (await response.text()).replace(/^\)\]\}'\s*/, "");
      const payload = JSON.parse(raw);
      lastTrackKey = key;
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
      languageCode:track?.languageCode || "",
      kind:track?.kind || "",
    });

    if (enabled && track?.baseUrl) fetchTrack(videoId, track);
  }

  function reset() {
    lastTrackKey = "";
    inflightKey = "";
    setTimeout(inspectPlayer, 0);
    setTimeout(inspectPlayer, 800);
  }

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
