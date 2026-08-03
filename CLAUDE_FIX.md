Goal: make NodePool safe for real public providers. NO ONE should ever paste a
private key into a file. Redesign machine listing + uptime so the provider's real
wallet signs in the browser, and the agent only holds a powerless "device key"
that can report uptime and nothing else.

Read the whole project first: frontend/index.html, agent/agent.js, contracts/
(the NodePool.sol contract), and scripts/deploy.js. Then propose a plan before
writing code, and confirm the contract changes with me.

## Target design
1. LISTING IN BROWSER (wallet-signed):
   - Add a provider "Register Machine" flow in the frontend where the connected
     wallet signs listMachine() directly. Specs can be entered OR read from an
     agent-provided payload, but the on-chain signature must come from the
     provider's browser wallet. No private key in any file.

2. DEVICE KEY FOR HEARTBEAT (powerless):
   - agent.js generates its own random keypair on first run (store the device
     key in agent/device-key.json, gitignored). This device key ONLY reports
     uptime. It must NOT be able to withdraw, delist, or move funds.
   - The agent prints its device address so the provider can authorize it.

3. CONTRACT CHANGE (confirm with me before implementing):
   - Replace the single global keeper for uptime with a per-machine authorized
     reporter. Add e.g. authorizeReporter(machineId, reporterAddress) callable by
     the machine owner, and gate reportUptime/setMachineOnline so the machine's
     authorized reporter (the device key) can call them for THAT machine only.
   - Keep withdrawEarnings, funds, and delist owner-only. The device key can
     never touch money.

4. AGENT:
   - On start, if the machine isn't registered yet, print instructions: "Open the
     website, connect your wallet, Register Machine, and authorize this device
     address: 0x...". Once authorized, the agent heartbeats with the device key.
   - Remove the requirement for PROVIDER_PRIVATE_KEY in .env.

## Also fix
- The OVERFLOW(17) panic in reportUptime on existing rentals — find the unchecked
  arithmetic in NodePool.sol and fix it so uptime reporting can't overflow.

## Constraints
- Do not break the existing renter flow (browse, requestRental, withdraw).
- This needs a fresh contract deploy (scripts/deploy.js) since the contract
  changes; update the CONTRACT_ADDRESS in frontend and agent after deploy.

## Deliver in phases, confirm the contract design with me before deploying.
