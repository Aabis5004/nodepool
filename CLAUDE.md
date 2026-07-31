# NodePool — Decentralized Compute Marketplace

## What this is
A peer-to-peer marketplace where people rent out their idle computers and others rent them as servers. No middleman. Payment in crypto, only for actual uptime. Built on Base Sepolia testnet now, designed for Rialo mainnet where health checks and auto-payments become native to the chain.

## The pitch
"Akash and Gensyn need massive infrastructure to run their marketplace. NodePool's smart contract IS the infrastructure."

## How it works — the full flow

### Provider side (person with an idle PC)
1. Signs up (email or wallet)
2. Lists their machine: CPU, RAM, storage, OS, price per hour in ETH
3. Runs a tiny health agent on their machine (a simple script that responds to /health)
4. Sets availability hours (e.g. "my gaming PC is free 9am-5pm weekdays")
5. Gets paid automatically for every hour the machine is verified online

### Renter side (person who needs a server)
1. Signs up (email or wallet)
2. Browses available machines, filters by specs and price
3. Picks a machine, reviews the provider's uptime history and rating
4. Sends a rental request with a message ("need this for 48 hours for a Node.js project")
5. Provider accepts or declines (in-app chat)
6. Once both agree: renter deposits payment into escrow contract
7. Contract starts monitoring the health endpoint
8. Pays provider only for verified uptime hours
9. If machine goes down: payment pauses, renter gets notified
10. When done: renter ends the rental, remaining deposit refunds

### Chat system
- Simple in-app messaging between provider and renter
- Used for: negotiation before renting, support during rental, dispute resolution
- Messages stored on-chain or IPFS (for hackathon: localStorage is fine)

## Tech stack
- Smart contract: Solidity, Hardhat, deploy to Base Sepolia (chainId 84532)
- Frontend: single HTML file with ethers.js from CDN
- Chat: simple localStorage-based for hackathon, upgradeable to XMTP or Push Protocol later
- No heavy frameworks — keep it lean

## Smart contract: NodePool.sol

### Data structures
- Machine: id, owner, cpu, ram, storage, os, pricePerHour (in wei), healthEndpoint (string), isAvailable, uptimeScore, totalEarnings, createdAt
- Rental: id, machineId, renter, deposit, startTime, endTime, hoursPaid, hoursVerified, status (requested/active/completed/disputed/cancelled), lastHealthCheck
- Message: rentalId, sender, text, timestamp

### Core functions
- listMachine(cpu, ram, storage, os, pricePerHour, healthEndpoint) → registers a machine
- updateMachine(machineId, ...) → update specs/price/availability
- delistMachine(machineId) → take offline
- requestRental(machineId, hours, message) payable → renter deposits and sends request
- acceptRental(rentalId) → provider accepts, rental starts
- declineRental(rentalId) → provider declines, deposit refunds
- reportUptime(rentalId, isOnline) → oracle/keeper reports health check result (simulated for testnet; native HTTPS on Rialo)
- endRental(rentalId) → either party can end, settles payment based on verified hours
- disputeRental(rentalId, reason) → flags for review
- sendMessage(rentalId, text) → on-chain chat message
- withdrawEarnings() → provider withdraws accumulated payments
- getMyMachines(owner) → view helper
- getAvailableMachines() → marketplace listing
- getRental(rentalId) → rental details
- getMessages(rentalId) → chat history
- getProviderStats(owner) → uptime %, total earnings, total rentals

### Events
- MachineCreated, MachineUpdated, MachineDelisted
- RentalRequested, RentalAccepted, RentalDeclined
- RentalStarted, RentalEnded, RentalDisputed
- UptimeReported, PaymentReleased
- MessageSent

### Payment logic
- Renter deposits full amount upfront (hours × pricePerHour)
- Contract releases payment to provider hourly, only for verified-online hours
- If machine goes offline: that hour is not paid
- On rental end: unpaid hours refunded to renter
- Provider calls withdrawEarnings() to collect

## Frontend: index.html

### Design
- Premium dark theme matching crypto dashboard aesthetic
- Color palette: deep navy/charcoal background, purple/blue gradients for accents, green for online/success, red for offline/errors, amber for warnings
- Glassmorphism panels, subtle glows, smooth animations
- Clean, spacious layout — not cluttered
- Responsive for mobile

### Logo
- Stylized "NP" or a node/network icon
- Purple to blue gradient
- Clean and modern

### Pages/sections (all in one HTML file, tab-based)

#### 1. Marketplace (default tab)
- Grid of available machines as cards
- Each card shows: CPU, RAM, storage, OS icon, price/hr, uptime score, provider rating
- Filter bar: min RAM, max price, OS type
- Search by specs
- Click a card → opens rental modal

#### 2. My Machines (provider view)
- List your machines
- Add new machine form: CPU, RAM, storage, OS, price per hour, health endpoint URL
- Status indicator (online/offline) per machine
- Earnings per machine
- Edit/delist buttons

#### 3. My Rentals (renter view)
- Active rentals with live status
- For each: machine specs, time remaining, uptime %, amount paid so far, amount remaining
- End rental button
- Chat button → opens chat panel

#### 4. Chat
- Simple chat interface per rental
- Provider and renter can message
- Shows rental context at top (machine, price, duration)
- Send message input at bottom

#### 5. Dashboard/Stats
- Total machines on the network
- Total active rentals
- Network uptime average
- Total ETH transacted
- Your earnings (if provider) / your spending (if renter)

### Rental flow in the UI
1. Renter clicks "Rent" on a machine card
2. Modal opens: shows machine details, price, lets renter pick hours and write a message
3. Renter confirms → MetaMask pops up to deposit
4. Provider sees the request in "My Machines" tab with the message
5. Provider accepts → rental starts, status goes green
6. Dashboard shows live uptime monitoring
7. Either party can open chat
8. When done: renter clicks "End rental" → settlement happens, refund if any

## Important
- Use Hardhat with Base Sepolia (chainId 84532)
- Include deploy script with seed data (3 example machines)
- Include .env.example for private key and RPC
- The health check is simulated on testnet (a reportUptime function that an off-chain script calls). On Rialo this becomes a native HTTPS call from the contract itself — that's the whole value proposition
- For chat: store messages on-chain for simplicity (emit events, read from logs). This is a hackathon — gas cost on testnet is free
- Keep the code clean and well-commented
- Make the UI look premium — this is a hackathon demo, first impressions matter
