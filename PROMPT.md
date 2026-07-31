Phase 3: Clean up machine listing and rental UX.

1. Machine listing form improvements:
- Add validation for all fields
- Add a preview card showing how the listing will look before submitting
- After listing, auto-refresh the marketplace
- Show success state with the machine ID

2. Marketplace improvements:
- Show "No machines yet - be the first to list yours" empty state with a CTA button
- When a machine card is clicked, open a detail modal showing full specs, provider address, uptime history, and a Rent button
- Add machine status indicator (green dot = online, red = offline)

3. Rental flow cleanup:
- After renting, automatically switch to My Rentals tab
- Show rental details page when clicking on a rental: machine specs, uptime progress bar, time remaining, deposit remaining, cancel button, and chat section all in one view
- Chat should only appear inside a rental, not as a separate global tab

4. Remove the standalone Chat tab - chat lives inside each rental detail view only

5. Dashboard cleanup:
- Fix the "3 Total Machines" count to only show available machines
- Show recent activity feed (latest listings, rentals, payments)
