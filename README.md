# Mind Record

Voice memory & action assistant — *Don't organize your life. Just talk. AI organizes it for you.*

An Expo (React Native + TypeScript) app for iOS and Android, built from the product plan in
[`design/product-plan.md`](design/product-plan.md) via the Claude Design handoff in [`design/`](design/).

> Formerly *Mindecho* — renamed because a **Mind Echo** already exists on the app stores. The
> design files under `design/` keep the original name; the shipping app is **Mind Record**.

## Status

**All screens and navigation are complete.** The app runs end to end against in-memory
mock content taken from the prototype — there is no backend, no persistence, no real audio
capture or AI yet. See [What isn't built yet](#what-isnt-built-yet).

## Running it

```bash
npm install
npx expo start          # then press i / a, or scan the QR code with Expo Go
```

Other scripts: `npm run typecheck`, `npm run ios`, `npm run android`, `npm run web`.

## Screens

Fourteen screens, matching prototype `1a` in `design/project/Mindecho.dc.html`:

| Route | Screen | Notes |
| --- | --- | --- |
| `/login` | Login | Pastel block header, Apple / Google / Email. App entry point. |
| `/` | Home | Centred 148px mic, stat grid, Upcoming, Continue conversation. |
| `/talk` | Talk / Capture session | Capture vs Conversation mode, live transcript, AI related-memory card. |
| `/summary` | Post-capture summary | Entries + the "needs review" band. |
| `/inbox` | Inbox | Inline review; choices persist for the session. |
| `/calendar` | Calendar | September 2026, per-day conversation dots. |
| `/tasks` | Tasks | Checkboxes, source quotes, Schedule. |
| `/memory` | Memory | Topics, Idea threads, Journal, Rediscover. |
| `/topic` | Topic Memory | Structure `1k`: pinned summary + tag counts + dated timeline. |
| `/thread` | Idea Thread | Subscription Service Idea, Jun 4 → Sep 11. |
| `/journal` | Daily Journal | Auto-generated day summary. |
| `/search` | Ask My Memory | Filters, AI answer, sources, voice input. |
| `/account` | Account | Profile, usage, four preference groups, sign out. |
| `/driving` | Driving Mode | Dark, large targets, "끝." to finish. |

### Navigation

Expo Router. The root stack holds `login`, the `(tabs)` group, and the three full-screen
routes that hide the nav (`talk`, `summary`, `driving`). Bottom nav is the `1l` six-tab bar
— **Home / Calendar / Tasks / Memory / Search / Account** — with Talk removed; recording
starts from the Home mic.

`inbox`, `topic`, `thread` and `journal` live inside `(tabs)` so the bar stays visible, and
borrow a tab's highlight the way the prototype does: Inbox lights up Home, and Topic,
Thread and Journal light up Memory.

## Layout

```
app/                    routes (Expo Router)
  _layout.tsx           root stack, font loading, app state provider
  (tabs)/               the six tabs + the four nav-visible drill-downs
src/
  theme.ts              colours, type ramp, spacing — ported from the design system
  data.ts               prototype content (tasks, inbox, conversations, preferences)
  store.tsx             session state: capture, tasks, inbox, calendar, preferences
  nav.ts                dismiss helper for the full-screen routes
  components/           Screen, BottomNav, Waveform, Icon, ui primitives
design/                 the original Claude Design handoff bundle — read-only reference
```

## Design fidelity

Tokens come from the Modernist design system (`design/project/_ds/…/styles.css`) with the
overrides the user made in the prototype: pastel coral accent `#ef8a80`, warm ground
`#f7f4f2`, Archivo at 400/600/800, 2px section rules, zero corner radius everywhere except
the pastel blocks on Login and Account (14px). UI chrome is English, captured content is
Korean, as specified in the brief.

## What isn't built yet

- Real audio capture, transcription and AI classification — the Talk screen replays a
  scripted transcript on a timer, exactly as the prototype does.
- Backend, sync and persistence — all state is in memory and resets on reload.
- Real authentication — any provider button on Login signs you straight in.
- App icon and splash art are still the Expo defaults.
