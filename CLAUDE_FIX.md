Read frontend/index.html. Make these changes.

## 1. Remove email / Privy login entirely
Remove the "Sign in with Email" path and all Privy embedded-wallet code from the
active UX:
- Delete the "Sign in with Email" button and the email/code/wallet modals.
- Remove Privy calls from the login/session flow (openEmailModal, sendEmailCode,
  verifyEmailCode, finishPrivyLogin, tryRestorePrivySession, ensurePrivyReady,
  wrapPrivyProvider, the Privy iframe setup, and the js-sdk-core / privy imports).
- Remove the authMode 'privy' branch. The app is external-wallet only now.
- It's fine to leave dead helper functions if removing them is risky, but nothing
  Privy-related should run on load or be reachable from the UI.

## 2. Support multiple injected wallets
Replace the single "Connect Wallet" (which assumed window.ethereum = MetaMask)
with support for MetaMask, Rabby, OKX, and other injected EIP-1193 wallets:
- Use EIP-6963 (window.dispatchEvent(new Event("eip6963:requestProvider"))) to
  discover all injected providers, and show a small wallet picker listing each
  detected wallet by name/icon. Fall back to window.ethereum if no EIP-6963
  providers announce themselves.
- On selection, use that provider as the ethers BrowserProvider + signer and set
  rawProvider to it. Everything else (deposit, rent, list, withdraw, sendFunds)
  already uses the active signer, so it should work unchanged.
- Ensure the chosen wallet is prompted to switch to Base Sepolia (84532) via the
  existing ensureBaseSepolia() logic.

## 3. Keep everything else working
Deposit, rent, list, withdraw earnings, sendFunds (withdraw), and the on-chain
chat must all still work through whichever external wallet is connected.

## Verify before saying done
Serve frontend/ on port 3000. Connect with an injected wallet, confirm the
address + balance show, switch to Base Sepolia, and confirm a withdraw (sendFunds)
lands on-chain. Read the actual RPC calls to confirm. Report which wallets your
EIP-6963 discovery detected.
