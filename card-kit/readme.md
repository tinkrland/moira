# moira card kit

the "make your own" preview lifted from the intake app (the zite site), near
verbatim: this code was good, so we kept it. only the site scaffolding was
stripped - react-router, sonner toasts, and the app layout wrapper - and
every seam is marked with a `(kit:` comment so a host can rewire them.

## what's here

| file | from | what it is |
| --- | --- | --- |
| `builder.tsx` | `src/pages/BuilderPage.tsx` | the whole make-your-own flow: `MoiraCardBuilder` (3d flip card - perspective 1400, rotateY flip, pointer tilt + spotlight + noise grain), `MindmapPreview` (radial sections map - categories -> subtypes -> sub-subs, dashed edges, spring camera panning, collapses on flip), template picker (knowledge, media, taste, lifestyle, people, ongoing, techstack), profile editor, editor-key step, icon context menus, localStorage persistence (`intake-card-v1`, `moira-profile`) |
| `preview.tsx` | `src/pages/PreviewPage.tsx` | the share/preview view: its own `MoiraCard` variant plus a slug-keyed tree mindmap (`buildTree`, center + NODE layout) |

## data model

```ts
type Sub = { id, label, iconName, children? }        // a section item (subtypes nest)
type Cat = { id, label, iconName, accent, subtypes } // a top-level section, accent p1..p5
type CardData = { front: Cat[], back: Cat[] }        // the card's two faces
```

the shape maps one-to-one onto moira personas: sections are context
categories, subtypes are the vocabulary a persona fills in. the future moira
frontend binds this ui to real persona facts instead of localStorage - swap
`loadCardData`/`saveCardData` for the api client and the rest stands.

## deps

react 18+, framer-motion, lucide-react (see package.json). that's it.

## honest status

lifted, seam-marked, and reviewed line by line - but not compiled here (no
typescript toolchain in the backend sandbox). a host app should run its own
`tsc --noEmit` over the kit on first import. the zite originals remain the
reference implementation.
