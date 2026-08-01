Polish the NodePool UI for clear feedback and smooth animations. Do NOT rebuild from scratch - enhance what exists in frontend/index.html.

## 1. Clear transaction feedback (most important)
- After every successful transaction, show a big clear success toast with the specific action and amount: "✓ Deposited 0.0001 ETH", "✓ Rental confirmed", "✓ Machine listed", etc.
- Make success toasts green, prominent, with a checkmark, auto-dismiss after 4s.
- Show the updated value change visibly (e.g. balance number briefly pulses/highlights green when it increases).

## 2. Scroll-reveal animations
- Every major section (hero, features, how it works, pricing, marketplace cards, machine cards) should fade + slide up smoothly as it scrolls into view, using IntersectionObserver with a staggered delay.
- Machine cards and rental cards should animate in one after another (staggered).

## 3. Smooth micro-interactions
- Buttons: subtle scale + glow on hover.
- Cards: lift and glow on hover.
- Tab switches: smooth fade transition.
- Modals: scale + fade in animation.
- Balance/number changes: brief highlight pulse.

## 4. Keep the existing dark purple theme and layout - just make it feel alive and premium, like a modern crypto dashboard. Do not break any existing functionality.
