---
name: Chess Trainer
description: Your chess, read from your own Lichess games, printed like the sports pages.
colors:
  paper: "#e6dfd1"
  paper-panel: "#efe8db"
  paper-raised: "#ded5c3"
  paper-line: "#d3c8b3"
  ink: "#141414"
  ink-muted: "#62594c"
  signal-orange: "#ff5a1f"
  signal-orange-text: "#9c330a"
  result-green: "#226039"
  result-red: "#b42318"
  hint-gold: "#e0b23a"
  night-paper: "#12100e"
  night-panel: "#1b1815"
  night-raised: "#26221e"
  night-line: "#2e2a25"
  night-ink: "#f4efe6"
  night-muted: "#a8a093"
  night-orange: "#ff6a2f"
  night-orange-text: "#ff7a45"
typography:
  display:
    fontFamily: "Anton, Impact, sans-serif"
    fontSize: "clamp(3.4rem, 9vw, 6rem)"
    fontWeight: 400
    lineHeight: 0.92
    letterSpacing: "0em"
  headline:
    fontFamily: "Anton, Impact, sans-serif"
    fontSize: "clamp(2.6rem, 7vw, 4.6rem)"
    fontWeight: 400
    lineHeight: 0.95
  title:
    fontFamily: "Anton, Impact, sans-serif"
    fontSize: "22px"
    fontWeight: 400
    lineHeight: 1.1
  stat:
    fontFamily: "Anton, Impact, sans-serif"
    fontSize: "34px"
    fontWeight: 400
    lineHeight: 1
  body:
    fontFamily: "Geist, Inter, system-ui, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, Inter, system-ui, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    letterSpacing: "0.16em"
  mono:
    fontFamily: "Geist Mono, ui-monospace, Menlo, monospace"
    fontSize: "13px"
    fontWeight: 400
rounded:
  sm: "2px"
  md: "4px"
  control: "8px"
  pill: "99px"
spacing:
  tight: "8px"
  group: "12px"
  section: "24px"
  gutter: "clamp(16px, 4vw, 56px)"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper-panel}"
    rounded: "{rounded.md}"
    padding: "10px 18px"
  button-ghost:
    backgroundColor: "{colors.paper-panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "9px 16px"
  segment-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.paper-panel}"
    rounded: "{rounded.sm}"
    padding: "7px 14px"
  panel:
    backgroundColor: "{colors.paper-panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.md}"
    padding: "24px"
  player-card:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.night-ink}"
    rounded: "{rounded.md}"
    padding: "20px"
    width: "300px"
  input:
    backgroundColor: "{colors.paper-panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 12px"
  chip:
    backgroundColor: "{colors.paper-raised}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "1px 8px"
---

# Design System: Chess Trainer

## Overview

**Creative North Star: "The Sports Pages"**

The site reads like the sports section of a newspaper about one player: you. Headlines are set big and condensed, numbers are the stars, and every panel sits under a thick black rule, the way a sports page separates its stories. A player card in the style of a collector's card carries the overall, the player type and the six skills; the rest of the page reads it out as stats, a portrait in words and a list of games.

The mood is cocky but clear. The poster type and the big numbers give it swagger; the body text, the labels and the tables stay calm, readable and plain, so the swagger never costs comprehension. Density is that of a stats page: lots of numbers, each with its label, nothing decorative that does not carry information. The chess board itself keeps Lichess's familiar brown board and cburnett pieces, so the game always looks like the game players know.

There is a light edition on warm newsprint and a dark edition (the default for most players) on near-black paper; they are the same paper with ink and stock swapped, never two designs.

**Key Characteristics:**
- Anton poster type for headlines, player types and every big number; Geist for everything you read.
- Warm newsprint (or night paper), ink, and one signal orange.
- A heavy rule across the top of each panel instead of boxes and shadows.
- Stats with labels: small uppercase tracked labels over large condensed numbers.
- Green and red only ever mean won/right and lost/wrong.

## Colors

Warm, low-chroma newsprint with ink, and a single loud orange that marks what you are working on.

### Primary
- **Signal Orange** (signal-orange): the one accent. Skill bars, the overall on the player card, the rating line, progress, the current section under the nav. In the dark edition it becomes **Night Orange** (night-orange).
- **Readable Orange** (signal-orange-text): the same orange darkened for text on paper: kickers, links, "Train next" headings, the Starred state. Use it whenever orange is text; use Signal Orange for marks and fills.

### Neutral
- **Newsprint** (paper): the page. Warm, slightly grey, never white.
- **Clean Sheet** (paper-panel): panels, inputs, ghost buttons; one step lighter than the page.
- **Pressed Sheet** (paper-raised): selected tabs, train-it boxes, tags, hover fills.
- **Column Rule** (paper-line): hairlines, input borders, table rows.
- **Ink** (ink): text, the heavy panel rule, primary buttons, the player card's stock in the light edition.
- **Faded Ink** (ink-muted): labels, dates, secondary text.
- **Night Paper / Night Panel / Night Raised / Night Line / Night Ink / Night Muted**: the dark edition's equivalents. In dark, the player card turns to Night Ink stock with dark type, and its rule and primary buttons turn light.

### Semantic
- **Result Green** (result-green) and **Result Red** (result-red): won/lost, right/wrong, strengths/weaknesses, highs/lows. Brighter variants in dark.
- **Hint Gold** (hint-gold): mistakes in the game review and inaccuracy marks.

### Named Rules
**The One Signal Rule.** Orange is the only accent. Anything orange is either what you are working on or a link; nothing is orange for decoration.

**The Results Only Rule.** Green and red are reserved for won/lost and right/wrong, always with a label, number or letter (W, L, D) beside them; they never colour a series or a brand element.

**The No White Rule.** Paper is never pure white and night paper is never pure black; the warmth is the newsprint.

## Typography

**Display Font:** Anton (with Impact, sans-serif)
**Body Font:** Geist (with Inter, system-ui)
**Label/Mono Font:** Geist Mono, for move lists, codes and the eco/move notation

**Character:** A condensed poster face that shouts the headline and the number, paired with a quiet, modern sans that explains it.

### Hierarchy
- **Display** (Anton 400, clamp(3.4rem, 9vw, 6rem), 0.92, uppercase): the player type on the profile, page titles like PRACTISE OPENINGS.
- **Headline** (Anton 400, clamp(2.6rem, 7vw, 4.6rem), 0.95, uppercase): page headlines on lists and plans.
- **Title** (Anton 400, 22–26px, uppercase): opening card names, plan steps, player names on cards.
- **Stat** (Anton 400, 20–72px, line-height 1): every big number: overall, skills, KPIs, ratings, high/low.
- **Body** (Geist 400, 16px, 1.5, up to 64–80ch): explanations, portraits, coach text.
- **Label** (Geist 600, 11–12px, 0.14–0.2em tracking, uppercase): panel headings (SKILLS, RATING), stat labels, kickers.

### Named Rules
**The Number Leads Rule.** A stat is a large Anton number with a small uppercase label; never a sentence where a number and label will do, and never a number without its label.

**The Shout Once Rule.** One display line per view. Everything under it is body or label, so the headline keeps its weight.

## Layout

Single column of full-width panels inside a centred page (max about 1080px on the profile, a board-plus-panel grid in the trainer), with the side gutter at clamp(16px, 4vw, 56px). Panels stack with 12–18px between them. Two-up grids (Strengths / Train next, Openings as White / Black) use repeat(auto-fit, minmax(320px, 1fr)) and fall to one column on phones. Stats sit in auto-fit grids of equal tiles (KPIs, the six skills as 3 × 2, 2 × 3 on tablets, one column on phones).

The header carries the brand, the five sections, Find a player and the starred-players menu; below 1360px the links and the search share a second row, and on phones the links scroll sideways on one row. Nothing ever scrolls the page sideways.

### Named Rules
**The Even Grid Rule.** Repeated items (skills, stats, cards) are equal tiles in a grid, never a ragged list; explanations open from one button rather than making tiles uneven.

## Elevation & Depth

Flat. Depth comes from paper tone (page, panel, raised) and from the heavy rule on top of each panel, not from shadows. The two exceptions are objects that physically sit on the page: the player card casts one soft drop shadow, and dropdowns and popovers (the ★ menu, the "?" help) cast one to float over content.

### Shadow Vocabulary
- **Card on the table** (`box-shadow: 0 22px 44px rgb(20 20 20 / .25)`): the player card only.
- **Floating menu** (`box-shadow: 0 12px 30px rgb(0 0 0 / .25)`): menus and help popovers.

### Named Rules
**The Rule Not Box Rule.** A panel is defined by its 3px ink rule on top and its paper tone; no outlines around panels, no shadows on panels.

## Shapes

Square-ish and printed. Panels and cards use a 4px radius (barely there), segmented controls 2px, controls and inputs 8px, chips and the starred-player pills fully round. Bars are thin round-ended strokes (6–14px high). The only real geometry is the board's squares and the player card's portrait proportions.

## Components

### Buttons
- **Shape:** printed blocks, 4px radius (8px on ghost controls).
- **Primary:** Ink stock with paper text, bold, 10px 18px (button-primary). In dark the stock turns light.
- **Ghost:** Clean Sheet with a Column Rule border and ink text (button-ghost); hover darkens the border to ink or orange.
- **Link buttons:** Readable Orange text, used for Refresh, Practise their traps, What each one means.

### Segmented controls
- **Style:** a hairline frame with flat options; the selected one is solid ink with paper text (segment-selected). Used for White / Black / Favorites, time controls, periods, compare speeds. Unavailable options are faded and disabled with a reason on hover.

### Panels
- **Corner Style:** 4px.
- **Background:** Clean Sheet (Night Panel in dark).
- **Border:** 3px Ink rule across the top only.
- **Internal Padding:** clamp(16px, 2vw, 24px).
- **Heading:** a Label in Faded Ink (SKILLS, RATING); green or orange for Strengths / Train next.

### Inputs / Fields
- **Style:** Clean Sheet fill, Column Rule border, 8px radius, ink text.
- **Focus:** 2px outline in ink (light in dark), 1px offset.

### Navigation
- **Style:** Geist 500 links in Faded Ink; hover to ink; the current section in ink with a 2px Readable Orange underline. Brand in Anton: CHESS in ink, TRAINER in orange.
- **Mobile:** links on one sideways-scrolling row; search beside the ★ menu.

### Player Card (signature)
The collector's card: 300px wide, Ink stock in light (Night Ink in dark), 4px radius, the one shadow. Overall in Signal Orange Anton top left with the player type under it; the player's most important piece (cburnett, inverted in dark) and their rating in their main time control top right; the name in Anton between two hairlines; six skills as number + three-letter code in two columns; games count at the foot.

### Stat Tiles and Bars
Large Anton number over or beside a tracked uppercase label. Skill bars are thick round strokes in Signal Orange on a Track tone with the value written beside them; in Compare the second player is Faded Ink and each value sits at the end of its bar.

### Chips and Tags
Small pills: style tags in Pressed Sheet with ink text; "Played most" in Signal Orange; result squares W / L / D in green, red or grey with the letter on them.

## Do's and Don'ts

### Do:
- **Do** set every headline, player type and big number in Anton, uppercase, and everything else in Geist.
- **Do** put a 3px ink rule across the top of every panel and keep panels flat.
- **Do** keep orange for what the player is working on and for links, and darken it to Readable Orange when it is text.
- **Do** give every number a label and every colour a word or letter beside it.
- **Do** keep the dark edition as the same paper with ink and stock swapped.
- **Do** keep the board Lichess's brown board with cburnett pieces.

### Don't:
- **Don't** use pure white or pure black backgrounds.
- **Don't** add a second accent colour or use green and red for anything but results.
- **Don't** put shadows or outlines around panels; only the player card and floating menus lift off the page.
- **Don't** go "gamer": no neon, glows, pixel fonts or holographic effects (tried and rejected).
- **Don't** let a long explanation make tiles uneven; hide it behind one button instead.
