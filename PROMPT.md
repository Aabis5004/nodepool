Phase 4: Rental detail page and UI polish.

1. Rental detail view:
- When clicking any rental in My Rentals, open a full detail panel showing:
  - Machine specs (CPU, RAM, Storage, OS)
  - Provider address
  - Rental status badge (Requested/Active/Completed/Disputed)
  - Uptime progress bar with percentage
  - Time elapsed and time remaining
  - Deposit remaining and amount paid so far
  - Cancel / End Rental button
  - Chat section embedded at the bottom with message input
- This should feel like a proper order detail page

2. Provider view improvements:
- When provider sees incoming rental request, show renter message, requested hours, deposit amount
- Accept/Decline buttons with confirmation
- After accepting, show the active rental with uptime monitoring status

3. UI polish across the whole app:
- Add smooth page transitions between tabs
- Loading spinners on all async operations
- Better empty states with illustrations or icons
- Toast notifications with auto-dismiss
- Hover effects on all interactive elements
- Mobile responsive - test at 375px width
- Add a subtle gradient border animation on the hero section

4. Fix any broken features or console errors
