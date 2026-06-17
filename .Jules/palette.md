## 2025-05-14 - Pausing Newswire on Hover
**Learning:** Automated scrolling animations (like a newswire) can be difficult to read or interact with for some users. Providing a simple way to pause the animation (e.g., on hover) improves readability and user control.
**Action:** Always consider adding `animation-play-state: paused` on hover for scrolling content.

## 2026-06-05 - Accessible Clickable Containers
**Learning:** Interactive "cards" or containers that aren't native buttons must have explicit ARIA roles, tab indices, and keyboard event handlers (Enter/Space) to be accessible. Providing a high-contrast focus-visible outline is critical for visibility on dark theme backgrounds.
**Action:** When making a div clickable, always add role="button", tabindex="0", and a keydown listener. Use a themed gold focus outline for dark modes.

## 2026-06-05 - Prioritize Active Content
**Learning:** For real-time dashboards, users usually care most about what's happening *right now*. Prioritizing "Live" states over "Scheduled" or "Final" states by default reduces cognitive load and helps users find relevant information faster.
**Action:** Implement a 3-tier status priority (Ongoing > Scheduled > Completed) for default sorting of real-time data feeds.

## 2026-06-09 - High-Contrast Secondary Metadata
**Learning:** In dark-themed dashboards, there's a tendency to use dimmed colors (like #555) for secondary labels to create hierarchy. However, on near-black backgrounds, this often fails WCAG AA contrast (4.5:1). Using a "Slate 400" (#94a3b8) maintains the visual hierarchy while ensuring accessibility.
**Action:** Use #94a3b8 for secondary text and "kicker" labels on dark backgrounds to balance hierarchy and legibility.

## 2026-06-12 - Cohesive Keyboard & Motion UX
**Learning:** Interactive elements must provide visual feedback for keyboard users that matches hover states to ensure a cohesive experience. Additionally, repetitive animations and transitions can be distracting or problematic for some users; respecting `prefers-reduced-motion` is essential for inclusive design.
**Action:** Always pair `:hover` effects with `:focus-visible` and implement `@media (prefers-reduced-motion: reduce)` to disable non-essential animations and transitions.

## 2026-06-14 - Dashboard Consistency & State Feedback
**Learning:** When multiple dashboards share similar UX patterns (e.g., MLB and NBA), users expect consistent accessibility support. Providing immediate ARIA-live feedback (like "Date set to...") for control changes ensures that all users, including those using assistive technologies, understand that their action had an effect, even if the main content hasn't refreshed yet.
**Action:** Synchronize accessibility features across related dashboards and use existing `aria-live` regions to confirm user actions.
## 2026-06-15 - Qualitative Visual Feedback
**Learning:** Using color-coding to threshold quantitative metrics (like the 0-100 Watchability score) allows users to process data qualitatively at a glance. Transitioning from neutral/gold to a success color (Green) at a high threshold (e.g., >70) provides immediate visual gratification and helps high-priority items stand out.
**Action:** Apply qualitative color-coding to numeric scores where specific ranges signify different levels of interest or urgency.

## 2026-06-17 - Centralized Navigation & Semantic Headers
**Learning:** Providing a consistent navigation menu across all dashboards reduces friction and helps users orient themselves. Integrating this into a semantic `<header>` with `<nav>` and `aria-current="page"` improves accessibility for screen readers and ensures keyboard users have a predictable way to navigate.
**Action:** Use a standardized `.main-nav` component within headers and explicitly mark the active page.
