---
name: adhikrish.cloud
description: dark, static reading pages with project readmes.
colors:
  ink: "#080807"
  cream: "#d8d4c8"
  muted: "#8a8a8a"
  hover: "#787878"
  code-surface: "#121210"
  code-border: "#252522"
  selection: "rgba(255, 100, 0, 0.25)"
typography:
  body:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "17px"
    fontWeight: 380
    lineHeight: 1.6
    letterSpacing: "-0.012em"
  page-title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "24px"
    fontWeight: 450
    lineHeight: 1.3
    letterSpacing: "-0.024em"
  project-title:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "28px"
    fontWeight: 450
    lineHeight: 1.3
    letterSpacing: "-0.024em"
  project-heading:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "20px"
    fontWeight: 450
    lineHeight: 1.4
    letterSpacing: "-0.02em"
  metadata:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "13px"
  navigation:
    fontFamily: "Inter, -apple-system, BlinkMacSystemFont, system-ui, sans-serif"
    fontSize: "16px"
spacing:
  compact: "8px"
  list-gap: "16px"
  nav-gap: "18px"
  reading-gutter: "28px"
  reading-top: "40px"
  section-gap: "56px"
components:
  reading-nav-link:
    textColor: "{colors.muted}"
    typography: "{typography.navigation}"
  project-list-entry:
    textColor: "{colors.cream}"
    padding: "8px 0"
  code-block:
    backgroundColor: "{colors.code-surface}"
    textColor: "{colors.cream}"
    padding: "16px"
---

# Design System: adhikrish.cloud

## Overview

**Creative North Star: "static dark reading pages"**

the site is a sparse, dark reading surface. its interface steps aside for brief personal text, dated indexes, and static project readmes.

**Key Characteristics:**
- self-hosted inter throughout.
- dark surface with cream reading text and muted navigation or metadata.
- underlined text links and no decorative containers.
- static project pages that preserve readme structure.

## Colors

the palette stays nearly monochrome; the orange selection is the only warm interruption.

### Primary
- **Selection Orange:** used only for browser text selection.

### Neutral
- **Ink:** the page background.
- **Cream:** primary text and project-list links.
- **Muted Gray:** navigation, dates, descriptions, captions, and project metadata.
- **Hover Gray:** link hover state.
- **Code Surface and Code Border:** the only inset surface, used for preformatted code.

**The Quiet Palette Rule.** Keep ordinary page content within the dark, cream, and muted-gray system. Reserve orange for text selection.

## Typography

**Display Font:** Inter, loaded from the local woff2 asset.

**Character:** compact sans-serif type with modest negative tracking. hierarchy comes from size, weight, and spacing rather than a second face.

### Hierarchy
- **Page title:** used by the essays and "things i've built" indexes.
- **Project title:** used at the start of each project page.
- **Project heading:** used for readme h2 elements.
- **Body:** normal reading copy; project readmes increase line height to 1.8.
- **Metadata:** muted dates, captions, and first-commit text.

## Layout

the desktop homepage places a vertically centered, left-aligned text block with a maximum width of 720px and a 15% left inset. its three paragraphs share 17px type, weight 380, 1.9 line height, and 20px gaps. text wraps naturally. at 720px and below, body type remains 17px, and the text and navigation remain left-aligned, with 40px vertical and 28px horizontal padding. below 360px, horizontal padding becomes 20px. mobile centers the complete block vertically within the small viewport height. the homepage has no display heading or emphasized navigation link.

indexes and project pages use a centered reading column with a 680px maximum width. the desktop gutter is 28px and the top gutter is 40px. the /src index and generated reading pages keep 17px body text and 15px navigation at every viewport width. below 720px, the main gap becomes 48px. below 360px, horizontal padding is 20px.

the "things i've built" index at `/src` separates "spacecraft simulations" and "others" with plain muted headings and a 48px gap between groups. the first group starts 32px below the page title, with 16px between its heading and list. index entries align the title at left and any first-commit date at right. descriptions sit beneath their entries in muted text. standalone write-ups omit the date.

## Elevation & Depth

the system is flat. pages have no shadows, gradients, or raised cards. the dark code surface and its one-pixel border distinguish code without changing the page's flat character.

## Shapes

text and rules define the form language. text links use one-pixel underlines with a 2px offset. focus uses a one-pixel outline with a visible offset.

## Components

### Navigation

navigation links use muted grey and one-pixel underlines. the homepage's "things i've built", "contact@adhikrish.cloud", "linkedin", and "github" links form a wrapping row with 14px gaps, 20px after the last paragraph. all homepage links use the same muted color and 15px type at every viewport width. the full email address stays visible; links wrap when the viewport or enlarged text needs room. their hit areas stay at least 32px tall and wide. hovered links turn a darker grey; keyboard focus has a visible outline. links animate only their color over 220ms and disable that transition for reduced-motion users. the project github link sits at the far end of the wrapping project navigation. the index's "other stuff" link to public github repositories sits at the far end of its navigation the same way.

### Index Entries

each title-and-date row uses a two-column grid with a 24px gap. titles are underlined; dates do not wrap. project descriptions use muted 14px text below the row.

### Project Readmes

reading pages at `/src/:slug` render checked-in markdown as static html. repository-backed pages start with the title, the date alone, a smaller last edited line, and a github link that opens safely in a new tab. standalone write-ups use a descriptive title and a product website link, with no invented commit dates. the tryshipy write-up uses ASCII diagrams in the existing code-block style. local hashed plot assets remain responsive. long code blocks scroll inside their own bounds.

## Do's and Don'ts

- **Do** use the local inter font and the established type scale.
- **Do** keep index and project reading columns at 680px maximum width.
- **Do** use muted text for navigation, dates, descriptions, captions, and project metadata.
- **Do** underline text links throughout the site and use the darker grey hover state.
- **Do** keep project images local and responsive, and external github links in a new tab with `rel="noopener noreferrer"`.
- **Don't** add browser-side rendering scripts for project content.
- **Don't** replace the flat reading surface with cards, shadows, gradients, or decorative color.
- **Don't** let long code expand the page width; preserve internal horizontal scrolling.
