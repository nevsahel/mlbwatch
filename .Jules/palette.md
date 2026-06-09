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
