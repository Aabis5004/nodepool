Fix the provider agent in agent/agent.js - it created duplicate machines and only tracks one.

Problems:
1. The agent listed the same laptop 3 times (IDs 5, 6, and more) because early runs happened before machine-id.json existed.
2. The uptime loop only checks ONE machine ID from machine-id.json, but a rental might be on a different owned machine ID, so it says "no active rentals" even when a rental is active.

Fix:
1. On startup, query the contract for ALL machines owned by this agent's wallet (iterate machineCount / getMachine, filter by owner === agent address). Store all owned IDs.
2. In the uptime loop, check active rentals across ALL owned machine IDs, not just one. Report uptime for any active rental on any owned machine.
3. Add a command/flag to delist duplicate machines: if run with "node agent.js --cleanup", delist all owned machines EXCEPT the lowest ID, so only one listing remains.
4. Keep machine-id.json but make it store an array of owned IDs, or just always query owned machines fresh on startup so it self-heals.
5. Print clearly: "Owned machines: [5,6,...]. Active rentals: rental 1 on machine 6" so it's obvious what's happening.
