Stop fixing. Diagnose only - do NOT change any code. Open frontend/index.html and investigate these issues, then report the exact root cause of each with line numbers.

## Issue 1: Success notifications never appear
Every transaction (deposit, rent, withdraw, list, accept, cancel, send) should show a success message, but the user sees nothing.
- Find the showToast function and its container element. Does the container exist in the DOM? Is its CSS positioning/z-index correct, or is it hidden/clipped?
- Add a one-time test at page load that calls showToast('DIAGNOSTIC TEST','success') - does it render a visible element? Report yes or no.
- Report whether the Transaction Completed modal from RELAYFIX.md was actually built and wired, or not.

## Issue 2: "Loading..." stuck in header
The header shows "Loading..." next to Connect Wallet and never resolves. This means the Privy/email section fails to initialize.
- Find where the header renders "Loading..." (likely privySdkStatus === 'loading' in renderWalletControls).
- Trace why ensurePrivyReady() never resolves to 'ready'. Is there a JS error, a CSP block, or a failed CDN import breaking initialization?
- Check the browser-relevant code path and report the exact reason the SDK stays in 'loading'.

## Issue 3: Refresh shows wallet mode instead of email
After refreshing when logged in via email, the header wrongly shows Connect Wallet / MetaMask instead of the email account.
- In tryRestorePrivySession and finishPrivyLogin, is authMode set to 'privy' on restore? Report the exact lines.

## Also: check for JavaScript errors
Run a syntax check on the inline script. Report any errors that would stop the whole script from running - because if the script errors early, NOTHING after it works (which would explain why toasts, Privy loading, and everything else all fail at once).

Report all findings as plain text with line numbers. Do NOT edit anything yet. I want the root cause first.
