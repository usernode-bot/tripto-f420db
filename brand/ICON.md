# Tripto app icon

The home-screen tile icon, committed as `brand/icon.png` and declared in
`dapp.json`'s top-level `icon` block (`image` wins; the `🧳` emoji stays as
the fallback). 512 × 512 PNG, opaque, full bleed, square corners.

## Glyph

Lucide **`map-pin`** (ISC licence) — Tripto is a journal of places visited.
White line glyph on Lucide's 24-unit grid, `stroke-width="2"`, round caps
and joins, `fill="none"`, scaled × 12 into the middle 288 px
(`translate(112 112) scale(12)`, i.e. 112 px of margin on each side).

## Colour

Diagonal two-stop gradient, top left to bottom right, from the platform
icon palette's red row ("red: places"), which also echoes the app's airmail
red:

- `#FF7163` (top left) → `#D1321F` (bottom right)

Under a faint white radial gloss at the top left
(`cx 0.25, cy 0.12, r 0.8`, white at 0.22 opacity fading to 0).

## Shadow

Soft drop shadow on the **outer, unscaled** group only:
`feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000" flood-opacity="0.22"`.
On a scaled group the offset and blur are multiplied by 12 and leave a
visible box on the tile.

## Source SVG

```svg
<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FF7163"/><stop offset="1" stop-color="#D1321F"/>
    </linearGradient>
    <radialGradient id="gloss" cx="0.25" cy="0.12" r="0.8">
      <stop offset="0" stop-color="#fff" stop-opacity="0.22"/>
      <stop offset="1" stop-color="#fff" stop-opacity="0"/>
    </radialGradient>
    <filter id="shadow" filterUnits="userSpaceOnUse" x="0" y="0" width="512" height="512">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#000" flood-opacity="0.22"/>
    </filter>
  </defs>
  <rect width="512" height="512" fill="url(#bg)"/>
  <rect width="512" height="512" fill="url(#gloss)"/>
  <g filter="url(#shadow)">
    <g transform="translate(112 112) scale(12)" fill="none" stroke="#fff"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/>
      <circle cx="12" cy="10" r="3"/>
    </g>
  </g>
</svg>
```

## Render command

```sh
rsvg-convert -w 512 -h 512 icon.svg -o brand/icon.png
```

(`rsvg-convert` was not in the build sandbox; the committed PNG was rendered
with `npx @resvg/resvg-js-cli icon.svg icon.png` as a one-off.)

## Favicon

The browser-tab favicon in `public/index.html` is the simplified twin of
this icon: the same map-pin glyph on a flat `#E0472F` (the gradient's
midpoint) filling the whole square, stroke 2.5 instead of 2, no gradient,
gloss or shadow — those disappear at 16 px. It is a URL-encoded SVG data
URL, so it cannot read the app's CSS colour tokens; the colour is the icon
set's, not app UI.