# NodePool Provider Agent

Stage 1: reads this machine's real specs and lists it on the NodePool contract (Base Sepolia),
so listings come from real hardware instead of manually typed values.

Stage 2: after listing, reports uptime for the machine's active rentals on a 60s heartbeat, and
remembers the listing across restarts so it doesn't create a duplicate machine every run.

## Setup

```bash
cd agent
npm install
cp .env.example .env
```

Edit `.env`:
- `PROVIDER_PRIVATE_KEY` — private key of the wallet that will own this listing. It needs a
  small amount of Base Sepolia ETH for gas ([faucet](https://www.alchemy.com/faucets/base-sepolia)).
- `PRICE_PER_HOUR` — what this machine rents for, in ETH/hour.
- `CONTRACT_ADDRESS` / `RPC_URL` — already default to the deployed contract and a public RPC;
  only change these if you're pointing at a different deployment.

## Run

```bash
npm start
```

This will:
1. Start a local health server on `http://localhost:3939/health` (`{"status":"ok","uptime":<seconds>}`).
2. On first run: read the machine's real CPU, RAM, disk, and OS via Node's `os` module (and `df`
   for disk), call `listMachine()` on the NodePool contract with those specs and the price from
   `.env`, print the assigned machine ID, and save it to `agent/machine-id.json`.
   On later runs: skip straight to uptime reporting using the machine ID already saved there,
   instead of listing a duplicate machine. Delete `machine-id.json` if you actually want a fresh listing.
3. Every 60 seconds: check the local health server, find this machine's active rentals, and call
   `reportUptime(rentalId, true)` for each one. Prints a heartbeat line each cycle — either
   `Machine N online - reported uptime for rental R` or `Machine N online - no active rentals`.
4. On Ctrl+C: best-effort reports each active rental as offline (`reportUptime(rentalId, false)`),
   then exits.

Leave the process running — the health server needs to stay up and the heartbeat needs to keep firing.

### Note on `reportUptime`

`reportUptime()` in `NodePool.sol` is restricted to the contract's `keeper` address
(`onlyKeeper` modifier) — a provider's own wallet normally isn't authorized to call it. If you
see `reportUptime reverted with "Not authorized keeper"` in the logs, either run the agent with
the keeper's private key, or have whoever holds the keeper role call
`setKeeper(<this wallet's address>)` on the contract. Everything else (listing, the health
server, finding active rentals) works regardless.

## Known limitation

The health endpoint is registered as `http://localhost:3939/health`, which isn't reachable from
outside this machine. A later stage will need to expose it publicly (tunnel or reverse proxy) so
external health checks can actually reach it. Stage 3 adds running rented jobs.
