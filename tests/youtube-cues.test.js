const test = require("node:test");
const assert = require("node:assert/strict");
const { parseJson3Cues, cueAtTime } = require("../src/youtube-cues.js");

test("JSON3 word events merge into timed phrase cues and keep cue end times", () => {
  const cues = parseJson3Cues({
    events: [
      { tStartMs: 0, dDurationMs: 700, segs: [{ utf8: "Wir " }] },
      { tStartMs: 700, dDurationMs: 700, segs: [{ utf8: "sprechen " }] },
      { tStartMs: 1300, dDurationMs: 800, segs: [{ utf8: "Deutsch." }] },
      { tStartMs: 2500, dDurationMs: 1000, segs: [{ utf8: "Danach." }] },
    ],
  });

  assert.deepEqual(cues, [
    { startMs: 0, endMs: 2100, text: "Wir sprechen Deutsch.", index: 0 },
    { startMs: 2500, endMs: 3500, text: "Danach.", index: 1 },
  ]);
  assert.equal(cueAtTime(cues, 0)?.text, "Wir sprechen Deutsch.");
  assert.equal(cueAtTime(cues, 2099)?.index, 0);
  assert.equal(cueAtTime(cues, 2100), null);
  assert.equal(cueAtTime(cues, 2500)?.index, 1);
  assert.equal(cueAtTime(cues, 3500), null);
});

test("JSON3 events without durations infer an end from the next cue", () => {
  const cues = parseJson3Cues({
    events: [
      { tStartMs: 1000, segs: [{ utf8: "Hallo " }] },
      { tStartMs: 2000, segs: [{ utf8: "Welt" }] },
    ],
  });

  assert.equal(cues[0].text, "Hallo Welt");
  assert.equal(cues[0].startMs, 1000);
  assert.equal(cues[0].endMs, 3800);
  assert.equal(cueAtTime(cues, 3799)?.text, "Hallo Welt");
  assert.equal(cueAtTime(cues, 3800), null);
});

test("empty and malformed caption events are ignored", () => {
  assert.deepEqual(parseJson3Cues({ events: [] }), []);
  assert.deepEqual(parseJson3Cues({ events: [{ tStartMs: 10, segs: [{ utf8: "  " }] }] }), []);
});
