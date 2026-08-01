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

## 1b. Privy session STILL not persisting on refresh (email only, MetaMask works fine)
The CSP fix did not solve it. Email/Privy login works but logs out on refresh; MetaMask stays connected.
Investigate the Privy client config in getPrivyClient() / ensurePrivyReady():
- Privy JS SDK Core stores the session token. Check if the client is created with the right storage option (it should persist to localStorage by default).
- Check if tryRestorePrivySession is actually calling client.user.get() successfully after refresh, or if it throws.
- Add console.log statements in tryRestorePrivySession showing: (a) did ensurePrivyReady resolve, (b) what client.user.get() returns or throws, (c) whether finishPrivyLogin was reached.
- The likely fix: the Privy client needs to be initialized the same way on reload as on first login, AND the session must be read before the wallet iframe times out.
Report what the console.log shows so we can see exactly where restore fails.

## 1b. Privy session STILL not persisting on refresh (email only, MetaMask works fine)
The CSP fix did not solve it. Email/Privy login works but logs out on refresh; MetaMask stays connected.
Investigate the Privy client config in getPrivyClient() / ensurePrivyReady():
- Privy JS SDK Core stores the session token. Check if the client is created with the right storage option (it should persist to localStorage by default).
- Check if tryRestorePrivySession is actually calling client.user.get() successfully after refresh, or if it throws.
- Add console.log statements in tryRestorePrivySession showing: (a) did ensurePrivyReady resolve, (b) what client.user.get() returns or throws, (c) whether finishPrivyLogin was reached.
- The likely fix: the Privy client needs to be initialized the same way on reload as on first login, AND the session must be read before the wallet iframe times out.
Report what the console.log shows so we can see exactly where restore fails.

## 1b. Privy session STILL not persisting on refresh (email only, MetaMask works fine)
The CSP fix did not solve it. Email/Privy login works but logs out on refresh; MetaMask stays connected.
Investigate the Privy client config in getPrivyClient() / ensurePrivyReady():
- Privy JS SDK Core stores the session token. Check if the client is created with the right storage option (it should persist to localStorage by default).
- Check if tryRestorePrivySession is actually calling client.user.get() successfully after refresh, or if it throws.
- Add console.log statements in tryRestorePrivySession showing: (a) did ensurePrivyReady resolve, (b) what client.user.get() returns or throws, (c) whether finishPrivyLogin was reached.
- The likely fix: the Privy client needs to be initialized the same way on reload as on first login, AND the session must be read before the wallet iframe times out.
Report what the console.log shows so we can see exactly where restore fails.

## 1c. THE REAL BUG - session persists but UI shows logged out
Console proof: on re-login attempt Privy returns "User already has one email account linked" (422).
This means the Privy session IS still active after refresh - but tryRestorePrivySession() is NOT updating the UI to show the logged-in state.

Fix tryRestorePrivySession():
- On page load, call client.user.get() to fetch the existing session
- If it returns a user with a linked email, call finishPrivyLogin() with that user to restore the UI (set userAddress, provider, signer, render wallet controls)
- The problem is likely that finishPrivyLogin() throws during the embedded wallet iframe handshake on reload, OR user.get() succeeds but finishPrivyLogin isn't being called with the restored user
- Add try/catch and console.log at each step so we see if user.get() succeeds and whether finishPrivyLogin completes
- Make sure the restored session shows email + balance + address in the header, same as a fresh login

Also: if a user is already logged in and tries to log in again, detect the existing session first and just restore it instead of calling loginWithCode (which causes the "already linked" error).

## 5. Fix wallet modal design and MetaMask connect
Two problems with the wallet modal:
1. The modal is not displaying as a proper centered popup - it appears as a large transparent panel bleeding over the page content. Fix the modal CSS: it should be a clean centered card with a dark backdrop overlay, proper max-width (440px), rounded corners, and not overlap the hero text behind it.
2. "Send from MetaMask to this wallet" shows "Not Connected" error. Fix depositFromMetaMask() to automatically prompt MetaMask to connect (eth_requestAccounts) BEFORE trying to send, instead of erroring. If MetaMask isn't installed, show a clear message.
3. Make the whole wallet modal look premium: proper spacing, the deposit and send sections as clean cards, good padding, matching the app's purple gradient theme.

## 5. Fix wallet modal design and MetaMask connect
Two problems with the wallet modal:
1. The modal is not displaying as a proper centered popup - it appears as a large transparent panel bleeding over the page content. Fix the modal CSS: it should be a clean centered card with a dark backdrop overlay, proper max-width (440px), rounded corners, and not overlap the hero text behind it.
2. "Send from MetaMask to this wallet" shows "Not Connected" error. Fix depositFromMetaMask() to automatically prompt MetaMask to connect (eth_requestAccounts) BEFORE trying to send, instead of erroring. If MetaMask isn't installed, show a clear message.
3. Make the whole wallet modal look premium: proper spacing, the deposit and send sections as clean cards, good padding, matching the app's purple gradient theme.

## 5. Fix wallet modal design and MetaMask connect
Two problems with the wallet modal:
1. The modal is not displaying as a proper centered popup - it appears as a large transparent panel bleeding over the page content. Fix the modal CSS: it should be a clean centered card with a dark backdrop overlay, proper max-width (440px), rounded corners, and not overlap the hero text behind it.
2. "Send from MetaMask to this wallet" shows "Not Connected" error. Fix depositFromMetaMask() to automatically prompt MetaMask to connect (eth_requestAccounts) BEFORE trying to send, instead of erroring. If MetaMask isn't installed, show a clear message.
3. Make the whole wallet modal look premium: proper spacing, the deposit and send sections as clean cards, good padding, matching the app's purple gradient theme.

## 6. Fix RPC endpoint and modal styling (still broken)
1. RPC ERROR: "RPC endpoint returned too many errors" on Base Sepolia. The public sepolia.base.org RPC is unreliable. Replace it everywhere in the code with a more reliable Base Sepolia RPC. Use https://base-sepolia-rpc.publicnode.com as the default RPC. Update it in: the contract read provider, ensureBaseSepolia() chain config, and anywhere else the RPC URL appears.

2. MODAL STILL BROKEN: The wallet modal is STILL showing as a large panel bleeding over the hero text, not a centered popup. The .modal-overlay and .modal-box CSS is not working. Make the wallet modal:
   - Fixed position, full screen dark backdrop (rgba(0,0,0,0.7))
   - Centered card, max-width 420px, max-height 85vh with scroll if needed
   - Solid dark background (#161622), rounded corners, proper padding
   - Above everything else (z-index 1000)
   - Must NOT show page content bleeding through behind the card
   Check why the existing modal CSS isn't applying and fix it.
