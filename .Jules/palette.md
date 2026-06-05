## 2025-05-14 - Pausing Newswire on Hover
**Learning:** Automated scrolling animations (like a newswire) can be difficult to read or interact with for some users. Providing a simple way to pause the animation (e.g., on hover) improves readability and user control.
**Action:** Always consider adding `animation-play-state: paused` on hover for scrolling content.

## 2026-06-05 - Accessible Clickable Containers
**Learning:** Interactive "cards" or containers that aren't native buttons must have explicit ARIA roles, tab indices, and keyboard event handlers (Enter/Space) to be accessible. Providing a high-contrast focus-visible outline is critical for visibility on dark theme backgrounds.
**Action:** When making a div clickable, always add role="button", tabindex="0", and a keydown listener. Use a themed gold focus outline for dark modes.

## 2026-06-05 - Cross-Contextual Visual Feedback
**Learning:** When a user expresses interest in a specific data point in one tab (e.g., following a milestone chase), providing immediate visual reinforcement in another related context (e.g., a live game card) creates a cohesive "Watching" experience.
**Action:** Use shared state (like a `followedChases` Set) to propagate user interests across disparate UI components, such as adding a pulsing "WATCHING" badge to game cards when a followed player is active.
