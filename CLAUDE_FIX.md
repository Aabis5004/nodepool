Goal: Stage 3 — a renter gets real, private, VPS-style SSH access to an ISOLATED
container on the rented machine. Credentials are ENCRYPTED so ONLY the renting
wallet can read them, and it must work in ALL wallets (MetaMask, Rabby, OKX), not
just MetaMask. Renting/payment already works.

Read the whole project first (agent/agent.js, contracts/NodePool.sol, frontend/
index.html, agent/README.md Stage 3). Give a full PLAN and confirm with me BEFORE
writing code or deploying. Do NOT deploy without my explicit go.

## Encryption model — wallet-agnostic (IMPORTANT)
Do NOT use MetaMask's eth_getEncryptionPublicKey / eth_decrypt — they are
deprecated and unsupported in Rabby/OKX, which would break multi-wallet support.

Instead:
- The renter's browser generates its OWN encryption keypair using a standard library
  (tweetnacl / nacl.box, or eccrypto). The private key is derived deterministically
  from a wallet SIGNATURE so the renter can always regenerate it from their wallet
  (e.g. renter signs a fixed message with their wallet; hash the signature into the
  nacl secret key). This works in every wallet because it only needs personal_sign,
  which all wallets support — no wallet-specific decryption API.
- At rent time, the browser derives this keypair, and submits the PUBLIC key on-chain
  with the rental.
- The agent encrypts the container credentials to that public key (nacl.box) and
  writes the encrypted blob on-chain for that rental.
- To view, the renter signs the same fixed message, regenerates the private key in
  the browser, and decrypts. Only the renting wallet can produce that signature, so
  only they can decrypt. Data is public on-chain but useless to everyone else.

This gives full end-to-end encryption, works in all wallets, and needs no deprecated
APIs.

## Access model
1. When a rental becomes Active, the agent on the provider machine:
   a. Starts an ISOLATED, resource-limited Docker container (renter NEVER reaches
      the host or the provider's files — container only).
   b. Sets up SSH login inside the container.
   c. Exposes the container's SSH port via a tunnel (cloudflared or ngrok — choose
      one, document provider setup) so the renter can connect from their own laptop
      over the internet like a real VPS.
   d. Encrypts {host, port, username, password} to the renter's public key and
      writes it on-chain for that rental.
2. Frontend: at rent time, derive + submit the renter's encryption public key; after
   provisioning, ONLY the renter's wallet can decrypt and see the ssh connection
   string. Other wallets see only ciphertext.
3. On rental end/cancel/agent-shutdown: destroy the container, close the tunnel,
   expire the on-chain creds. Fresh container next rental.

## Hard security requirements
- Container isolation is mandatory; the provider's host is NEVER exposed.
- Credentials only ever readable by the renting wallet (encrypted end-to-end).
- Access scoped to rental duration, revoked on end.
- Keep existing security model: the agent's on-chain identity stays the powerless
  device key (can report uptime + write encrypted creds, but CANNOT move funds,
  withdraw, or delist).
- Do not break: multi-wallet login, browser-signed listing, device-key uptime
  reporting, rent/settle.

## Deliverables
- Contract: per-rental renter-encryption-pubkey + encrypted-credentials fields.
  Writing creds callable ONLY by the machine's authorized reporter (device key);
  reading is public. Confirm the device key still cannot touch funds. Fresh deploy;
  then update CONTRACT_ADDRESS in frontend, agent, deployments.json (all three match).
- Agent: Docker lifecycle + SSH setup + tunnel + encrypt-to-renter + write on-chain,
  tied to active rentals; full teardown on end.
- Frontend: derive renter encryption key from a wallet signature; submit pubkey at
  rent time; decrypt + show connection string to the renter only.
- Docs: provider must install Docker + cloudflared; how a renter connects.

## Process
Plan first. Confirm before coding: (a) tunnel choice cloudflared vs ngrok, (b)
container image + resource limits, (c) the exact wallet-signature→nacl-keypair
derivation, (d) on-chain schema for pubkey + encrypted blob. THEN implement in
phases. Hold deploy until I say go.
