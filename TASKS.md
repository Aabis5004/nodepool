# Remaining NodePool fixes — do one at a time, verify each before the next

## 1. Fix session persistence on refresh
The Privy embedded wallet session does not survive a page refresh — user gets logged out.
Console shows CSP errors: "unsafe-eval is not an allowed source" and WebAssembly.instantiate violations from auth.privy.io.
Fix the Content Security Policy so Privy's session WASM module can load, and make sure tryRestorePrivySession() actually restores the logged-in state on reload.

## 2. Add resend code button
In the email verification step, add a "Resend code" button with a 30-second cooldown countdown.
It should call sendEmailCode again for the same email.

## 3. Deposit from MetaMask into embedded wallet
Add a "Deposit from MetaMask" option in the wallet modal.
It should let a user with MetaMask send ETH from their MetaMask wallet directly to their embedded wallet address on Base Sepolia.

## 4. Move wallet info into a dropdown menu
Put the email, ETH balance, wallet address, and logout button into a dropdown that opens when clicking a 3-dot (or avatar) button in the header.
Keep it clean — just the button visible normally, details appear on click.

## 5. Verify everything still works
After all changes: email login, refresh persistence, deposit, send/withdraw, marketplace, rentals.
Check for console errors and fix any that appear.
