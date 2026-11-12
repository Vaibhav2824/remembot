# Remembot design system: Instrument

The source of truth for `public/index.html`. Every colour, size, gap, radius, shadow and duration in the CSS comes from a token below. No literal values past the `:root` token block.

## Direction

A precision instrument for questions over time: graphite surfaces, one amber readout, nothing decorative. The person is checking whether something they learned last week still holds. The answer is the focal point of every screen; everything else (memory, searches, timings) is instrument readout, quiet until looked at.

- **Dark first**, light as an equal second theme (`prefers-color-scheme`).
- **Depth by surface steps**, a few percent of lightness each. Edges only at structural seams (sidebar edge, composer, inputs) and as an inset 1px `--hairline` on raised controls and blocks, which would vanish into the light canvas without one.
- **One accent, amber**, used for: the send action, citations, today in the scrubber, the search meter, focus. Never for decoration. Under 10% of any screen.
- **Mono is for readouts only**: times, durations, counts, the search meter. Never for labels, tags or headings.
- **No texture, no glow, no gradient washes.**

Signature: the readouts. The 6-cell search meter that fills one cell per search, and the 14-day scrubber, which share one visual language (amber cell = now/used, graphite cell = idle).

## Colour tokens

| Token | Dark | Light | Use |
| --- | --- | --- | --- |
| `--canvas` | `#111214` | `#f6f6f7` | Page and sidebar background (same surface; the seam is a hairline) |
| `--raised` | `#18191c` | `#ffffff` | User question block, source chips, composer, buttons |
| `--raised-2` | `#212226` | `#efeff1` | Hover on raised things, island, tooltip |
| `--sunken` | `#0c0d0e` | `#ececee` | Meter and scrubber idle cells, code |
| `--hairline` | `rgb(255 255 255 / 0.07)` | `rgb(20 20 22 / 0.09)` | Structural seams only |
| `--hairline-strong` | `rgb(255 255 255 / 0.12)` | `rgb(20 20 22 / 0.16)` | Composer and input edges, hover seams |
| `--text-1` | `#ececee` | `#141416` | Answers, questions, headings |
| `--text-2` | `#a0a0a8` | `#55565e` | Supporting text, labels |
| `--text-3` | `#8b8c94` | `#6b6c74` | Readouts and meta (4.5:1 or better on every surface, checked) |
| `--text-off` | `#5b5c63` | `#a5a6ad` | Disabled labels only |
| `--signal` | `#f0a43a` | `#e8912a` | Amber fill: send, meter cells, today bar |
| `--signal-ink` | `#1a1205` | `#1a1205` | Text and icons on `--signal` |
| `--signal-text` | `#f0a43a` | `#a15c00` | Amber as text: citations, focus ring |
| `--signal-wash` | `rgb(240 164 58 / 0.12)` | `rgb(232 145 42 / 0.14)` | Citation chip background, selection |
| `--danger` | `#ff6b5e` | `#c2362b` | Error text and the island's error state |
| `--scrim` | `rgb(0 0 0 / 0.55)` | `rgb(20 20 22 / 0.32)` | Behind the mobile drawer |
| `--shadow-float` | `0 0 0 1px rgb(255 255 255 / 0.06), 0 8px 24px rgb(0 0 0 / 0.45)` | `0 0 0 1px rgb(20 20 22 / 0.06), 0 2px 4px rgb(20 20 22 / 0.04), 0 8px 24px rgb(20 20 22 / 0.08)` | Floating things only: island, tooltip, drawer |

Browser surfaces are themed: `::selection` uses `--signal-wash`, `caret-color: var(--signal-text)`, `scrollbar-color: var(--raised-2) transparent`.

## Type

Families: `--sans: "Geist"`, `--mono: "Geist Mono"`, both with system fallbacks. Two families, three weights (400, 500, 600). `-webkit-font-smoothing: antialiased` on the root.

Scale, ratio about 1.2, whole pixels:

| Token | Size / line height | Weight | Use |
| --- | --- | --- | --- |
| `--t-display` | 32 / 1.1, tracking -0.03em | 600 | Welcome heading only |
| `--t-title` | 18 / 1.35, tracking -0.01em | 600 | Day groups in the timeline header, empty-state heads |
| `--t-body` | 15 / 1.65 | 400 | Answers, questions, welcome copy |
| `--t-ui` | 14 / 1.4 | 500 | Buttons, timeline questions, example questions |
| `--t-small` | 13 / 1.45 | 400 | Trace summary, source chips, labels, tagline |
| `--t-readout` | 12 / 1.4, mono, `tabular-nums` | 400 | Times, durations, counts, meter label |

Rules: hierarchy from size + weight + text colour together. Headings `text-wrap: balance`; body `text-wrap: pretty`. Answer measure capped at 68ch. No italic inside headings, no accented words, no tracked capitals, no eyebrows.

## Spacing

4px base. Tokens: `--s1` 4, `--s2` 8, `--s3` 12, `--s4` 16, `--s5` 20, `--s6` 24, `--s8` 32, `--s10` 40, `--s12` 48, `--s16` 64. No other values.

- Micro (icon to text): `--s2`.
- Component padding: controls `--s2 --s3`; chips `--s1 --s2`; composer `--s2` around a `--s3` text inset.
- Between parts of one answer (question, trace, answer, sources, readout): `--s3`.
- Between exchanges: `--s10`.
- Sidebar gutters `--s4`; chat gutters `--s6` desktop, `--s4` phone.

## Radii

`--r-xs` 2 (meter cells, scrubber bars, keyboard keys, inline code), `--r-sm` 6 (chips, buttons), `--r-md` 10 (question block, sources, cards), `--r-lg` 14 (composer, drawer edge). Pill (`999px`) only on the island and the round send button. Nested radii are concentric: outer = inner + padding.

## Motion

| Token | Value | Use |
| --- | --- | --- |
| `--d-press` | 120ms | `:active` press |
| `--d-quick` | 160ms | Colour and background on hover |
| `--d-detent` | 200ms | Island, tooltip, meter cells, menu |
| `--d-drawer` | 280ms | Mobile drawer |
| `--ease-out` | `cubic-bezier(0.23, 1, 0.32, 1)` | Everything entering or responding |
| `--ease-move` | `cubic-bezier(0.77, 0, 0.175, 1)` | On-screen movement and live-state breathing |
| `--ease-drawer` | `cubic-bezier(0.32, 0.72, 0, 1)` | The phone drawer |

Rules: animate `transform` and `opacity` only; name properties, never `transition: all`. Press is `scale(0.97)`. Nothing appears from `scale(0)`; start at 0.96 + opacity 0. Exits are faster than entrances (the island leaves in `--d-press`, arrives in `--d-detent`).

Libraries (CDN, pinned, optional: the page works the same if any fails to load): Lenis 1.3.27 for scrolling, GSAP 3.15.1 with SplitText for choreography, three.js r134 + Vanta 0.5.24 (NET) for the welcome ambient. GSAP's ticker drives Lenis.

What moves, and what does not:
- **Welcome screen**: the headline reveals word by word from a mask (SplitText, `expo.out`, 0.9s, 50ms stagger, after fonts load); the sentence, example rows and hint follow with a 10px rise, 60ms apart. On load and on New chat only.
- **Welcome ambient**: Vanta NET, amber points and links on the canvas colour, at 0.6 opacity, masked to the top-right corner so it never sits behind text. Desktop only (820px and up), never with reduced motion or data saver, loaded lazily, and faded out and destroyed on the first question.
- **Messages**: your question settles in from the right (10px, 0.98 scale, 0.45s `expo.out`). Answers are not animated while they stream; when one finishes, its sources stagger in, the readout fades in and the used meter cells fill left to right.
- **Scrolling**: Lenis (lerp 0.12) on the chat and the timeline. The chat follows the stream only while the reader is at the bottom; an upward scroll stops following and shows **Jump to latest**. The scrubber glides the timeline to a day.
- **First load**: scrubber bars grow from zero (30ms apart) and timeline days fade up, once per page load.
- **Tooltip**: fade + 2px rise + 0.97 scale from its trigger (bottom centre), `--d-quick`.
- **Live state** (typing cursor, working island): an opacity breathe, 1.2s, `--ease-move`. Never a scale pulse. Waiting and error states hold still.
- **Meter cells** light one at a time, 40ms apart, by opacity. **Scrubber bars** grow with `transform: scaleY()` from the bottom.

`prefers-reduced-motion: reduce` keeps fades and colour changes and drops every transform: no GSAP choreography or Vanta, Lenis scrolls instantly, the island and tooltip stop moving, the drawer and chevron switch instantly, and press scaling is off. Content is visible with scripting off; anything hidden at rest is hidden under a `.js` class the script adds.

## Layout

- Desktop: sidebar 288px on the same canvas as the chat, split by a `--hairline` (navigation serves content). Chat column max 720px, centred in the remaining space; composer matches the column.
- Under 820px: the sidebar becomes a drawer, `min(320px, 86vw)`, over `--scrim`. The Memory button carries `aria-expanded`; Escape and the scrim close it; the drawer is `inert` while closed; focus moves into it on open and back to the button on close.
- Under 480px: chat gutters `--s4`; readouts that do not fit wrap, never truncate.
- `overflow-x: clip` on `html` and `body`. `min-height: 100dvh`. Safe-area insets on the composer.
- z-index scale: `--z-bar` 10, `--z-drawer` 20, `--z-island` 30, `--z-tooltip` 40.

## Components

**Answer entry (the focal point).** Order: question, trace summary, answer, sources, readout.
- Question: `--raised` block, `--r-md`, `--s3 --s4` padding, `--t-body` `--text-1`, right-aligned in the column, max 80%. Not inverted.
- Trace summary: one `--t-small` `--text-3` line, for example "Recalled 2 exchanges, searched 3 times". It is a `<details>`; the queries and memory windows open beneath it. Never louder than the answer.
- Answer: on the canvas, `--t-body` `--text-1`, 68ch.
- Citations: `--t-readout` in a `--signal-wash` chip, `--signal-text`, `--r-sm`. Hover and focus fill `--signal` with `--signal-ink`. Tooltip shows title and host on `--raised-2` with `--shadow-float`.
- Sources: `--raised` chips, `--r-sm`, number in `--t-readout` `--text-3`, title `--t-small` `--text-2`. Favicon optional and 14px.
- Readout line: `--t-readout` `--text-3`: time, first-word latency, total, then the search meter. Items separated by `--s4` of space, never by middle dots.

**Search meter.** Six cells, 14 × 6px, `--s1` apart, `--r-xs` corners. Used cells `--signal`, idle cells `--hairline-strong` (`--sunken` disappears against the dark canvas). Label "3 of 6 searches" in `--t-readout`. "Answered from memory" when zero.

**Scrubber.** Fourteen columns. Bar height = questions that day, `scaleY` from a 4px idle stub; idle `--hairline-strong`, days with questions `--text-3`, today `--signal`, hovered/selected `--text-1`. Day letters `--t-small` `--text-3` (sans, not mono). Count readout in `--t-readout`. Empty: "Your questions will show here, one bar per day." in `--t-small`.

**Composer.** `--raised`, `--hairline-strong` edge, `--r-lg`. Focus: edge becomes 1px `--signal-text`, no glow, no second ring. Placeholder `--text-3`. Send: 36px round `--signal` button with `--signal-ink` arrow; stop state swaps the icon.

**Buttons.** Primary is the send button only. Secondary (New chat, Load demo memory, Memory): `--raised`, `--t-ui`, `--text-1`, `--r-sm`, 36px tall with a 44px hit area; hover `--raised-2`. Ghost for timeline rows: transparent, hover `--raised`.

**States, every control:** default, hover (`--raised-2` or wash, `--d-quick`), active (`scale(0.97)`, `--d-press`), focus-visible (2px `--signal-text` outline, offset 2px, appears instantly), disabled (`--sunken` fill, `--text-off`, `cursor: not-allowed`, the `disabled` attribute; never opacity alone), loading (island + stop icon).

**Island.** Pill on `--raised-2` with `--shadow-float`, `--t-small` `--text-1`, a 6px state cell: `--signal` working, `--text-3` waiting, `--danger` error. Errors stay until dismissed or 6s pass, and are also announced via `role="status"`.

**Timeline.** Day groups headed by `--t-small` 500 `--text-2` ("Today", "Yesterday", "Tue 10 Nov"). Rows: time in `--t-readout` `--text-3`, question in `--t-ui` `--text-1`, single line with ellipsis, full text in `title`.

**Welcome.** Display heading on one line ("Ask something. Ask again next week." as one roman sentence, no italic second line), one `--t-body` `--text-2` sentence, then the three example questions as a plain list of `--t-ui` buttons on the canvas with a `--hairline` between rows, each with a `--t-small` `--text-3` note of what it shows. No badges, no cards, no arrows in coins.

## Copy

Sentence case. No middle-dot joins, no arrows glued to text, no decorative status dots, no exclamation marks. Errors say what happened and what to do next. Times are local and absolute ("21:37", "Tue 10 Nov").
