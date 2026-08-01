Fix two real-time UI problems in frontend/index.html.

## 1. After a transaction completes, UI does not update - user must refresh manually
Every transaction (rent, deposit, list, delist, accept, cancel, send) should:
- Show "Confirming..." toast while the tx is pending (tx.wait())
- Show "Done!" / success toast when confirmed
- IMMEDIATELY re-fetch and re-render the relevant section (marketplace, my rentals, my machines, dashboard, balance) right after tx.wait() resolves - do NOT wait for the 20s auto-refresh
- Make sure every transaction handler calls the refresh function after confirmation
Audit ALL transaction functions and add immediate refresh-after-confirm to each one.

## 2. Rental shows ACTIVE but does not show if the machine is currently online/offline
Inside the rental detail view and rental cards:
- Show a live status: "Machine online - earning/paying" (green) or "Machine offline - payment paused" (amber) based on isMachineLive (machine.online && lastSeen within 3 min)
- This makes it clear when the provider's agent has stopped and payment is paused, vs when it's actively running
- Keep the ACTIVE badge but add this online/offline sub-status

Also verify the 20s auto-refresh is actually running and not silently erroring.
