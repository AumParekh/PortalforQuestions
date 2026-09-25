# FRM Study Portal — Build Plan

Status: **awaiting approval**. Nothing in `web/` gets built until (1) all `content/*.json`
subject files + mocks are extracted and committed, and (2) this plan is approved.

Decided so far:
- **Sync strategy: last-write-wins, wholesale replace** (no per-question merge).
- **Mocks hosting: public repo.** All mock content, including GARP-derived mocks, has
  been reworded/paraphrased by the user, so it's cleared for the same public repo as
  the rest of `content/`. No separate private repo needed.

---

## 0. Sequencing

1. Finish content extraction: IR ✅, OR ✅, MR (in progress) → CR → LR/CI → mocks.
2. This plan is reviewed/approved (or amended) by the user.
3. Scaffold `web/` starting with **Phase 1 only**, show a working local build, then
   proceed phase by phase — never build everything at once.

---

## 1. Tech stack

- **Framework:** React + Vite
- **Styling:** Tailwind CSS
- **Math rendering:** KaTeX
- **Markdown + tables:** `react-markdown` + `remark-gfm`
- **State:** Zustand
- **Storage:** IndexedDB via `idb` for progress; `localStorage` for settings
- **Charts:** `recharts`
- **Spaced repetition:** `supermemo` (SM-2 algorithm)
- **PWA:** `vite-plugin-pwa`
- **Deployment:** GitHub Pages via GitHub Actions, custom domain

No backend. GitHub itself is the only "server," used for content hosting and progress
sync via the Contents API.

---

## 2. Content data flow

The build step copies `content/*.json` into `web/dist/content/` at deploy time; the app
fetches `/content/IR.json` etc. at runtime — no CORS, works fully offline via the
service worker.

The **Session Setup** selector (subject / reading / topic / LO) is built at runtime by
scanning the loaded JSON and grouping questions by `subject → reading → topic → lo`.
It is never hardcoded, so adding a new subject or mock later requires no UI changes —
it appears automatically once its JSON file exists.

---

## 3. Screens and build order

### Phase 1 — core loop (MVP; ship first, nothing else until this works)

**Session Setup**
- Scope tabs: By Subject / By Reading-Chapter / By Topic / By LO.
- Scrollable checkbox list, one row per item in the current scope: name, question
  count, progress indicator (e.g. "72% correct" / "not started"). Whole row is
  tappable. "Select all" / "Clear all".
- Filter chips: Not started / Weak (<70%) / Due for review / Has trap cards.
- Session options panel (collapsible): question count (10/20/50/All, default 20),
  order (Sequential / Shuffled / Weakest first / Random), timer on/off (default 2 min),
  include-trap-only toggle, wrong-questions-first toggle.
- Sticky bottom bar: live "N questions selected" counter + "Start Session" (disabled
  until ≥1 item selected).
- Remembers last-used scope/options.

**Question screen**
- Sticky top bar: back, topic label, question counter ("12/50"), jump-to icon.
- Circular countdown timer (2 min default): yellow at 25% remaining, red at 10%,
  auto-submits as wrong at 0.
- Thin progress bar under the top bar.
- Question stem: large, readable, LaTeX renders inline via KaTeX.
- Options: vertically stacked, full-width, ≥56px tall, letter-in-circle + text.
  **No truncation, no ellipsis, no fixed height — ever** (see §5).
- Tap → instant feedback (<200ms): green flash/check or red shake/X with correct
  answer highlighted.
- Solution panel expands below: full markdown + LaTeX + tables, then per-option
  analysis (collapsible), then the trap badge/explanation if `trap.operators` is
  non-empty.
- Sticky bottom bar: Prev / Skip (requeues to end of session by default — see the
  decided default in §7) / Next (or "Finish Session" on the last question).

**Jump-to-Question drawer**
- Bottom sheet (mobile) / side drawer (desktop) listing every question in the session
  queue.
- Grid view: numbered cells, colour-coded — grey (not reached), blue (current),
  green (correct), red (wrong), yellow (skipped), purple (marked for review).
- List view toggle: stem snippet + topic + status per row.
- Filter chips: All / Unanswered / Wrong / Skipped / Marked.
- Tap any cell/row to jump directly, answered or not.

### Phase 2 — persistence

- IndexedDB wrapper (`lib/storage.ts`): question-state rows, append-only attempt log,
  session records. See §4 for the data model.
- **Dashboard**: greeting, "Today's quest" card, streak (flame icon), accuracy ring,
  stats row (attempted/correct/wrong/time), weak-LO list (top 5, tappable), topic map
  (progress bars per subject/topic), quick-start buttons (New Session, Survival Run,
  Random Drill, Review Wrong, Mock Exam).
- **Review-wrong screen**: every incorrectly-answered question, sorted by most recent;
  filter by topic/LO/trap type/date; "Drill these" starts a session from the list.
- **Search & filter** (see §6) — index built once on app load, used by both the
  dashboard search bar and the Session Setup live-filter search.

### Phase 3 — polish

- Dark mode (system-preference default, manual toggle).
- PWA manifest + service worker, full offline caching of JSON + assets, installable
  ("Add to Home Screen").
- Animations/transitions (subtle only), haptic feedback via `navigator.vibrate` on
  correct/wrong (on by default mobile, off desktop).
- **Analytics screen**: accuracy over time (line), accuracy by topic (bar), time-per-
  question distribution, streak heatmap, weakest LOs, trap-operator performance.

### Phase 4 — advanced

- SM-2 spaced repetition scheduling (see §4).
- Mock exam mode: timed, no immediate per-question feedback.
- Related-questions chips at the bottom of every solution panel (same topic / same LO;
  tapping jumps to it in-session or appends + jumps if not in the current session).
- In-session search: magnifier icon on the question screen, scoped to just the current
  session's queue, same search function as §6.
- Cross-device sync (see §7).

---

## 3b. True / False flashcards (added during Phase 2)

A separate study mode built from the existing option analysis: each non-numerical
answer option that makes a standalone claim becomes a statement to judge as True or
False, with a short explanation.

**Deck generation (content/flashcards/<SUBJECT>.json).** Only options from
non-numerical questions; only complete, standalone claims (no fragments, numbers,
formulas, or claims about a question's specific scenario). Truth is judged per
option, not copied from the verdict: on "LEAST accurate / EXCEPT" questions the
credited answer is the false statement, and an incorrect option that is true but not
the best answer is skipped rather than marked false. Light rewording to make a claim
standalone is allowed and flagged (`edited`, with `originalText`). Every slice is
spot-checked by an independent verifier; disputed cards are dropped. Each card keeps
`sourceId` so the full question is one tap away.

```json
{ "id": "TF-IR-T1-04-c", "sourceId": "IR-T1-04", "optionKey": "c",
  "subject": "...", "tier": "...", "topic": "...", "lo": "...", "loText": "...", "reading": "...",
  "statement": "...", "isTrue": true, "explanation": "...", "edited": false }
```

**Screen (`#/truefalse`).** Pick subjects/topics (or "missed before" / "never seen"),
deck size, and order; one statement per card with large True / False buttons
(keyboard T/F, swipe right/left); instant feedback with the explanation and a link to
the source question; progress through the deck; end-of-deck summary.

**Log.** Own IndexedDB stores (DB version 2): `tfState` (one row per card: attempts,
correct, lastResult, lastAttempted) and `tfAttempts` (append-only). Answers count
toward the daily streak and "Today's quest"; the dashboard shows a True/False card
with accuracy and cards seen; a "missed statements" filter re-drills wrong cards.

---

## 3c. Notes → Games (from the LaTeX notes in `notes/`)

Two parts: extraction of the six-area notes (MR, CR, ORR, LTR, IM, CI; 107 readings)
into `content/games/game-blocks.json`, then a runtime game layer that reads it (no
runtime LLM calls). The user asked for the phases to run without pausing for
confirmation, stopping only on genuine ambiguity.

Decisions taken during Phase 1:
- **Trap sourcing.** Every trap box contributes trap items, not just the
  "Consolidated trap summary" (only LTR and IM have one). Beyond explicit trap boxes,
  content is also mined for implicit traps (contrasts, sibling pairs, polarity claims
  that read like a trap), including ORR, which has no trap boxes. Mined traps carry
  `origin: "mined"`; explicit ones `origin: "trapbox"` or `"summary"`.
- **Categories.** The eight canonical categories (Polarity, Sibling, Role, Sign, Scope,
  Definition, Formula, Intermediate result) plus a ninth, **Sequence**, for ordering
  errors. Calculation → Formula; Input twin and Confidence twin → Sibling; Ordering →
  Sequence; Numbering → source note. Every trap keeps `raw_category`.
- **ORR note boxes (`ornotebox`).** A tenth block type, `notebox`, with its title kept as
  a subtype (note / remember / outcome / source). Source notes also go to
  `source_notes`; outcomes also feed the Case Docket. New mechanic **Pin the Note**:
  margin notes drift in and the player pins each to the concept, table or case it
  belongs to.
- **Publishing.** `notes/` holds the `.tex` sources (Vol 1 duplicate dropped);
  `game-blocks.json` and the coverage report are committed alongside.

**Goal, in the user's words: learn, recall, revise, and get better at everything in
the notes.** Every mechanic is judged against retention, not novelty. Added mechanics
(beyond the brief's catalogue), chosen for the strongest retention evidence:
- **Blurt Board** — pick an LO, free-recall everything onto a blank board; the game
  lights up which extracted items (terms, bullets, numbers, variables) were hit and
  which were missed; misses seed the next drill.
- **Cloze Chain** — load-bearing sentences with the key term / number / direction
  blanked; graded cues (first letter → options) only on request.
- **Memory Palace** — each reading is a room with fixed loci; its key items live at
  fixed spots; the player walks the room and places them.
- **Formula from Memory** — rebuild a formula from blank tiles, then name each
  variable (from notation keys).
- **Interleaved Gauntlet** — mixed items across readings and areas to train
  discrimination between look-alike concepts.
- **Explain It Back** — shuffled cause → channel → effect fragments to assemble.
- **Pin the Note** — ORR note boxes pinned back onto their concept, table or case.

**Decisions on the game layer's integration:**
- **Streak.** Game sessions count as study days for the dashboard streak and daily
  goal, but no streak, goal or points appear inside any game.
- **Game log.** Stored in the browser (IndexedDB) exactly like quiz progress, one
  record per session in the brief's Phase 9.7 format, viewable in the app; it joins
  the question-bank data in the planned GitHub sync (§7).
- **Linked banks.** Note readings are mapped to question-bank readings and topics
  (IM ↔ IR, LTR ↔ LR, ORR ↔ OR; MR, CR, CI share codes). A missed question offers the
  matching notes game, a notes session links to matching questions, and misses in
  either feed the same weak-spot tracking.
- **Entry.** A "Play" button that auto-picks by the brief's rotation rules and weak
  spots, plus a browser to pick any reading or any mechanic directly.

**Shared memory.** Every extracted item has a stable ID; every answer in any game is
logged against it and feeds one spaced-repetition schedule, so a miss anywhere
resurfaces sooner everywhere. The only numbers shown are stability measurements
(caught/missed by trap category, items due, objectives covered), per the brief.

---

## 4. Progress data model

Stored in **IndexedDB**, not `localStorage` (localStorage caps at 5–10MB and will fill
fast with thousands of questions × attempts). `localStorage` is used only for tiny,
synchronous settings: theme, timer default, session-length default.

**Per-question state row** (one per question ever attempted):
```js
{
  questionId: "IR-T1-01",
  subject: "IR", reading: "Reading 87", topic: "VaR", lo: "IR-LO2",
  totalAttempts: 4, totalCorrect: 2, totalWrong: 2,
  consecutiveCorrect: 0, lastResult: "wrong", lastAttempted: "2026-09-25T14:32:11Z",
  lastSelected: "c", avgTimeSeconds: 44,
  // SM-2 fields
  interval: 0, repetition: 0, efactor: 2.3, dueDate: "2026-09-26",
  markedForReview: false
}
```

**Attempt log entry** (append-only, immutable, one per tap):
```js
{
  attemptId: "att-9f3a...", questionId: "IR-T1-01", timestamp: "...",
  sessionId: "sess-8b21...", selectedOption: "c", correctOption: "b",
  isCorrect: false, timeTakenSeconds: 47, mode: "drill", skipped: false
}
```

**Session record** (written once, at session end):
```js
{
  sessionId: "sess-8b21...", startedAt: "...", endedAt: "...", mode: "drill",
  scope: { subject: "IR", readings: ["Reading 87"], los: ["IR-LO2","IR-LO3"] },
  totalQuestions: 20, answered: 18, skipped: 2, correct: 14, wrong: 4,
  accuracy: 0.778, avgTimeSeconds: 41
}
```

Every tap writes exactly two records (attempt + question-state upsert), both async,
both <5ms. Nothing is recomputed from raw content on the fly for "have I attempted
this" / "was I right" / "how many times wrong" — those all read straight from the
question-state row. Dashboard-level aggregates (overall accuracy, weak LOs) are a
single pass over the question-state store.

**Spaced repetition (SM-2, via the `supermemo` package):** each attempt is graded 0–5
from correctness + speed (5 = correct <15s, 4 = correct 15–30s, 3 = correct 30s+,
2 = wrong-but-familiar, 1 = wrong, 0 = wrong-and-unfamiliar). The grade feeds SM-2,
which returns updated `interval`/`repetition`/`efactor`/`dueDate`, overwriting the
question-state row. "Today's Quest" = all questions with `dueDate <= today`.

**Jump-drawer cell colour** reads directly off `lastResult` / `markedForReview` /
session-local skip flags (skip status is session-scoped, not persisted long-term, so
it resets each session).

**Current session resume:** the active queue, current index, and skip flags are
written to a `currentSession` record in IndexedDB on every navigation. On app load, if
`currentSession` exists and isn't finished, offer "Resume session?".

---

## 5. UI/UX content rules (non-negotiable)

1. **Never truncate, clip, or ellipsis question/option/solution text.** No
   `text-overflow: ellipsis`, no `-webkit-line-clamp`, no fixed heights, no
   `overflow: hidden` on text containers. Every word is visible before the user taps.
2. **The layout adapts to content, not the reverse.** Question card uses `min-height`,
   never `height`. Options grow to fit text, never fixed height. Long tables/formulas
   scroll horizontally *within their own container*, never widen the page.
3. If a question exceeds ~500 characters or contains a table, the timer collapses to a
   compact inline display (`⏱ 01:42`) instead of the circular ring, freeing vertical
   space. Sticky top bar (timer/counter) and sticky bottom bar (Prev/Skip/Next) stay
   fixed regardless of question length; the question body scrolls independently.
4. Default type: 16px body, 20–24px question, 16px options, line-height 1.5–1.7, never
   below 15px anywhere. Fonts: **Inter** primary, **Lato** fallback, **Atkinson
   Hyperlegible** as an accessibility toggle, **JetBrains Mono**/Fira Code for
   formula/code contexts.
5. Mobile-first at 375px, breakpoints sm/md/lg/xl (640/768/1024/1280). Tablet/desktop
   centers the question card at max-width 720px. No horizontal page scroll, ever,
   `overflow-x-hidden` on `<body>`. Touch targets ≥44×44px, options ≥56px tall. Respect
   `env(safe-area-inset-*)` for iPhone notch/home-indicator.
6. **Dev regression route**: a hidden `/dev/longest?dev=1` route renders the single
   longest `question` and longest `options[].text` found across all `content/*.json`,
   used to visually verify every layout change against the worst case before shipping.
   Removed (or left gated behind the query param) before treating a phase as "done."
7. Reference platforms to study for layout discipline (not visual style): Brilliant.org
   and Anki Web (variable-length Q&A + SRS state), UWorld and Becker (explanation-heavy
   MCQ UI), Stripe Docs and MDN (readable long-form technical text), Linear and Notion
   mobile (spacing discipline, sticky/drawer patterns).

**Verification checklist before any phase is considered done** (test against real
content from `content/*.json`, including the longest question, a question with a
table, a question with block LaTeX, and an option with 200+ characters):
- [ ] 375px phone: no horizontal scroll, nothing hidden behind sticky bars.
- [ ] Long question: full stem visible via scroll, nothing clipped.
- [ ] Table in stem/solution: renders inline, scrolls horizontally if wide.
- [ ] Block/inline LaTeX renders via KaTeX, never raw `$...$`.
- [ ] Long option text wraps fully, no ellipsis.
- [ ] Timer and Prev/Skip/Next stay visible while scrolling a long question.
- [ ] Tap-to-feedback latency <200ms.
- [ ] Progress survives a full page reload.
- [ ] Dark mode: legible contrast everywhere, not just inverted colours.
- [ ] iPad/desktop: card centered, max-width 720px, keyboard nav works.
- [ ] `/dev/longest` renders cleanly.

---

## 6. Search & filter

Entirely client-side, one index built once on app load (~500KB in memory for ~1,500
questions):
```js
{ id, topic, lo, searchable /* lowercase concat of topic, loText, reading, stem,
                                 all option texts, solution, trap.operators, tags */ }
```
```js
function search(query, index) {
  const q = query.toLowerCase().trim();
  if (!q) return null;
  const terms = q.split(/\s+/).filter(Boolean);
  return index.filter(item => terms.every(t => item.searchable.includes(t))).map(i => i.id);
}
```
- Case-insensitive, partial substring match, multi-word = AND.
- 150ms debounce after the last keystroke.
- **v1 is filtered-only, sorted by `id`** — no ranking. If ranking is added later,
  weight `topic`/`loText` highest, `question` next, `solution` lowest.

**Two entry points, same index:**
- **Dashboard search bar** — dropdown shows "N questions found" + top 3 matching
  topics with counts + "Start session with these →" (jumps to Session Setup with the
  query pre-applied as a filter chip).
- **Session Setup search bar** — filters the visible checklist live; zero-match items
  hide; a "Clear search" chip resets it.

**Filters** (separate from search, combine via AND): a "Filters" button opens a bottom
sheet — Status (never attempted / wrong last time / marked / due), Difficulty (1–5
multi-select), Trap type (13 operators, multi-select), Has trap/table/formula (Y/N),
Time target (<30s / 30–60s / >60s), Correct/Wrong count thresholds.

**Related questions**: up to 2 chips at the bottom of every solution panel (same topic
or same LO); tapping jumps in-session or appends-then-jumps.

**In-session search**: magnifier icon on the question screen scopes the same search
function to just the current session's queue.

No API calls for search, ever. Index built once per app load, not re-built per
keystroke.

---

## 7. Progress sync (cross-device) — decided: last-write-wins, wholesale replace

Simple two-way sync, **no merge logic**. Whichever device pushes first becomes the
source of truth; any device that opens after pulls that state and **replaces its own
entirely**. Offline edits on a second device, if it opens after another device already
pushed newer state, are discarded — this tradeoff is accepted for solo study.

**State file:** `progress/progress.json` in the repo.
```json
{
  "version": 1, "device": "iphone-aum", "syncedAt": "2026-09-25T21:44:12Z",
  "questions": [ /* all question-state rows */ ],
  "sessions": [ /* session records, last 30 days; older pruned from sync payload
                   but kept locally in IndexedDB */ ]
}
```

**Pull on open** (every app load, before rendering the dashboard):
1. Read local IndexedDB.
2. Fetch `progress/progress.json` from GitHub.
3. Fetch fails → use local, set `pendingPull = true`, retry next open, don't block UI.
4. Fetch succeeds → compare `remote.syncedAt` vs `local.lastSyncedAt`:
   - remote newer → **replace local IndexedDB entirely** with remote data, show a
     2-second toast "Synced from another device".
   - local newer → push immediately.
   - equal → do nothing.
5. Don't block the UI more than ~2 seconds; render local state and reconcile in the
   background if the pull is still in flight, then re-render if state changed.

**Push on close**, debounced 30s after `visibilitychange → hidden` and immediately (via
`sendBeacon`/`fetch keepalive: true`) on `pagehide`:
1. Skip entirely if not dirty.
2. Read local IndexedDB, build `progress.json` with `syncedAt = now`.
3. PUT to GitHub Contents API (`keepalive: true` so the request survives page unload).
4. Success → `lastSyncedAt = now`, clear dirty flag. Failure → leave dirty set, retry
   next open.
- Cancel a pending debounced push if the tab becomes visible again before it fires.

**Safety net on every open:** if `dirty` is still true, push immediately; if
`lastSyncedAt` is >24h old, push regardless (covers iOS PWA force-quit edge cases where
`visibilitychange` doesn't fire).

**Attempt log:** synced as a separate, smaller `progress/attempts.json`, append-only,
rolling window of the last ~1,000 entries, deduped by `attemptId` on write. Kept
because it survives even a wholesale-replace on `progress.json` — you never fully lose
the historical record of what you answered, only the "last result" summary for a
question if it was edited offline on two devices in the same window.

**Settings UI:** "Last synced: <relative time>", "Sync now" (manual pull-then-push),
"Disconnect GitHub" (clears the token, stops syncing), a small "pending changes" dot on
the settings icon when dirty.

**Auth:** a fine-grained GitHub personal access token (Contents: Read/write, scoped to
this one repo) entered once in Settings and stored in `localStorage` — never committed.

**Do NOT:** merge; sync per-question or per-session; show spinners/modals for sync;
block the UI >2s on pull; retry more than once per app load; commit anything to the
repo besides `progress/progress.json` and `progress/attempts.json`.

---

## 8. Deployment

- Target: **https://study.aumparekh.com**
- Hosting: **GitHub Pages**, public repo — cleared for all content including mocks
  (all reworded/paraphrased, no verbatim GARP text).
- Deploy via `.github/workflows/deploy.yml`: builds `web/` with Vite, copies
  `content/*.json` into `web/dist/content/`, publishes via `actions/deploy-pages`.
- `web/public/CNAME` contains `study.aumparekh.com`; Vite `base: '/'`.
- DNS: one `CNAME` record at the registrar — `study` → `<username>.github.io`.
- Repo Settings → Pages → Source: GitHub Actions; custom domain set; Enforce HTTPS
  once the cert issues.
- Raw source PDFs are never committed (`raw/` stays in `.gitignore` if it's ever used
  as a local scratch location); only paraphrased JSON lives in `content/`.
- A `LICENSE` and short `README.md` note that the content is the user's own paraphrased
  study material, not verbatim GARP text.
- Service worker caches all `content/*.json` + assets for full offline use.

---

## 9. Repo structure

```
repo/
  content/
    IR.json  MR.json  CR.json  LR.json  OR.json  CI.json
    mocks/
      <mock-slug>.json
  PORTAL_PLAN.md          # this file
  web/
    index.html  package.json  vite.config.ts  tailwind.config.js
    public/
      manifest.webmanifest
      icons/
      CNAME
    src/
      main.tsx  App.tsx
      components/
        QuestionCard.tsx  OptionButton.tsx  Timer.tsx  SolutionPanel.tsx
        Dashboard.tsx  SessionSetup.tsx  JumpDrawer.tsx
        ReviewWrong.tsx  Analytics.tsx  Settings.tsx  TopicMap.tsx
      lib/
        storage.ts   # IndexedDB wrapper
        srs.ts       # SM-2 scheduler
        progress.ts  # aggregate stats
        queue.ts     # builds a session queue from a scope
        sync.ts      # pull-on-open / push-on-close (§7)
        search.ts    # search index + query fn (§6)
      hooks/
        useTimer.ts  useProgress.ts  useSessionQueue.ts
      styles/
        globals.css
  .github/
    workflows/
      deploy.yml
```

---

## 10. Aesthetic direction

- Primary: indigo `#6366F1`. Success green, danger red, warning amber — minimal accent
  use beyond these.
- Background: `#F8FAFC` light / `#0F172A` dark. Cards: white / `#1E293B`,
  `rounded-2xl`, `shadow-sm`.
- Icons: `lucide-react`. Skeleton loaders, not spinners. Visible keyboard focus rings.
- Reference feel: Duolingo's card layout (academic, not playful), Linear's typography
  discipline, Notion's whitespace. No skeuomorphism, no gradients everywhere, no emoji
  overload.

---

## 11. Decided defaults (from earlier open questions)

- **Skip semantics:** skip requeues the question to the end of the current session by
  default. A Session Setup toggle ("Skip drops question from session") can change this
  per session.
- **Search ranking:** v1 is filtered-only, sorted by `id`. Ranking (weight `topic`/
  `loText` highest) is a possible later enhancement, not required for launch.
- **Timer:** circular ring by default, 2 min/question, auto-submits as wrong at 0,
  collapses to compact inline mode on long/table questions (§5).
- **Theme:** system preference by default, manual override available.
- **Haptics:** on by default on mobile, off on desktop; toggle in Settings.
