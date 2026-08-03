Read frontend/index.html. Remove the manual "Add Machine" listing feature
completely. Listing should ONLY happen through the provider agent (agent/agent.js
calling listMachine on-chain), never from the browser.

Remove:
- The "+ Add Machine" button and the "List Your Machine" button in the My Machines tab.
- The Add Machine modal/form (CPU, RAM, Storage, OS, Price per Hour, Health Endpoint
  inputs) and its submit handler that calls listMachine().
- Any leftover listMachine() call path from the frontend UI.

Keep everything else exactly as is: Marketplace browsing, renting (requestRental),
My Rentals, Dashboard, withdraw earnings, and the empty-state text in My Machines
can stay but change its message to tell providers to run the agent instead of
listing in the browser. Something like: "Machines are listed by running the
NodePool provider agent on your computer. See the agent/ folder."

Do not touch the wallet connection, rental, or withdraw logic.

Verify: serve frontend/ on port 3000, confirm the My Machines tab no longer shows
any Add Machine button or form, and that Marketplace/rent/withdraw still work.
