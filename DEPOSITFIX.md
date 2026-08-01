Fix the deposit/transaction confirmation feedback in frontend/index.html.

## Problem
When a user deposits from MetaMask, or buys/rents, or does any transaction:
- The blockchain transaction confirms (MetaMask shows "Confirmed transaction")
- BUT the app shows no success message and the balance/data does not update
- The user has to manually refresh to see the change

## What to fix
1. depositFromMetaMask(): after tx.wait() confirms, show a clear success toast "Deposited X ETH successfully!" and refresh the balance. The problem may be that the balance reads too fast before the node updates - add a short retry: refresh balance immediately, then again after 3 seconds and 6 seconds so it catches the updated balance. Update both the header balance chip and the modal balance (wmBalance).

2. For ALL transactions (rent, deposit, send, list, etc): after confirmation, show an explicit success toast that says what happened (e.g. "Rental confirmed!", "Machine listed!", "Sent X ETH!") and refresh the relevant data with the same retry pattern (immediate + 3s + 6s) so slow RPC nodes still show the update without manual refresh.

3. Make the success toast clearly visible and auto-dismiss after 4 seconds.

The key issue: balance/data reads happen too fast after tx.wait(), before the RPC node reflects the change. The retry pattern fixes this.
