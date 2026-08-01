# fixa

Marketing site for fixa, an autonomous repair engine for production systems.
Static pages — no build step, no framework, no external requests.

```
index.html
assets/
  css/fixa.css      tokens first, then components
  js/hero-gl.js     the hero render (WebGL2, no dependencies)
  js/site.js        headline reveal, scroll reveals, theme, live figures
```

Open `index.html` directly, or serve the directory:

```
python3 -m http.server 8000
```

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

Metrics, customer names and the incident record are illustrative content for the
page, not real operating data.
