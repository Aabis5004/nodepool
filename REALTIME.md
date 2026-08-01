Fix three real-time issues in NodePool.

## 1. Machine shows ONLINE even when agent stopped
The agent must control the online/offline status truthfully.
- When the agent starts, mark its machines online.
- When the agent stops (Ctrl+C / SIGINT / SIGTERM), mark its machines offline via a contract call.
- The contract needs an online/offline status per machine that the agent (as keeper or owner) can set. Check NodePool.sol - if there's no setMachineOnline/setOnline function, add one that only the machine owner or keeper can call, and emit an event.
- The website should show ONLINE only if the machine was marked online recently (within the last ~3 minutes). If no heartbeat/status update in 3 min, show OFFLINE. Store a lastSeen timestamp on-chain updated by the agent's heartbeat.

## 2. Website does not update until manual refresh
- Add auto-refresh: re-fetch marketplace, my machines, my rentals, and dashboard data every 20 seconds automatically.
- After any user action (rent, list, delist, accept, cancel), immediately re-fetch that section instead of waiting.

## 3. Only show machines that are actually available/relevant
- Marketplace should only show machines that are ONLINE and available to rent (not delisted, not offline).
- My Machines should clearly separate active listings from delisted ones, or hide delisted ones by default.
- A machine should only be rentable when its agent is live (online within last 3 min).

Update both agent/agent.js and frontend/index.html and contracts/NodePool.sol as needed.
If the contract changes, note that it needs redeployment and I will handle that.
