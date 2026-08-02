# fixa

Marketing site for fixa, an autonomous repair engine for production systems.
Static pages — no build step, no framework, no external requests.

```
index.html          landing page
login.html          sign-in — providers disabled, waitlist live
assets/
  css/fixa.css      tokens first, then components
  js/hero-gl.js     the hero render (WebGL2, no dependencies)
  js/site.js        shared: menu, replay, pricing, theme, reveals
  js/login.js       waitlist validation and persistence
```

Open `index.html` directly, or serve the directory:

```
python3 -m http.server 8000
```

## What actually works

Nothing on either page is a painted-on control.

| Control | Behaviour |
| --- | --- |
| Mobile menu | Opens under 900px, closes on Escape, on link activation, and when the viewport crosses back over the breakpoint |
| Incident replay | Steps carry their real offsets (0–252s) and play at 28×, so the pacing between stages is the true one. Play / pause / resume / replay, a progress bar, a running clock, a status pill that moves fault → repairing → resolved, and the diff appearing on the PATCH step. Autoplays once on first view; pauses when the tab is hidden |
| "Watch a repair" | Jumps to the player *and* restarts it |
| Billing toggle | Recomputes every price from `data-monthly` / `data-annual` and rewrites the billing note |
| FAQ | Native `<details>`, so it works with scripting off |
| Copy button | Clipboard API with a selection fallback for non-secure contexts |
| Scrollspy | Marks the nav link for the topmost visible section |
| Waitlist | Validates format, rejects personal-mail domains, assigns a stable queue position derived from the address, and persists in `localStorage` so a return visit shows your place |

Sign-in is deliberately closed. Every identity provider on `login.html` is
rendered and disabled behind an at-capacity notice — the UI is there, the door
isn't open. `saveEntry()` in `login.js` is the single seam to replace with a
`fetch()` when a backend exists.

## The hero

The object renders the product's own claim. A gaussian **break wave** travels
across a faceted solid; the shards it catches lift along their face normals and
rotate, opening seams onto a hot core. Behind the wave everything closes again
and the seams cool from amber back to mint. Fault and repair are the two states,
and they are the only two colors the page uses with any force.

- A 320-face geosphere is exploded per face, so each triangle carries its own
  centroid, normal, barycentric coordinates and a stable seed
- Core, shell and drift points render to a scene FBO, then a bright pass, a
  separable blur at quarter resolution, and a composite pass adding bloom,
  chromatic aberration, vignette and dither
- No library. Matrix math and geometry generation are both in `hero-gl.js`

The headline resolves out of scrambled glyphs on load. Per-character spans would
otherwise let a word break mid-word, so each word is wrapped in a `nowrap` span
and only the spaces between them are break opportunities.

## Theming

Every color comes from a custom property on `:root`. Dark is the default. Light
is a separately designed "lab bench" counterpart, not an inversion.

The shader reads the same tokens, and JS re-reads them whenever the theme
changes, so **editing the CSS moves the 3D with it.**

| Token | Role |
| --- | --- |
| `--gl-bg` / `--gl-shell` | Background, and the base color of the shards |
| `--gl-ok` / `--gl-warn` | Repaired (mint) / faulted (amber) |
| `--gl-emis` | Emissive scale for seams, rim, core and drift |
| `--gl-amb` | Ambient floor on the shard facets |
| `--gl-bloom` / `--gl-vig` | Bloom amount, vignette strength |

## Fallbacks

- **No WebGL2** — the canvas never turns on and the CSS gradient stage stays
- **No JavaScript** — scroll reveals hide nothing, because the hidden state is
  scoped to a `.js` class set at parse time
- **`prefers-reduced-motion`** — one composed still frame instead of a loop
- The render loop stops when the tab is hidden or the hero leaves the viewport,
  and device pixel ratio is capped at 1.75

## Changing things

- **Copy** lives in `index.html`
- **Color** is the token block at the top of `assets/css/fixa.css`; both the dark
  and light sets need editing
- **Shard density** is `shellMesh(2, 1.0)` in `hero-gl.js` — 3 gives 1,280 faces
- **The break wave** is `breakAt()`: the exponent sets the band width,
  `fract(time * 0.115)` sets its speed
- **Object placement** is `shiftX` / `shiftY` / `dist` in `drawScene()`
- **Replay pacing** is `SPAN` and `RATE` in `site.js`; each step's `data-at` is
  its offset in incident seconds
- **Queue size** is `QUEUE_BASE` in `login.js`

Metrics, customer names, pricing and the incident record are illustrative
content for the page, not real operating data.
