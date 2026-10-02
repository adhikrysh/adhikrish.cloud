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
- underlined text links, outlined social icons, and no decorative containers.
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
- **Page title:** used by the essays and projects indexes.
- **Project title:** used at the start of each project page.
- **Project heading:** used for readme h2 elements.
- **Body:** normal reading copy; project readmes increase line height to 1.8.
- **Metadata:** muted dates, captions, and first-commit text.

## Layout

the homepage places a left-aligned text block slightly above center with a maximum width of 720px and a 15% left inset. its underlined essays and projects links and svg social icons share one line.

indexes and project pages use a centered reading column with a 680px maximum width. the desktop gutter is 28px and the top gutter is 40px. below 720px, body text becomes 16px, navigation becomes 15px, and the main gap becomes 48px. below 360px, horizontal padding is 20px and navigation becomes 14px.

index entries align the title at left and date at right. project descriptions sit beneath their entries in muted text.

## Elevation & Depth

the system is flat. pages have no shadows, gradients, or raised cards. the dark code surface and its one-pixel border distinguish code without changing the page's flat character.

## Shapes

text and rules define the form language. text links use one-pixel underlines with a 2px offset. icon links retain only their drawn outlines. focus uses a one-pixel outline with a visible offset. the homepage's icon outlines use rounded stroke caps and joins; the mail and linkedin svg rectangles retain their source 2px corner radius.

## Components

### Navigation

navigation links use muted grey. text links are underlined. the homepage has one compact row of essays, projects, and social icons, 20px below the last paragraph. the content sits six percent of the viewport height above center. all five links share a 16px visible gap. icon viewboxes omit unused horizontal space while preserving the drawing scale; invisible hit areas stay at least 32px wide. hovered links turn a darker grey, while keyboard focus keeps a visible outline. links animate only their color over 220ms. reading pages disable that transition for reduced-motion users. the project github link sits at the far end of the wrapping project navigation.

### Index Entries

each title-and-date row uses a two-column grid with a 24px gap. titles are underlined; dates do not wrap. project descriptions use muted 14px text below the row.

### Project Readmes

project pages render checked-in markdown as static html. each starts with the project title, the date alone, a smaller last edited line, and a github link that opens safely in a new tab. local hashed plot assets remain responsive. long code blocks scroll inside their own bounds.

## Do's and Don'ts

- **Do** use the local inter font and the established type scale.
- **Do** keep index and project reading columns at 680px maximum width.
- **Do** use muted text for navigation, dates, descriptions, captions, and project metadata.
- **Do** underline text links throughout the site and use the darker grey hover state.
- **Do** keep project images local and responsive, and external github links in a new tab with `rel="noopener noreferrer"`.
- **Don't** add browser-side rendering scripts for project content.
- **Don't** replace the flat reading surface with cards, shadows, gradients, or decorative color.
- **Don't** let long code expand the page width; preserve internal horizontal scrolling.
