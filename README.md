# NodePool

NodePool is a decentralized compute marketplace. Anyone with an idle computer can list it and
earn money for every hour it's actually up and rented; anyone who needs compute can rent one and
get real SSH access to it, like a small VPS, for as long as they pay for. There's no company
running servers in the middle. The contract holds the escrow, verifies uptime, and settles
payment; a small provider-run agent handles listing, heartbeats, and setting up an isolated
container for the renter; the browser handles everything else, including making sure only the
renting wallet can ever see the SSH credentials.

Live app: nodepool.vercel.app

Deployed contract (Base Sepolia, chain 84532): `0x54436C58A3671B24E9004858a55889C44585E7E5`

## How it works

**If you're providing a machine**, you register it from the website with your wallet — CPU, RAM,
storage, OS, and a price per hour. You run a small agent process on the machine itself, which
sends a heartbeat to the contract roughly once a minute so renters can see it's actually online.
When someone rents your machine, the agent spins up an isolated Docker container with SSH access,
tunnels it out to the internet, and hands the connection details to the renter — encrypted so
only they can read them. As long as your machine stays online, the contract releases payment to
you hour by hour out of the renter's deposit. If it goes offline, payment stops.

**If you're renting a machine**, you browse the marketplace, pick one that's online, and pay a
deposit up front for however many hours you want. Once the provider accepts, their agent
provisions a container for you within about a minute. You open the rental in the app, sign a
message with your wallet to decrypt the access details, and you get a normal SSH connection
string — host, port, username, password. You connect and use the machine like you would any
rented server. Nothing you do in that container touches the provider's actual computer. When the
rental ends, the container is destroyed and your access is gone.

**Escrow and settlement** happen entirely in the contract. Renting a machine locks your deposit
in the contract, not in anyone's hands. The provider's agent reports uptime for the rental, and
the contract pays out of the deposit for each verified hour, refunding whatever's left over when
the rental ends, gets cancelled, or the provider declines it.

## Architecture

**`contracts/NodePool.sol`** is the whole marketplace: listing machines, requesting and accepting
rentals, escrow, hourly settlement based on reported uptime, a chat channel per rental, and the
encrypted SSH credentials for a rental once it's active. Everything that moves money or changes a
listing requires the machine owner's real wallet to sign. The one exception is a narrow set of
functions a machine's low-privilege "device key" is allowed to call — see Security model below.

**`frontend/index.html`** is the whole web app — a single static HTML file with the marketplace,
wallet connection (any injected wallet, not just MetaMask, via EIP-6963 discovery), the machine
registration form, rental flow, and the rental detail view where a renter decrypts and sees their
SSH access. It talks to the contract directly with ethers.js; there's no backend server.

**`agent/agent.js`** runs on the provider's machine. It never touches the owner's wallet. On
first run it generates its own keypair (the device key), and does nothing until the machine owner
authorizes it from the website. Once authorized, it heartbeats the contract, reports uptime for
active rentals, and, when a rental goes active, provisions an isolated SSH container for the
renter, encrypts the connection details to the renter's public key, and writes the ciphertext to
the contract.

## Security model

The device key the agent generates is deliberately powerless outside of what it's authorized to
do. It can call exactly three functions on the contract, all scoped to the one machine that
authorizes it: reporting online/offline status, reporting uptime for that machine's rentals, and
writing encrypted SSH credentials for that machine's active rental. It cannot withdraw earnings,
delist a machine, change its price, or move any funds anywhere. Those all require the machine
owner's real wallet. If a device key were ever lost or leaked, the owner can immediately
re-authorize a different one from the website without re-listing the machine, which revokes the
old key's access entirely.

SSH credentials are end-to-end encrypted to the renter, not just access-controlled. When a renter
requests a rental, their browser derives an encryption keypair by signing a fixed message with
their wallet and hashing the signature — the same wallet always regenerates the same keypair, and
nothing is ever stored. Only the public half of that keypair goes on-chain with the rental
request. When the agent provisions the container, it encrypts the host, port, username, and
password to that public key and writes only the ciphertext to the contract. That ciphertext is
technically public, like everything on-chain, but it's useless to anyone who can't reproduce the
matching wallet signature — which is only the wallet that requested the rental. This works with
any wallet that supports a normal signing request, not just MetaMask.

The container itself is isolated from the provider's actual machine: it runs with dropped Linux
capabilities, a memory/CPU/process cap, no mounted host directories, and a randomly assigned
port. A renter inside the container has no path to the provider's files or anything else running
on that computer.

## Provider setup

This walks through everything from a clean machine.

**1. Install Node.js.** Get an LTS release from nodejs.org, or use your system's package manager.
Confirm it worked with `node --version`.

**2. Install Docker.** On Linux, install `docker.io` or Docker Engine from your distro's
instructions; on macOS or Windows, install Docker Desktop. Start it, then confirm it's running
with:

```bash
docker ps
```

If that returns a header row instead of an error, Docker is up. On Linux you'll also want your
user in the `docker` group so the agent can run Docker commands without `sudo`:

```bash
sudo usermod -aG docker $USER
```

then log out and back in for it to take effect.

**3. Create an ngrok account and install ngrok.** Go to ngrok.com, sign up for a free account,
and install the ngrok CLI for your platform from their download page. Once it's installed, open
your ngrok dashboard, find your authtoken under "Your Authtoken," and run:

```bash
ngrok config add-authtoken <your-authtoken>
```

**4. Add a payment card to your ngrok account.** This is easy to miss and it will block SSH
provisioning if you skip it. ngrok now requires a verified card on file before it will open TCP
endpoints, which is what SSH tunneling needs, even on the free tier. Without it, the first rental
that tries to provision will fail with an error containing `ERR_NGROK_8013`. Add a card under
Billing in your ngrok dashboard — ngrok is explicit that the free tier is not charged for this,
it's just used to verify you're a real account. Do this once, before your first rental.

**5. Configure the agent.** From the repo root:

```bash
cd agent
npm install
cp .env.example .env
```

The defaults in `.env` already point at the deployed contract and a public RPC endpoint, so you
usually don't need to change anything:

- `CONTRACT_ADDRESS` — the NodePool contract on Base Sepolia
- `RPC_URL` — a public Base Sepolia RPC
- `HEALTH_PORT` — local port for the agent's health check server

There is no private key to configure. The agent generates its own device key the first time it
runs.

**6. Run the agent and copy its device address.**

```bash
npm start
```

The first time it runs, it prints something like:

```
Generated a new device key: 0xAB61...6602
Device address: 0xAB61...6602
This device is not authorized to report for any machine yet.
```

Copy that address. Leave the agent running.

**7. Register the machine on the site.** Open the app, connect your wallet, go to My Machines,
and click Register Machine. Fill in the specs and price per hour, paste the device address from
the previous step into the Device Address field, and submit. This lists the machine and
authorizes the agent's device key in a single transaction. Within about ten seconds, the agent
picks up the authorization and starts heartbeating.

**8. Fund the device wallet.** The device key needs a small amount of its own Base Sepolia ETH to
pay gas for heartbeats and, later, for provisioning transactions. About 0.002 ETH is enough to
run for a long time. Send it to the device address you copied earlier from a
[Base Sepolia faucet](https://www.alchemy.com/faucets/base-sepolia) or from any wallet you
control.

**9. Confirm it's live.** Back on the site, your machine should show an online status within a
minute or so of the agent starting. If it doesn't, check the agent's terminal output — it prints
a line every cycle explaining what it did.

## Renter guide

**1. Connect your wallet.** You'll need a small amount of Base Sepolia ETH to cover the rental
deposit and gas.

**2. Rent a machine.** Go to the Marketplace tab and pick one that shows as online. Choose how
many hours you want and confirm. Your wallet will ask you to sign a message first — this derives
your encryption key and costs nothing — and then to confirm the rental transaction, which locks
your deposit in escrow.

**3. Wait for the provider to accept.** Once they do, the rental becomes active and their agent
starts provisioning your container. This can take up to about a minute the first time, since the
image has to be pulled.

**4. Open the rental and show your SSH access.** Go to My Rentals, open the rental, and once
provisioning is done you'll see a Show SSH Access button. Click it, sign the message your wallet
asks for, and the app decrypts your host, port, username, and password locally and shows you a
ready-to-copy SSH command.

**5. Connect.**

```bash
ssh -p <port> renter@<host>
```

Enter the password shown in the app when prompted.

**6. When you're done.** Ending the rental, letting it run out of paid hours, or the provider
cancelling all destroy the container and clear your access from the contract. If you want to keep
using the machine, rent it again.

## Deploying your own instance

If you want to run your own copy of the contract:

```bash
npx hardhat compile
npx hardhat run scripts/deploy.js --network baseSepolia
```

This deploys a fresh `NodePool` contract to Base Sepolia and writes the address to
`deployments.json`. You then need to update `CONTRACT_ADDRESS` in three places so the frontend
and every agent talk to the same contract:

- `frontend/index.html` — the `CONTRACT_ADDRESS` constant near the top of the script
- `agent/.env` — the `CONTRACT_ADDRESS` variable (or leave it unset and edit the default in
  `agent/agent.js` directly)
- `deployments.json` — already written by the deploy script, just confirm it matches

Any existing listings, rentals, and device key authorizations only exist on the old contract —
a redeploy starts the marketplace empty.

## Networks and tools

- Base Sepolia, chain ID 84532
- Contracts written in Solidity, built and deployed with Hardhat
- Provider SSH containers run `linuxserver/openssh-server`
- Tunnels are ngrok TCP endpoints
- SSH credential encryption uses tweetnacl (NaCl's box construction, X25519 + Poly1305)

## Known limitations

The device key's gas has to be funded manually right now — there's no automatic top-up, so a
provider needs to keep an eye on its balance for a machine that's been running a long time. Only
one container runs per machine at a time, which matches how the contract only allows one active
rental per machine — this isn't a shortcut, it's the actual rental model. And ngrok's free tier
has bandwidth and session limits that matter for heavy or long-running use; a paid plan or a
different tunnel provider can be swapped in without changing anything on-chain.
