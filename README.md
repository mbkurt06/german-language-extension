# German Language Extension

Chrome Manifest V3 client for the German Language Engine.

## Goal
Real subtitle testing on ZDF, ARD Mediathek and YouTube with the UX rule **context first, dictionary second**.

The extension is intentionally thin:
1. a site adapter observes visible subtitle text;
2. subtitle words become hover targets;
3. the full sentence is sent to the language engine;
4. hover renders expression/chunk first, contextual meaning next, lexical/dictionary detail last.

## Local development
Load this repository as an unpacked extension in Chrome. The default engine endpoint is `http://127.0.0.1:8765` and can be changed in the extension options.

## Architecture
The extension does not implement German grammar. Platform-specific DOM handling stays here; linguistic analysis stays in `german-language-engine`.

### Status
This is the first real-environment scaffold. YouTube has an explicit caption selector. ZDF/ARD selectors are deliberately adapter-based and will be hardened from observations in live pages during testing.
