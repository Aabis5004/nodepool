# NodePool

Rent out your idle computer, or rent someone else's. NodePool turns a computer that's just sitting there into a small server anyone can rent by the hour, and pays the owner for every hour it's online. No company in the middle. A smart contract on Base Sepolia holds the money, checks the machine is online, and pays out automatically.

Live app: nodepool.vercel.app

Contract (Base Sepolia, chain 84532): 0x54436C58A3671B24E9004858a55889C44585E7E5

## What this is

If you have a computer that's idle, list it and earn. If you need a server, rent one and get real SSH access, like a cheap VPS. Only the renter's wallet can unlock the login details, and the renter is locked in a sandbox that can't touch the owner's real files.

Two roles:

- Provider: runs the agent on their machine and lists it. Earns per hour it's online.
- Renter: rents a machine from the website and gets SSH access. Pays per hour.

The contract holds the deposit in escrow, pays the provider hour by hour as the machine proves it's online, and refunds the rest when the rental ends.

## Part 1: Rent a machine (renter)

You only need a wallet and an SSH client. SSH is already on Mac and Linux. On Windows, use PowerShell (it has ssh built in) or WSL.

1. Open nodepool.vercel.app and connect your wallet. You need a little Base Sepolia ETH for the deposit and gas. Get it free at https://www.alchemy.com/faucets/base-sepolia
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

Check what you have:

    git --version
    node --version

If Git is missing:

    sudo apt update
    sudo apt install -y git

If Node is missing, install Node 20 LTS:

    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt install -y nodejs

### Step 2: Download NodePool

    git clone https://github.com/Aabis5004/nodepool
    cd nodepool

### Step 3: Install Docker

Docker runs the isolated container each renter logs into. The agent starts and stops these for you automatically.

    sudo apt update
    sudo apt install -y docker.io
    sudo service docker start
    sudo usermod -aG docker $USER

Log out and back in (or reopen your terminal), then confirm:

    docker ps

If that prints a table header instead of an error, Docker is ready. (On Mac/Windows: install Docker Desktop and leave it running.)

### Step 4: Install ngrok and connect your account

ngrok gives your container a public address so renters can connect. The agent runs it for you automatically; you set it up once.

Install it:

    curl -sSL https://ngrok-agent.s3.amazonaws.com/ngrok.asc | sudo tee /etc/apt/trusted.gpg.d/ngrok.asc >/dev/null
    echo "deb https://ngrok-agent.s3.amazonaws.com buster main" | sudo tee /etc/apt/sources.list.d/ngrok.list
    sudo apt update
    sudo apt install -y ngrok

Then sign up at https://ngrok.com, copy your authtoken from the dashboard, and run:

    ngrok config add-authtoken PASTE_YOUR_TOKEN_HERE

### Step 5: Add a card to ngrok (required, easy to miss)

ngrok will not open the connection SSH needs unless a payment card is on file, even on the free tier. Skip this and the first rental fails with an error containing ERR_NGROK_8013. In the ngrok dashboard, go to Billing and add a card. The free tier is not charged. Do this once.

### Step 6: Set up the agent

    cd agent
    npm install
    cp .env.example .env

The .env has no private key and nothing secret. The defaults already point at the live contract. The agent makes its own key on first run.

### Step 7: Run the agent

Make sure Docker is running (docker ps), then:

    npm start

It prints a device address like 0xAB61...6602 and says it is not authorized yet. Copy that address and leave the agent running.

### Step 8: Register your machine

On nodepool.vercel.app, connect your wallet, go to My Machines, click Register Machine. Fill in specs and price, paste the device address from Step 7 into the Device Address field, and submit. This lists and authorizes in one transaction. Within about ten seconds the agent prints "Authorized for Machine N".

### Step 9: Fund the device wallet

The device address needs a small amount of Base Sepolia ETH for gas. Send about 0.002 ETH to it. Faucet: https://www.alchemy.com/faucets/base-sepolia

### Step 10: Confirm you're online

Within a minute your machine shows Online and is rentable. If it stays offline, check the agent terminal; the usual cause is the device wallet having no ETH (Step 9). Leave the agent running. When someone rents, the agent starts the container and tunnel automatically. You never run Docker or ngrok commands yourself.

## Security

The agent never uses your real wallet. It makes its own low-power device key that can only report status, report uptime, and write encrypted login details for the one machine you authorized. It cannot withdraw earnings, delist, or move money. Those need your real wallet. If a device key is lost, re-authorize a new one from the site in one click.

A renter's SSH login is encrypted so only their wallet can read it. Their browser makes an encryption key from a wallet signature, and the agent encrypts the login to it. The ciphertext is public on-chain but useless to anyone but the renting wallet. Works with any wallet.

The renter runs in a container with capped memory, CPU, and processes, and no access to your real files.

## Deploy your own contract

Only if you want a separate marketplace.

    npm install
    npx hardhat compile
    npx hardhat run scripts/deploy.js --network baseSepolia

The deployer wallet needs Base Sepolia ETH. After deploying, set the new address in frontend/index.html, agent/.env, and deployments.json so all three match. A fresh deploy starts empty.

## Tools used

- Base Sepolia, chain ID 84532
- Solidity contract, built with Hardhat
- Renter containers run linuxserver/openssh-server
- Public access via ngrok TCP tunnels
- Login encryption with tweetnacl (X25519 + Poly1305)

## Known limitations

The device wallet's gas is funded manually for now. One rental per machine at a time. ngrok's free tier has usage limits; a paid plan or another tunnel can be swapped in without code changes.
ENDOFREADME
echo "README written"; head -5 ~/hackathon/README.md</parameter>
