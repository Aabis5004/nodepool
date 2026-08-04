# NodePool Provider Agent

This agent runs on a machine you want to rent out. It never holds your real wallet's private
key — listing and pricing are done in the browser with your own wallet, and the agent only
carries a low-stakes, auto-generated "device key" scoped to reporting uptime and provisioning
SSH access for the one machine you explicitly authorize it for.

- **Stage 1 — Listing**: done in the browser (Register Machine), signed by your real wallet.
- **Stage 2 — Uptime**: this agent heartbeats every 60s so the marketplace shows the machine as
  live, and reports uptime for active rentals so the provider gets paid per verified hour.
- **Stage 3 — SSH access**: when a rental goes active, this agent stands up an isolated Docker
  container with SSH access, tunnels it out with ngrok, encrypts the connection details to the
  renter's on-chain public key, and writes the ciphertext on-chain — only the renting wallet can
  ever decrypt it.

## Setup

```bash
cd agent
npm install
cp .env.example .env
```

`.env` needs no private key and no secrets at all. The defaults (`CONTRACT_ADDRESS`, `RPC_URL`,
`HEALTH_PORT`) already point at the deployed contract and a public RPC — only change them if
you're pointing at a different deployment. `SSH_IMAGE`/`SSH_MEMORY_LIMIT`/`SSH_CPU_LIMIT`/
`SSH_PIDS_LIMIT` control the per-rental container (see Stage 3 below); the defaults are sane.

### Stage 3 prerequisites: Docker + ngrok

SSH access provisioning needs two tools installed and on `PATH`. If either is missing, the agent
logs a one-time warning and keeps running with uptime reporting only — Stage 3 is additive, not
required to list a machine or get paid for uptime.

**Docker** — install Docker Engine (Docker Desktop on macOS/Windows, `docker.io`/`docker-ce` on
Linux) and make sure the account running the agent can run `docker` without `sudo` (on Linux,
`sudo usermod -aG docker $USER` then re-login). The agent pulls `linuxserver/openssh-server` on
first use — that download happens the first time a rental goes active, so the very first
provisioning can take a minute or two.

**ngrok** — install the [ngrok CLI](https://ngrok.com/download), sign up for a free account, then
run once:

```bash
ngrok config add-authtoken <your-authtoken>
```

**Important — ngrok now requires a verified card, even on the free tier, before it will open TCP
endpoints** (which is what SSH tunneling needs). Without one, tunnels fail immediately with:

```
ERROR:  failed to start tunnel: You must add a credit or debit card before you can use TCP
ERROR:  endpoints on a free account. We require a valid card as a way to combat abuse and
ERROR:  keep the internet a safe place. This card will NOT be charged.
ERROR:  ERR_NGROK_8013
```

This is a real ngrok account policy, not a bug — add a card at
https://dashboard.ngrok.com/settings#id-verification (ngrok states it will not be charged; it's
used for identity verification to prevent abuse of TCP tunnels). Do this once, before your first
rental goes active. The agent surfaces this exact error in its logs if a tunnel fails for this
reason, rather than a generic "provisioning failed."

## Run

```bash
npm start
```

On first run:
1. Generates a random device key, saved to `agent/device-key.json` (gitignored — never commit
   it, though it's low-stakes: it can only report uptime and write SSH ciphertext for a machine
   you explicitly authorize it for; see "What the device key can and can't do" below).
2. Starts a local health server on `http://localhost:3939/health`.
3. Prints the device address and waits, checking every 10s, until it finds a machine that
   authorizes it — see "Registering a machine" below.

Once authorized, on every run after the first it goes straight to reporting uptime for the
machine it's authorized for (cached in `agent/machine-id.json`, gitignored) — self-healing if
that file is missing or stale by re-scanning the contract for machines that currently authorize
this device key.

Leave the process running — the health server needs to stay up and the heartbeat needs to keep
firing for the marketplace to keep showing the machine as online.

## Registering a machine

Listing happens in the browser now, signed by your real wallet — this agent never sees it.

1. Run `npm start`. It prints something like:
   ```
   Device address: 0xAB61...6602
   This device is not authorized to report for any machine yet.
   Open the website, connect your wallet, and either:
     - Register Machine, pasting this device address, or
     - Authorize Device on an existing machine you own,
     with this address: 0xAB61...6602
   ```
2. On the website, connect your wallet, go to **My Machines → Register Machine**, fill in specs
   and price, and paste that device address into the **Device Address** field. This authorizes
   the device in the *same* transaction as listing — one signature.
   - Already have a machine listed? Use **Authorize Device** on its card instead — this also
     lets you re-point an existing machine to a new device key later (e.g. after reinstalling
     the agent on new hardware) without re-listing.
3. Within ~10s the agent picks up the authorization, marks the machine online, and starts
   heartbeating every 60s — logging either `... online - reported uptime for rental N` when a
   rental is active, or `... online - no active rentals` otherwise.

On Ctrl+C, the agent best-effort marks the machine and any active rentals offline before exiting,
and tears down any Stage 3 containers/tunnels it had provisioned.

## Stage 3: how SSH access actually gets to the renter

When one of this machine's rentals becomes Active, the agent (on its next 60s tick):

1. Reads the renter's on-chain public key (submitted when they requested the rental).
2. Starts an isolated container — `docker run` with no bind mounts to any host path, a
   memory/CPU/process-count cap, dropped Linux capabilities, and a random host port. The renter
   never reaches this machine's filesystem or any other container on it.
3. Generates a random username/password for that container.
4. Runs `ngrok tcp <port>` and reads back the public `host:port` ngrok assigned.
5. Encrypts `{host, port, username, password}` to the renter's public key (nacl.box, a fresh
   one-time keypair per rental) and calls `writeAccessCredentials()` on-chain with the
   ciphertext. This call is gated the same way `reportUptime` is — only this machine's owner or
   its authorized device key can write it, and it moves no funds.

On the renter's side (in the browser, **My Rentals → that rental**): once the rental is Active, an
"SSH Access" panel appears. It may say "Provisioning..." for up to a minute while the steps above
run. Clicking **Show SSH Access**:

1. Prompts the renter's wallet for a signature (same fixed message every time — no funds moved,
   nothing sent on-chain, just a signature that deterministically regenerates their private
   decryption key).
2. Decrypts the on-chain ciphertext locally, entirely in the browser.
3. Shows the connection details and a ready-to-copy `ssh -p <port> <username>@<host>` command.

Nobody else can do this — the ciphertext is public on-chain (like everything else in the
contract), but only a signature from the exact wallet that requested the rental can reproduce the
private key that opens it. The agent, the provider, and every other visitor to the site see only
opaque bytes.

When the rental ends (renter cancels, provider settles, or it runs out its paid hours), the
contract deletes the on-chain ciphertext and the agent tears down the container and kills the
ngrok tunnel on its next tick — a fresh container and fresh credentials are provisioned for the
next rental.

## What the device key can and can't do

The device key (`agent/device-key.json`) is deliberately powerless outside the one machine it's
authorized for. On-chain, it can only ever call:

- `setMachineOnline` — heartbeat, for the one machine that authorizes it
- `reportUptime` — for that machine's rentals only
- `writeAccessCredentials` — writes SSH ciphertext for that machine's active rentals only

It **cannot** withdraw earnings, delist a machine, change its price, or move any funds — those
stay gated to the machine owner's real wallet, which this agent never touches. If this file is
ever lost or compromised, the worst case is someone can fake uptime/heartbeat/SSH-ciphertext
writes for machines you've authorized it for; re-authorizing a different device (via **Authorize
Device** in the browser) immediately revokes it.

## Known limitations

- One active container per machine at a time, matching the contract's one-active-rental-per-
  machine model — this isn't a corner that was cut, it's what the contract itself enforces.
- ngrok's free tier has bandwidth/session limits worth knowing about for heavy use; a paid plan
  or self-hosted alternative can be swapped in later without changing the on-chain design.
- The container image (`linuxserver/openssh-server` by default) is configurable via `SSH_IMAGE`
  in `.env`, but must accept `USER_NAME`/`USER_PASSWORD`/`PASSWORD_ACCESS` environment variables
  the same way that image does if you swap it.
