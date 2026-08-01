# NodePool Provider Agent

Build a provider agent that runs on a real machine, reads its real specs, and registers it to the NodePool contract on Base Sepolia. This makes machine listings real instead of manually typed.

## Contract details
- Address: 0xadC135620B239946321EcF57E7d424FA9d165850
- Network: Base Sepolia (chainId 84532)
- Key function: listMachine(cpu, ram, storage, os, pricePerHour, healthEndpoint)
- The ABI is in the frontend/index.html file - extract the listMachine signature from there

## Build in a new folder: agent/

## Stage 1 - Auto-list with real specs (build this first)
Create agent/agent.js (Node.js) that:
1. Reads the REAL machine specs using Node's os module:
   - CPU: os.cpus()[0].model and os.cpus().length cores
   - RAM: os.totalmem() converted to GB
   - Platform/OS: os.platform() and os.release()
2. Reads disk space (use a simple library or df command)
3. Starts a tiny local health server on port 3939 that returns {"status":"ok","uptime":<seconds>} at GET /health
4. Connects to Base Sepolia using ethers.js and a private key from a .env file (PROVIDER_PRIVATE_KEY)
5. Calls listMachine() on the contract with the real specs and a price the user sets in .env (PRICE_PER_HOUR)
6. For the health endpoint, use the machine's public URL - for now use a placeholder like http://localhost:3939/health and print a note that Stage 2 will handle public exposure
7. Prints clear output: "Reading specs... CPU: X, RAM: Y, Listing to contract... Done! Machine ID: N"

## Files needed
- agent/agent.js - main agent
- agent/package.json - with ethers and dotenv deps
- agent/.env.example - PROVIDER_PRIVATE_KEY and PRICE_PER_HOUR and CONTRACT_ADDRESS
- agent/README.md - how to run it

## Keep it simple and working. Stage 2 (uptime reporting) and Stage 3 (running jobs) come later.

## Stage 2 - Real uptime reporting (build this next)
Extend agent/agent.js so that after listing (or if already listed), it:
1. Every 60 seconds, checks its own health server is responding
2. Calls the contract's uptime-reporting function (find it in the ABI - likely reportUptime or similar) to record that the machine is online for its active rentals
3. If the machine has no active rentals, just keeps the health server alive and logs "online, no active rentals"
4. Prints a heartbeat log each cycle: "[time] Machine 5 online - reported uptime" or "no active rentals"
5. On Ctrl+C, cleanly shuts down and optionally marks itself offline
6. Store the machine ID from Stage 1 (in a local file agent/machine-id.json) so restarting the agent reuses the same listing instead of creating a duplicate

Also: before listing in Stage 1, check machine-id.json - if it exists, skip listing and go straight to uptime reporting for that existing machine ID.
