(() => {
  function normalizeCueText(text) {
    return String(text || "").replace(/[\u200b\ufeff]/g, "").replace(/\s+/g, " ").trim();
  }

  function comparableWord(word) {
    return String(word || "").toLocaleLowerCase("de-DE").replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
  }

  function words(text) {
    return normalizeCueText(text).split(/\s+/).filter(Boolean);
  }

  function sameWordPrefix(shorter, longer) {
    return shorter.length <= longer.length && shorter.every(
      (word, index) => comparableWord(word) === comparableWord(longer[index])
    );
  }

  function sentenceIsComplete(text) {
    return /[.!?…]["'»”’)}\]]*$/u.test(normalizeCueText(text));
  }

  function mergeRollingText(first, second) {
    const a = normalizeCueText(first);
    const b = normalizeCueText(second);
    if (!a) return b;
    if (!b) return a;
    if (a === b) return a;

    const aWords = words(a);
    const bWords = words(b);

    if (sameWordPrefix(aWords, bWords)) return b;
    if (sameWordPrefix(bWords, aWords)) return a;

    let overlap = 0;
    for (let size = Math.min(aWords.length, bWords.length); size > 0; size--) {
      const left = aWords.slice(-size);
      const right = bWords.slice(0, size);
      if (left.every((word, index) => comparableWord(word) === comparableWord(right[index]))) {
        overlap = size;
        break;
      }
    }

    if (overlap) {
      return normalizeCueText(`${a} ${bWords.slice(overlap).join(" ")}`);
    }

    return normalizeCueText(`${a} ${b}`);
  }

  function rawEventText(event) {
    const segments = Array.isArray(event?.segs) ? event.segs : [];
    return segments.map(segment => segment.utf8 || "").join("");
  }

  function eventText(event) {
    return normalizeCueText(rawEventText(event));
  }

  function isRollupBreak(event) {
    return Boolean(event?.aAppend) && /^\s*\n\s*$/u.test(rawEventText(event));
  }

  function eventEndMs(event, startMs) {
    const segments = Array.isArray(event?.segs) ? event.segs : [];
    const eventDuration = Number(event?.dDurationMs) || 0;
    const segmentEnd = Math.max(0, ...segments.map(segment =>
      Number(segment.tOffsetMs || 0) + Number(segment.dDurationMs || 0)
    ));
    const duration = Math.max(eventDuration, segmentEnd);
    return startMs + (duration > 0 ? duration : 0);
  }

  function parseRollupAsrCues(events) {
    const rows = [];
    let sawBreak = false;

    for (const event of events) {
      if (isRollupBreak(event)) {
        sawBreak = true;
        continue;
      }

      const text = eventText(event);
      const startMs = Number(event?.tStartMs);
      if (!text || !Number.isFinite(startMs)) continue;

      rows.push({
        startMs,
        endMs: eventEndMs(event, startMs),
        text,
        windowId: event?.wWinId ?? null,
      });
    }

    if (!sawBreak || rows.length < 2) return null;

    const cues = [];
    for (let i = 0; i < rows.length; i += 2) {
      const first = rows[i];
      const second = rows[i + 1];
      const next = rows[i + 2];
      const text = second ? normalizeCueText(`${first.text} ${second.text}`) : first.text;
      const naturalEnd = Math.max(first.endMs, second?.endMs || 0);
      const nextStart = next?.startMs;
      const endMs = Number.isFinite(nextStart) && nextStart > first.startMs
        ? nextStart
        : naturalEnd > first.startMs
          ? naturalEnd
          : first.startMs + 1800;

      cues.push({
        startMs:first.startMs,
        endMs,
        text,
      });
    }

    return cues;
  }

  function parseJson3Cues(payload) {
    if (!Array.isArray(payload?.events)) return [];

    const sortedEvents = [...payload.events].sort(
      (a, b) => Number(a?.tStartMs || 0) - Number(b?.tStartMs || 0)
    );

    const rollup = parseRollupAsrCues(sortedEvents);
    if (rollup?.length) {
      return rollup.map((cue, index) => ({...cue, index}));
    }

    const raw = sortedEvents.map(event => {
      const text = eventText(event);
      const startMs = Number(event?.tStartMs);
      if (!text || !Number.isFinite(startMs)) return null;
      return {
        startMs,
        endMs: eventEndMs(event, startMs),
        text,
        append: Boolean(event?.aAppend),
        windowId: event?.wWinId ?? null,
      };
    }).filter(Boolean);

    raw.forEach((event, index) => {
      if (event.endMs <= event.startMs) {
        const nextStart = raw[index + 1]?.startMs;
        event.endMs = nextStart > event.startMs ? nextStart : event.startMs + 1800;
      }
    });

    const cues = [];
    for (const event of raw) {
      const previous = cues[cues.length - 1];
      const gap = previous ? event.startMs - previous.endMs : Infinity;
      const mergedText = previous ? mergeRollingText(previous.text, event.text) : event.text;
      const mergedWords = words(mergedText).length;

      const shouldMerge = previous && (
        event.append ||
        (gap <= 450 && gap >= -900 && !sentenceIsComplete(previous.text) && mergedWords <= 16 && mergedText.length <= 140)
      );

      if (shouldMerge) {
        previous.text = mergedText;
        previous.endMs = Math.max(previous.endMs, event.endMs);
        if (event.windowId !== null) previous.windowId = event.windowId;
      } else {
        cues.push({...event});
      }
    }

    return cues.map(({append, windowId, ...cue}, index) => ({...cue, index}));
  }


  function lastSentenceBoundary(text) {
    const normalized = normalizeCueText(text);
    const matches = [...normalized.matchAll(/[.!?…]["'»”’)}\]]*(?=\s|$)/gu)];
    if (!matches.length) return null;
    const match = matches[matches.length - 1];
    return match.index + match[0].length;
  }

  function translationTextForCue(cues, index) {
    const cue = cues?.[index];
    if (!cue?.text) return "";

    const current = normalizeCueText(cue.text);
    let source = current;

    const previous = cues[index - 1];
    if (previous && /^[a-zäöüß]/u.test(current)) {
      const previousText = normalizeCueText(previous.text);
      const boundary = lastSentenceBoundary(previousText);
      const tail = boundary === null ? previousText : previousText.slice(boundary).trim();
      if (tail) source = normalizeCueText(`${tail} ${source}`);
    }

    const boundary = lastSentenceBoundary(source);
    if (boundary !== null && boundary < source.length) {
      const tail = source.slice(boundary).trim();
      const tailWords = words(tail);

      if (tailWords.length <= 2) {
        source = source.slice(0, boundary).trim();
      } else if (!sentenceIsComplete(source)) {
        const next = cues[index + 1];
        if (next?.text) {
          source = mergeRollingText(source, next.text);
        }
      }
    }

    return normalizeCueText(source);
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

  const api = { normalizeCueText, mergeRollingText, parseJson3Cues, cueAtTime, sentenceIsComplete, translationTextForCue };
  globalThis.GLEYoutubeCues = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
