# Crowd Control presentation template

A 12-slide, 16:9 template adapted from the landing page: pale grass, cream billboards, forest-green type, maroon and blue accents, winding paths, isometric trees, people, and a cyclist.

## Start here

- Open `crowd-control-template.pptx` in PowerPoint to edit the deck.
- Open `crowd-control-template.potx` to start a new presentation from the template.
- Open `preview.html` in a browser to preview all layouts. Use its presentation link for arrow-key navigation, or print to PDF in landscape with backgrounds enabled.
- `overview.png` shows all 12 layouts together.

Duplicate a suitable slide, replace text in brackets, and delete unused layouts and the guide slide. Artwork, diagrams, and text are native editable PowerPoint shapes. The layouts are sample slides to duplicate, rather than custom Slide Master layouts. Speaker notes contain brief layout instructions.

Install **Manrope** and **DM Sans** for the intended typography. Fonts are not embedded; missing fonts will be substituted by your presentation app. The browser preview loads them from Google Fonts when online. PowerPoint and browser text rendering can differ slightly. The PowerPoint package was structurally validated; the browser previews were visually checked. It has not been rendered in desktop PowerPoint in this environment.

## Layouts

1. Title
2. Roadmap / agenda
3. Billboard section divider
4. Explanation with illustration
5. Two-column explanation
6. Side-by-side comparison
7. Three-step process
8. Results / three metrics
9. Real-world example
10. Demo screenshot or diagram
11. Closing / next step
12. Style guide and reusable illustrations

No example statistics or event claims are supplied. Replace the result placeholders with actual data and add sources to any real-world example.

## Rebuild

The generator is standalone and does not change the app or its dependencies. With Node.js installed:

```bash
npm install --prefix /tmp/crowd-control-deck-tools pptxgenjs
NODE_PATH=/tmp/crowd-control-deck-tools/node_modules node presentation/build.cjs
```

`build.cjs` defines the slide content and artwork. It generates both PowerPoint formats and the HTML preview from the same scene data. The overview PNG is a browser capture, not a PowerPoint render.
