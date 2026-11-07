---
name: Crowd Control — people in motion
description: Bright, human crowd planning through everyday words and illustrated worlds.
colors:
  paper: "#faf9f6"
  ink: "#214b3b"
  green: "#195c3e"
  green-hover: "#265e3d"
  muted: "#667362"
  line: "#e1e6db"
  blue: "#597dab"
  rose: "#ab647c"
  white: "#ffffff"
  workbench: "#f5f7ee"
  sidebar: "#f9faf5"
  selected: "#e5eddb"
  selected-ink: "#345d3c"
  subtle: "#e7efdf"
  subtle-ink: "#3f6248"
typography:
  display:
    fontFamily: "Manrope, sans-serif"
    fontSize: "clamp(38px, 4.1vw, 63px)"
    fontWeight: 500
    lineHeight: 1.16
    letterSpacing: "-0.04em"
  headline:
    fontFamily: "Manrope, sans-serif"
    fontSize: "clamp(30px, 3vw, 43px)"
    fontWeight: 500
    lineHeight: 1.16
    letterSpacing: "-0.04em"
  body:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "14px"
    lineHeight: 1.8
  label:
    fontFamily: "DM Sans, sans-serif"
    fontSize: "13px"
    fontWeight: 500
rounded:
  control: "4px"
  button: "6px"
  tab: "7px"
  symbol: "11px"
  workbench: "13px"
spacing:
  inline: "12px"
  control: "20px"
  section-gutter: "30px"
components:
  button-primary:
    backgroundColor: "{colors.green}"
    textColor: "{colors.white}"
    rounded: "{rounded.button}"
    padding: "13px 20px"
    height: "47px"
  button-primary-hover:
    backgroundColor: "{colors.green-hover}"
  button-subtle:
    backgroundColor: "{colors.subtle}"
    textColor: "{colors.subtle-ink}"
    rounded: "{rounded.button}"
    padding: "13px 20px"
  scenario-tab-selected:
    backgroundColor: "{colors.selected}"
    textColor: "{colors.selected-ink}"
    rounded: "{rounded.tab}"
    padding: "17px 13px"
  workbench:
    backgroundColor: "{colors.workbench}"
    rounded: "{rounded.workbench}"
---

# Design System: Crowd Control

## Overview

**Creative North Star: "People in motion"**

Bright, calm, and human. A sunlit miniature campus brings nature and school architecture together; code-rendered people make the world feel inhabited. White and off-white space gives the story room to breathe, with green leading and blue and rose supporting it.

The interface explains natural-language planning in everyday words. Illustrated motion connects the landscape, narrative, and scenario previews; controls remain clear and restrained. This replaces the previous dark blueprint and staggered-departure experiment.

**Key Characteristics:**
- Light paper surfaces and natural green accents.
- Soft architectural imagery with recognizable human figures.
- Spacious narrative typography and compact, practical controls.
- Ambient motion with reduced-motion behavior; scenario playback controls.

## Colors

### Primary

Green carries primary actions, highlighted headline text, focus outlines, and selected-state emphasis. Its deeper hover shade preserves the same natural character.

### Secondary

Blue supports narrative symbols and clothing accents.

### Tertiary

Rose supports narrative symbols and clothing accents, with related rose tones marking closed exits in illustrative scenes.

### Neutral

Paper is the page background; ink is the main text color. Muted text and fine dividers provide hierarchy. The workbench and sidebar use pale green-tinted surfaces, while selected tabs have a stronger tonal fill. White text belongs on filled green actions.

**The Green Leads Rule.** Green is the primary interactive accent; blue and rose remain supporting colors.

## Typography

Manrope is the display face; DM Sans handles body text and controls. Both currently load from Google Fonts with sans-serif fallbacks. Headings use medium weight and close tracking, while body copy stays open and readable.

The hero display uses the frontmatter display role. Narrative headings use the headline role. Scenario headings scale to `clamp(34px, 3.6vw, 49px)`, while the closing heading scales to `clamp(35px, 4vw, 53px)`. Narrative paragraphs are constrained to about 40 characters per line. Compact status labels supplement the main explanation rather than carrying it.

## Layout

The story and scenario section share a maximum width of 1240px. A compact headline, supporting line, and single CTA sit above the campus panorama, with a small brand mark at upper left. Three alternating story stops follow around a flowing crowd path and a short falling-people handoff.

The desktop workbench uses a 290px sidebar and a flexible preview; below 1000px the sidebar becomes 230px. Below 700px the compact header shrinks, story copy stays left of the crowd path, and scenario choices become a two-column grid above the preview. Preview heights step from 480px to 430px to 310px. The handoff shortens from 220px to 150px on mobile.

## Elevation & Depth

Interface surfaces are flat, separated by pale tonal fills and single fine borders. There are no interface box shadows. The SVG campus uses flat contrasting polygon faces for depth; do not add raster lighting, soft shadows, or floating interface cards.

## Shapes

Buttons have gently curved corners, tabs slightly softer corners, and the workbench the largest enclosing radius. Fine borders, small rounded status dots, and simple human silhouettes keep controls distinct from the flowing landscape.

## Components

### Buttons

Filled green actions use white text and a deeper green hover. Subtle actions use pale green and darker green text. Buttons use the frontmatter padding and radius, with smaller variants in navigation and the what-if row. Focus-visible outlines are green, 2px wide, and offset 5px. Disabled controls lower opacity and use the default cursor.

### Navigation

A small wordmark sits unobtrusively at the upper left. The opening headline, supporting sentence, and one green demo CTA form a centered group. The CTA uses a pill shape following the latest supplied reference; there is no boxed brand/demo bar or section-link menu. A skip link appears on focus. Header dimensions and type shrink on mobile while the brand and CTA remain.

### Scenario Workbench

A single bordered container holds scenario tabs, state text, pause/reset controls, and an illustrated canvas. The four tabs select School, Concert, Check-in, and Alley previews; their displayed titles are “The school day,” “The encore,” “The first hello,” and “The narrow street.” Selection uses a pale green fill. Hover shows affordance without changing selection. Arrow keys, Home, and End move selection and focus. The what-if action toggles a reversible scripted change; reset restores the original setup.

### Ambient Crowd

Human figures have heads, torsos, arms, and walking legs. The hero bottom strip and its ambient pause control have been removed at the user’s request. Scenario playback retains its own pause control. Canvas motion advances independently of scrolling and pauses offscreen or when the document is hidden. Reduced motion renders static scenes, disables playback controls, removes transitions, and uses immediate anchor scrolling.

### Imagery

The active campus is the native SVG component `web/src/components/CampusScene.tsx`, composed of editable polygons, paths, and simple reusable geometric objects. No raster is embedded or requested by the hero. Previous generated artwork and provenance are archived locally in `.impeccable/archive/campus-rasters/`. People remain animated canvas figures over the SVG. Previews are explicitly illustrative; no live AI or engine is connected to this landing page.

## Do's and Don'ts

### Do:
- Do use light paper surfaces, green primary actions, and blue and rose as supporting accents.
- Do keep human figures recognizable and scenario controls operable by keyboard.
- Do preserve scenario playback controls, reduced motion, and offscreen animation suspension.
- Do label scripted previews honestly and preserve the planning-estimates disclaimer.

### Don't:
- Don't reintroduce the replaced dark blueprint visual direction.
- Don't present scripted illustrations as live AI or engine output.
- Don't add invented safety statistics, performance improvements, or customer proof.

## Reference-led SVG opening

The latest supplied campus reference governs the composition: a compact centered headline, one supporting sentence, one action, then a larger park-and-school panorama. The approved headline is “Simulate Any Crowd.” with “Crowd.” in green. The subheading is “Describe a scenario. See what happens.” The brand is secondary at the upper left. On mobile, headline words share the same responsive size; the full campus is framed rather than cropped.

The campus remains native SVG geometry: cuboid trees, faceted lawns, stepped seating with a separate flat landing, cream school architecture, pale blue windows, a pond, a small wooden footbridge, and simple benches and planters. The pond sits outside all mapped pedestrian routes. No raster assets, filters, or painted textures are used. Desktop campusFrame.ts uses bottom-aligned slice framing; mobile uses meet framing with the matching canvas scale. Human figures have a minimum screen-space size so they remain visible in the mobile overview.

## Campus motion

Walkers follow seeded routes with varied speeds, pairs, and short pauses across the courtyard, entry approach, garden path, and flat amphitheatre landing. The risers are excluded from navigation. Gentle bounded separation reduces overlap; offsets are checked against mapped walkable regions. Doorway arrivals fade and re-emerge rather than crossing the facade. This is ambient choreography, not live engine output.

## Connected trail

The hero contains no bottom caption, follow prompt, or motion strip. The headline, supporting line, and CTA occupy the first grid row. The SVG campus fills the remaining space; mobile uses a compact full-campus overview. The hero is capped at 900px on tall desktops to avoid excessive empty space.

Journey.tsx measures the campus and story inside one wrapper. journeyGeometry.ts builds one native SVG Bézier path running from the courtyard through the narrative to the falling landing. The campus/story boundary shares matching vertical tangent handles; the road has one uniform cream stroke, 86px desktop / 48px mobile. There are no independent road caps or section margins at the join.

Walkers use the same arc-length samples, screen-space size, identity, spacing, and shared animation clock on both sides of the boundary. Campus and story canvases render the relevant clipped portion of that stream, so a person continues across the boundary without being replaced. Local courtyard choreography remains independent. The narrative trail ends vertically at its exact center and continues onto a 55px landing before the falling animation. Mobile turns stay below the final text.

## Reference palette and living sky

Palette matches the visible reference direction: warm white #faf9f6, forest ink #214b3b, deep green actions #195c3e, leaf emphasis #2c8b4f, lime lawns #c8df98, pale water #aed6df, and powder blue clouds #d4e5ed, with blush accents. These are visually matched values; pixel-exact source colors were not available from the inline screenshot. Text and action colors retain readable contrast.

SkySimulation.tsx renders six independently drifting cloud clusters and nine birds in small side flocks. Birds use cohesion, alignment, separation, boundary steering, and phased wingbeats. Clouds drift with differing wind rates. Motion stays away from the central copy, pauses offscreen or when hidden, and renders a static sky for prefers-reduced-motion. The sky is native SVG, decorative, and separate from the live simulation engine.


### Campus reference refinement

The supplied park reference now governs the landscape arrangement as well as the palette. The opening uses a larger centered headline and supporting sentence over a low panorama: pond and arched timber bridge at left, amphitheatre behind it, open pedestrian courtyard in the middle, and warm cream classrooms with blue glazing on the right. Rolling lawn contours, faceted shrubs, small stones and lamps frame the paved routes. Tree canopies remain block-shaped and all artwork remains native SVG. The campus and story retain one continuous cream road and shared pedestrian coordinates.

The scene uses warm white `#fbfaf8`, cream paving `#fcf2e5`, yellow-green lawns `#d5e7a6` / `#c2df8a`, lime crowns `#d8e99d`, leafy shaded faces `#91b959` / `#719c48`, pond blue `#92cee0`, glass blue `#96cee7`, and warm classroom floors `#f6ebdb`. These are a visual match to the inline reference rather than sampled source pixels. The previous cool, flat lawn slabs are superseded by this park composition.

### Typography entrances

Hero, story-stop, scenario-introduction, and closing copy use a restrained, one-time fade and rise. Headings move 16px over 680ms; supporting copy moves 12px over 560ms, starting 140ms later with 75ms increments capped at 340ms. Natural deceleration uses `cubic-bezier(0.16, 1, 0.3, 1)`. IntersectionObserver triggers at 80% viewport height; the native Web Animations API preserves text nodes, wrapping, and layout. Completed effects are removed. No GSAP dependency or scroll listener is added. Reduced motion, printing, keyboard focus, and unsupported/failed initialization expose original visible content immediately. There is no CSS-hidden default state.


### Environmental story: a connected campus, transit stop, and garden

The current art-direction brief prioritizes a believable miniature world over oversized architecture. The hero and the original journeyGeometry.ts strip remain unchanged. Shared ground, branch connections, native SVG scenery, and the existing text-entrance system are reused.

The campus retains its cream building and facade headline, scaled to 82% within a larger forecourt so benches, planting and residents have room. Supporting copy forms an editorial column beside a properly framed, two-post scenario kiosk; people gather near the kiosk and entrance. The transit location replaces the large roof/facade with a smaller freestanding station display and a transparent waiting shelter. Its original process steps sit on directional signs along a shared support post. The garden removes the roof and glass building entirely: a low landscaped headline wall overlooks a pond and two cream routes that split, cross the scenic footbridge or take the direct way, and rejoin. Route geometry is shared by the SVG paths and local walking animation. Bridge coverage is checked against the pond fill.

Headlines and copy remain selectable HTML with unchanged wording. Supporting paragraphs are 17px / 1.7 on desktop and 15px / 1.7 on mobile. Desktop campus copy and kiosk sit alongside one another; narrow layouts stack them. Body copy is never skewed or perspective-transformed. The station display has a shallower desktop face and a taller mobile face to accommodate responsive wrapping. The main structural materials remain cream, muted pastel green, forest-green lettering, pale pond water, and timber details, without heavy outlines or decorative shadows.

The original crowd stream now travels as deterministic pairs, small groups, and singles with uneven gaps, modest lane variation relative to the path tangent, and bounded changes in walking speed. All regions use the same shared clock and coordinates at the campus/story seam. Bounded speed variation keeps group order stable over time. Local residents wait near entrances, benches and information displays; the garden walkers visibly use both branches. Reduced motion freezes the scene, while offscreen and hidden-document rendering behavior continues through useCanvas.

Desktop story height is 2480px; mobile is 2250px. Distant ambient building blocks are omitted on mobile where they would sit behind the larger body copy. The original continuous path, its walking people, hero, scenario explorer, and existing scroll functionality are preserved.


### Correction: embedded copy and a clearly continuous route

The latest user correction supersedes the open editorial-body placement. Every story paragraph is now inside an EnvironmentalDisplay: a glazed-canopy campus shelter, a green station information display, or a timber garden information sign. The unchanged example prompt remains in its own campus kiosk, and process steps remain inside the station display. All copy remains selectable, level HTML with the established entrance animations and readable type sizes. The distinct architectural headline scenes and local residents remain intact.

Journey now measures the actual embedded-copy footprints as well as the illustrations. Shared terraces extend under the full information objects and their supports. Neutral plaza paving `#f2efe5` separates the forecourts from the original cream pedestrian strip. The original route geometry and walkers remain; a subtle 2.5px planted paving edge makes the strip visibly continuous through the larger plazas. The approach strips remain connected.

Desktop story height is 2580px, tablet 2480px, and mobile 2850px to fit physical information structures without text-path overlap. Supporting paragraphs remain 17px desktop, 16px tablet, 15px mobile. SVG roofs and supports size independently from the HTML text faces. The hero, scenario explorer and existing wording are unchanged.


### One route from the opening campus to the downward transition

The user's connected-path clarification refers to the entire opening-campus → story → downward-handoff route. Journey now wraps all three regions. The original courtyard-to-story curves remain unchanged; one final vertical segment extends the same native SVG path 55px onto the downward ledge. The separate CSS landing strip is removed. FallingCrowd uses the same deterministic pedestrian model, identities, lanes, and global clock as CampusCrowd and StoryCrowd. Beyond the ledge, those same people accelerate downward and spread gently instead of being replaced by a separate looping crowd. Embedded text structures remain intact. The landing canvas sits above its paving; reduced motion renders a static snapshot.


### Alignment and material refinement

The signs retain all embedded copy and the existing layouts, with thinner front borders, slimmer station header rails, reduced canopy edge thickness, and explicit shaded return faces behind the HTML panels and scenario kiosk. These native SVG side faces give depth without perspective-transforming text. Kiosk posts and nearby people meet at the same ground level. Local walking routes now pass below bench seats; waiting residents stand in front of seating, and the garden bench is moved clear of the direct branch.

CityScenery no longer draws separate rectangular land slabs. Distant buildings share the existing ground with small contact shadows and access lanes that join the main walkway. The SVG uses the actual story dimensions with uniformly scaled objects, keeping isometric proportions instead of vertically stretching a fixed backdrop. Route-aware placement preserves space for the full building and streetlight bounds, and all objects remain inset from the viewport edges. The connected route, embedded text, wording, and responsive type sizes are unchanged.


### Rebuilt sign assemblies

The latest sign correction replaces the detached canopy, separate CSS side-strip, and decorative miniature bench arrangement. EnvironmentalDisplay measures the HTML content box and draws a single native SVG assembly using those pixel dimensions. Front face, flush cap, shaded return, posts and footings share vertices. The face has a restrained isometric rise of at most 20px across its width; HTML paragraphs and process labels remain level and untransformed. The three material variants retain their cream/green/timber palettes. Supports attach to the actual angled lower edge and cast a matching ground shadow. Text-fit checks verify real paragraph, list and link bounds inside each front face at desktop, tablet and mobile widths. The separate scenario kiosk, other scene architecture, wording, and continuous path remain intact.


### Text follows the sign vector

The latest user request changes the first building headline to “Big Possibilities. Little Effort.” and explicitly aligns text with each sign face, superseding the earlier level-baseline constraint. EnvironmentalDisplay applies the exact face mapping to its HTML content: x stays unchanged and y follows `tilt / 2 - tilt * x / width`. ResizeObserver reads untransformed border-box dimensions so this projection cannot feed back into frame height. Building headlines use inner text-plane wrappers with face-specific shear: campus -35/439, station -28/329, garden -3/378. Existing entrance animation stays on the outer heading, preserving the angle throughout the reveal. The flat example kiosk remains horizontal to match its own rectangular face. Text remains selectable HTML, and character-fit checks cover 320, 390, 820, 1440 and 1676px widths. The hero, connected path and other wording remain unchanged.


### Example-board corner and shelter layering repair

The small example board now uses EnvironmentalDisplay's joined native SVG frame with an `example` material variant. Its face stays horizontal, preserving the approved prompt layout, while the cap, return, frame and supports meet at shared vertices. The old rounded CSS border, separate side strip and pseudo-element posts are removed. Its pale-green palette and wording remain unchanged.

The transit shelter's glazing and supports now share the roof underside geometry: the front edge descends from (484,209) to (659,178), and the left side meets (405,184.422). Glazing and posts are drawn before the roof, and all ground paving lines are drawn before benches and planters. The roof occludes support joins; raised furniture occludes paving. Waiting residents stand in front of the shelter base rather than on the seat/glass edges. Connected paths, text-plane angles and copy are unchanged.
