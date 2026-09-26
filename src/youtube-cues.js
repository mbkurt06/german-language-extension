(() => {
  function normalizeCueText(text) {
    return text.replace(/[\u200b\ufeff]/g, "").replace(/\s+/g, " ").trim();
  }

  function comparableWord(word) {
    return word.toLocaleLowerCase("de-DE").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  }

  function sameWordPrefix(shorter, longer) {
    return shorter.length <= longer.length && shorter.every(
      (word, index) => comparableWord(word) === comparableWord(longer[index])
    );
  }

  function sentenceIsComplete(text) {
    return /[.!?…]["'»”’)}\u005d]*$/u.test(text.trim());
  }

  function mergeCueText(first, second) {
    const a = normalizeCueText(first);
    const b = normalizeCueText(second);
    if (!a) return b;
    if (!b) return a;

    const aWords = a.split(/\s+/);
    const bWords = b.split(/\s+/);
    if (sameWordPrefix(aWords, bWords)) return b;
    if (sameWordPrefix(bWords, aWords)) return a;

    let overlap = 0;
    for (let size = Math.min(aWords.length, bWords.length); size > 0; size--) {
      if (sameWordPrefix(aWords.slice(-size), bWords.slice(0, size))) {
        overlap = size;
        break;
      }
    }

    const suffix = bWords.slice(overlap).join(" ");
    return normalizeCueText(`${a}${suffix && /^[,.;:!?)]/u.test(suffix) ? "" : " "}${suffix}`);
  }

  function parseJson3Cues(payload) {
    if (!Array.isArray(payload?.events)) return [];

    const events = payload.events.map(event => {
      const segments = Array.isArray(event.segs) ? event.segs : [];
      const text = normalizeCueText(segments.map(segment => segment.utf8 || "").join(""));
      const startMs = Number(event.tStartMs);
      if (!text || !Number.isFinite(startMs)) return null;

      const eventDuration = Number(event.dDurationMs) || 0;
      const segmentEnd = Math.max(0, ...segments.map(segment =>
        Number(segment.tOffsetMs || 0) + Number(segment.dDurationMs || 0)
      ));
      return { startMs, endMs: startMs + Math.max(eventDuration, segmentEnd), text };
    }).filter(Boolean).sort((a, b) => a.startMs - b.startMs);

    events.forEach((event, index) => {
      if (event.endMs <= event.startMs) {
        const nextStart = events[index + 1]?.startMs;
        event.endMs = nextStart > event.startMs ? nextStart : event.startMs + 1800;
      }
    });

    const cues = [];
    for (const event of events) {
      const previous = cues[cues.length - 1];
      const mergedText = previous ? mergeCueText(previous.text, event.text) : event.text;
      const gap = previous ? event.startMs - previous.endMs : Infinity;
      const canMerge = previous && gap <= 350 && gap >= -750 && !sentenceIsComplete(previous.text) &&
        mergedText.split(/\s+/).length <= 12 && mergedText.length <= 100;

      if (canMerge) {
        previous.text = mergedText;
        previous.endMs = Math.max(previous.endMs, event.endMs);
      } else {
        cues.push({ startMs: event.startMs, endMs: event.endMs, text: event.text });
      }
    }

    return cues.map((cue, index) => ({ ...cue, index }));
  }

  function cueAtTime(cues, timeMs) {
    let low = 0;
    let high = cues.length - 1;
    let candidate = null;

    while (low <= high) {
      const middle = (low + high) >> 1;
      if (cues[middle].startMs <= timeMs) {
        candidate = cues[middle];
        low = middle + 1;
      } else {
        high = middle - 1;
      }
    }

    return candidate && timeMs < candidate.endMs ? candidate : null;
  }

  const api = { parseJson3Cues, cueAtTime };
  globalThis.GLEYoutubeCues = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
