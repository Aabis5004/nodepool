Integrate Privy embedded wallets into the frontend. Privy App ID: cms9a0vfy00dq0cl2355bvcjr

What to do:
1. Add Privy JS SDK via CDN script tag
2. Replace the current Connect Wallet button with two options: "Sign in with Email" (Privy) and "Connect Wallet" (MetaMask)
3. When user signs in with Privy, use their embedded wallet to interact with the contract
4. Keep MetaMask as a fallback option
5. Show the logged-in user email or wallet address in the header
6. Add a logout button when connected
7. Make sure all contract interactions work with both Privy wallet and MetaMask wallet
