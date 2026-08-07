# NodePool

Rent out your idle computer, or rent someone else's. NodePool turns a computer that's just sitting there into a small server anyone can rent by the hour, and pays the owner for every hour it's online. No company in the middle. A smart contract holds the money, checks the machine is online, and pays out automatically.

NodePool runs on two chains. Connect your wallet to either one and you are in that chain's compute marketplace:

- Base Sepolia, where gas and rent are paid in ETH.
- Arc Testnet (Circle's Layer-1), where gas and rent are paid in USDC.

Each chain is its own separate marketplace with its own machines and rentals. Use the network switcher in the top right of the site to move between them.

Live app: nodepool.vercel.app

## Contract addresses

- Base Sepolia (chain 84532): 0x2D16D7F81ac8a13b1A99E74dFDc94eb6107A8243
- Arc Testnet (chain 5042002): 0x6b37F3b13CbFB4663C0b7951a885BD646cb6FdC9

## What this is

If you have a computer that's idle, list it and earn. If you need a server, rent one and get real SSH access, like a cheap VPS. Only the renter's wallet can unlock the login details, and the renter is locked in a sandbox that can't touch the owner's real files.

Two roles:

- Provider: runs the agent on their machine and lists it. Earns per hour it's online.
- Renter: rents a machine from the website and gets SSH access. Pays per hour.

The contract holds the deposit in escrow, pays the provider per verified second of uptime, and refunds the rest when the rental ends.

## Part 1: Rent a machine (renter)

You only need a wallet and an SSH client. SSH is already on Mac and Linux. On Windows, use PowerShell (it has ssh built in) or WSL.

1. Open nodepool.vercel.app and connect your wallet. Pick your network with the switcher in the top right (Base Sepolia or Arc Testnet). You need a little of that chain's gas token for the deposit and gas: ETH on Base Sepolia, USDC on Arc.
   - Base Sepolia faucet: https://www.alchemy.com/faucets/base-sepolia
   - Arc Testnet faucet (USDC): https://faucet.circle.com
2. Go to the Marketplace tab and pick a machine that shows Online.
3. Choose how many hours and confirm. Your wallet signs a free message first (this makes your decryption key), then confirms the payment transaction.
4. Wait for the provider to accept. Their agent builds your container, usually within a minute.
5. Go to My Rentals, open the rental, and click Show SSH Access. Sign the message. The app shows your host, port, username, password, and a copy-ready command.
6. In your terminal, run the command it gives you:

   ssh -p PORT renter@HOST

   Paste the password when asked. You now have a shell on the rented machine.

When the rental ends, runs out, or is cancelled, the container is destroyed and your access is gone. To keep using it, rent again.

## Part 2: Rent out your computer (provider)

Full setup from a clean machine. Do every step in order. Commands are for Linux or WSL on Windows.

### Step 1: Install Git and Node

Check what you already have:

    git --version
    node --version

If Git is missing:

    sudo apt update
    sudo apt install -y git

If Node is missing, install Node 20 LTS:

    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs

If you already have Git and Node installed, skip this step.

### Step 2: Download NodePool

If you have NOT already downloaded the project:

    git clone https://github.com/Aabis5004/nodepool
    cd nodepool

If you already have the project, just go into its folder:

    cd nodepool

Everything below runs from inside this project folder.

### Step 3: Install Docker

Docker runs the isolated container that each renter logs into. The agent starts and stops these containers for you automatically.

    sudo apt update
    sudo apt install -y docker.io
    sudo service docker start
    sudo usermod -aG docker $USER

Log out and back in (or reopen your terminal), then confirm Docker works:

    docker ps

If that prints a table header instead of an error, Docker is ready. On Mac or Windows, install Docker Desktop and leave it running instead.

### Step 4: Install ngrok and connect your account

ngrok gives your container a public internet address so a renter can connect from anywhere. The agent runs ngrok for you automatically. You only set it up once.

Install it:

    curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
    echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
    sudo apt update
    sudo apt install -y ngrok

Then create a free account at https://ngrok.com, copy your authtoken from the dashboard, and run:

    ngrok config add-authtoken PASTE_YOUR_TOKEN_HERE

If you already installed and configured ngrok before, skip this step.

### Step 5: Add a card to ngrok (required, easy to miss)

ngrok will not open the kind of connection SSH needs unless a payment card is on file, even on the free tier. If you skip this, the first rental fails with an error containing ERR_NGROK_8013. In the ngrok dashboard, go to Billing and add a card. The free tier is not charged. Do this once.

### Step 6: Set up the agent

    cd agent
    npm install

About the .env file: you do NOT need to create or edit one. The agent already knows both chains' contract addresses and RPC endpoints, and it picks the chain from a command argument when you start it (see Step 7). There is no private key to set and nothing secret to fill in. The agent generates its own device key on first run and saves it to agent/device-key.json.

If you want to override the default RPC endpoints, you can copy the example and edit it, but this is optional:

    cp .env.example .env

Most providers never need to touch .env.

### Step 7: Run the agent on the chain you want

The agent runs on ONE chain per run. You choose the chain with the command:

    cd ~/hackathon/agent
    node agent.js arc


    node agent.js base     run on Base Sepolia (gas and rent in ETH)
    node agent.js arc      run on Arc Testnet (gas and rent in USDC)

Run one of these depending on which chain you want to list your machine on. On startup it prints which chain it is on, the currency, and a device address like 0xFE1b...4b9F. Copy that device address and leave the agent running. Closing it takes your machine offline.

To serve both chains at the same time, open two terminals and run one command in each (one on base, one on arc). Each run is independent.

### Step 8: Register your machine on the website

1. Open nodepool.vercel.app and use the network switcher (top right) to select the SAME chain you started the agent on.
2. Connect your wallet on that chain.
3. Go to My Machines and click Register Machine.
4. Fill in CPU, RAM, storage, OS, and price per hour.
5. Paste the device address from Step 7 into the Device Address field.
6. Submit and confirm the transaction.

This lists your machine and authorizes your agent in a single transaction. Within about ten seconds the agent prints that it found the authorization and marks the machine online.

### Step 9: Fund the device wallet with that chain's gas

The device address needs a small amount of the chain's gas token to send its uptime and provisioning transactions. It is the same device address on both chains, but each chain has its own balance, so fund whichever chain you are running on:

- Base Sepolia: send about 0.003 ETH to the device address. Faucet: https://www.alchemy.com/faucets/base-sepolia
- Arc Testnet: send testnet USDC to the device address. Faucet: https://faucet.circle.com

If the device wallet has no gas on the chain you started, the agent prints a clear warning naming the right faucet, and the machine stays offline until you fund it.

### Step 10: Confirm you're online

Within a minute your machine shows Online on the site (on the matching chain) and is rentable. If it stays offline, check the agent's terminal. The most common reason is the device wallet having no gas on that chain (Step 9). Leave the agent running. When someone rents your machine, the agent automatically starts a container, opens the ngrok tunnel, and delivers the encrypted login. You never run Docker or ngrok commands yourself.

## Security

The agent never uses your real wallet. It makes its own low-power device key that can only report status, report uptime, and write encrypted login details for the machines you authorized. It cannot withdraw your earnings, delist your machine, or move money. Those need your real wallet. The same device key works across both chains; you authorize it on each chain's machine.

A renter's SSH login is encrypted so only their wallet can read it. Their browser makes an encryption key from a wallet signature, and the agent encrypts the login to it. The encrypted data is public on-chain but useless to anyone but the renting wallet. Works with any wallet.

The renter runs inside a container with capped memory, CPU, and processes, and no access to your real files. They get a full shell in the sandbox and nothing outside it.

## Networks and tools

- Base Sepolia, chain ID 84532, gas token ETH
- Arc Testnet, chain ID 5042002, gas token USDC, RPC https://rpc.testnet.arc.io, explorer https://testnet.arcscan.app
- Solidity contract, built and deployed with Hardhat
- Renter containers run linuxserver/openssh-server
- Public access via ngrok TCP tunnels
- Login encryption with tweetnacl (X25519 and Poly1305)

## Known limitations

The device wallet's gas is funded manually per chain, so keep an eye on its balance on whichever chain you run. One rental per machine at a time. The agent runs one chain per process; serving both chains at once means running two instances. ngrok's free tier allows one tunnel at a time, so concurrent rentals across chains would need a paid ngrok plan or a second tunnel.
