Two things: (1) transaction success notifications NEVER show for any action, fix definitively, and (2) redesign to match relay.link's clean sharp premium style.

## PART 1 - Definitive success feedback (most important)
Problem: deposit, rent, withdraw, list, accept, cancel - NONE show a completion message. Balance updates but user sees no confirmation.

Step 1: Test - on page load call showToast('TEST VISIBLE','success') after 2s. If it does not appear, the toast system is broken.

Step 2: Rebuild a bulletproof success system. Create a "Transaction Completed" MODAL (like relay.link) that appears after every confirmed transaction:
- Big green circle (#16C784) with white checkmark at top
- Headline: specific per action ("Deposit Completed", "Rental Confirmed", "Withdrawal Completed", "Machine Listed", etc.)
- Details box: the amount, and the tx hash as a clickable link to https://sepolia.basescan.org/tx/HASH
- Two buttons: "VIEW ON BASESCAN" (light secondary) and "DONE" (solid purple, closes modal)
- Scale + fade in animation, appended to document.body, z-index 2147483647 so nothing clips it

Step 3: Show this modal after tx.wait() in EVERY transaction function: depositFromMetaMask, submitRental, acceptRental, declineRental, endRental, cancelRental, withdrawEarnings, sendFunds, submitMachine, delistMachine. Pass each the correct title and tx hash.

## PART 2 - Relay.link visual style site-wide
Apply relay.link's design language:
- Primary color: deep purple gradient #7C5CFC to #6E56CF
- Success green: #16C784
- Cards and modals: clean white-on-dark or dark cards, border-radius 14px (sharp not soft), generous padding, subtle shadow, high contrast
- Buttons: solid purple primary with slight rounded corners, light secondary buttons
- Bold clear typography, lots of whitespace, sharp modern confident look
- Apply consistently across marketplace, rentals, dashboard, wallet modal, all buttons and cards

## PART 3 - Also fix: after refreshing the page when logged in via email, the header wrongly shows "Connect Wallet" / MetaMask mode instead of the email session. On session restore (tryRestorePrivySession / finishPrivyLogin), make sure authMode is set to 'privy' so it shows the email account, not wallet mode.

Do NOT break contract calls, agent, or login. Test everything.
