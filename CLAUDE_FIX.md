Read frontend/index.html and the contract in contracts/. Make this change. Do NOT
keep patching the Privy embedded-wallet send — we have spent days on it and it
still fails. Change the approach instead.

## New approach: MetaMask is the primary wallet
Make "Connect Wallet" (MetaMask) the main, first-class path for everything:
- On connect, show which wallet address is connected and fetch/display its live
  balance on the supported chain (Base Sepolia, 84532).
- Deposit, rent, list, and withdraw all run through the connected MetaMask signer.
- Withdraw = send ETH from the connected MetaMask wallet to a destination address
  the user types. Use the connected signer directly.

## Keep email login, but make it clearly secondary
Email (Privy embedded wallet) can stay as an optional login, but it must NOT be
required to use the app. If the embedded-wallet send keeps failing, the user can
always switch to MetaMask and everything works.

## Important constraint (do not design around this)
You CANNOT move funds OUT of the Privy embedded wallet using MetaMask — only the
embedded wallet can sign for its own ETH. So do not build "connect MetaMask to
withdraw the email wallet." Instead, for email users, deposits go INTO the
embedded wallet, and withdrawals must be signed BY the embedded wallet. If that
send still fails, the MetaMask-primary path above is the reliable route.

## Verify before saying done
Serve frontend/ on port 3000 (Privy allowlist only permits localhost:3000 and
nodepool.vercel.app). Test with MetaMask connected: show balance, deposit, and
withdraw (send ETH out) — all must land on-chain. Read the actual RPC calls to
confirm, since I have to do the final click myself.

## Do not undo
- Session restore (getAccessToken before user.get).
- Wallet stability (refetch user before embeddedWallet.create).
