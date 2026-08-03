// NodePool provider agent.
//
// Listing now happens in the browser (the provider's real wallet signs listMachine()
// directly) — this agent never touches that wallet and never sees a private key for it.
// All this agent holds is its own randomly-generated "device key" (agent/device-key.json,
// gitignored), which the provider must explicitly authorize on-chain (authorizeReporter, or
// the optional reporter field on listMachine) before it can do anything. That authorization
// only ever lets the device key call setMachineOnline/reportUptime for the ONE machine it was
// authorized for — see NodePool.sol's onlyAuthorizedReporter modifiers. It can never withdraw
// earnings, delist a machine, or change its price.
require('dotenv').config();

const http = require('http');
const path = require('path');
const fs = require('fs');
const { ethers } = require('ethers');

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0x897eDCEA8a08693358aC9b6cB9258c5378c09365';
const RPC_URL = process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com';
const HEALTH_PORT = Number(process.env.HEALTH_PORT || 3939);

const DEVICE_KEY_FILE = path.join(__dirname, 'device-key.json');
const MACHINE_ID_FILE = path.join(__dirname, 'machine-id.json');
const REPORT_INTERVAL_MS = 60_000;
const REGISTRATION_POLL_MS = 10_000;
const RENTAL_STATUS_ACTIVE = 1; // RentalStatus.Active in NodePool.sol's enum

// Only the pieces of the NodePool ABI this agent actually calls. It never calls listMachine —
// that's a browser-only, wallet-signed action now.
const CONTRACT_ABI = [
  'function rentalCount() view returns (uint256)',
  'function getRental(uint256) view returns (tuple(uint256 id, uint256 machineId, address renter, uint256 deposit, uint256 startTime, uint256 endTime, uint256 hoursPaid, uint256 hoursVerified, uint256 totalHours, uint8 status, uint256 lastHealthCheck, string initialMessage))',
  'function reportUptime(uint256 rentalId, bool isOnline)',
  'function setMachineOnline(uint256 machineId, bool isOnline)',
  'function machineCount() view returns (uint256)',
  'function reporterOf(uint256) view returns (address)',
  'function getMachine(uint256) view returns (tuple(uint256 id, address owner, string cpu, string ram, string storage_, string os, uint256 pricePerHour, string healthEndpoint, bool isAvailable, uint256 uptimeScore, uint256 totalEarnings, uint256 createdAt, bool online, uint256 lastSeen))',
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Loads the device key from disk, or generates a fresh random one on first run. This key is
// powerless until a machine owner authorizes it — see the module comment above.
function loadOrCreateDeviceKey() {
  try {
    const data = JSON.parse(fs.readFileSync(DEVICE_KEY_FILE, 'utf8'));
    if (data && data.privateKey) return new ethers.Wallet(data.privateKey);
  } catch {
    // No device key yet — normal on first run.
  }

  const wallet = ethers.Wallet.createRandom();
  fs.writeFileSync(
    DEVICE_KEY_FILE,
    JSON.stringify({ address: wallet.address, privateKey: wallet.privateKey }, null, 2)
  );
  console.log(`Generated a new device key: ${wallet.address}`);
  console.log(`  Saved to ${DEVICE_KEY_FILE} — keep this file, but note it's low-stakes: this key`);
  console.log('  can ONLY report uptime for machines you explicitly authorize. It can never');
  console.log('  withdraw funds, delist a machine, or change its price.');
  return wallet;
}

// Tiny health server the contract's health checks will eventually poll. Stage 1 only
// serves it on localhost — Stage 2 handles exposing it publicly.
function startHealthServer(port) {
  const startedAt = Date.now();
  const server = http.createServer((req, res) => {
    if (req.method === 'GET' && req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok', uptime: Math.floor((Date.now() - startedAt) / 1000) }));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  server.listen(port, () => {
    console.log(`Health server listening on http://localhost:${port}/health`);
  });
  return server;
}

// Actually hits the local health server rather than just assuming "process alive means
// healthy" — this is meant to reflect the same thing a real health check would see.
function checkOwnHealth(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://localhost:${port}/health`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(5000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function loadMachineId() {
  try {
    const data = JSON.parse(fs.readFileSync(MACHINE_ID_FILE, 'utf8'));
    if (data && data.machineId) return String(data.machineId);
  } catch {
    // No cached machine yet — normal until the provider authorizes this device.
  }
  return null;
}

function saveMachineId(machineId) {
  fs.writeFileSync(MACHINE_ID_FILE, JSON.stringify({ machineId: String(machineId) }, null, 2));
}

async function isAuthorizedForMachine(contract, deviceAddress, machineId) {
  try {
    const reporter = await contract.reporterOf(machineId);
    return reporter.toLowerCase() === deviceAddress.toLowerCase();
  } catch {
    return false; // machine doesn't exist on this contract
  }
}

// Every machine on the contract whose reporterOf currently points at this device key, lowest
// id first. This is how the agent finds "its" machine without ever listing one itself.
async function findAuthorizedMachineIds(contract, deviceAddress) {
  const count = Number(await contract.machineCount());
  const authorized = [];
  for (let id = 1; id <= count; id++) {
    if (await isAuthorizedForMachine(contract, deviceAddress, id)) authorized.push(id);
  }
  return authorized;
}

async function findActiveRentalIds(contract, machineId) {
  const count = Number(await contract.rentalCount());
  const activeIds = [];
  for (let id = 1; id <= count; id++) {
    const rental = await contract.getRental(id);
    if (Number(rental.machineId) === Number(machineId) && Number(rental.status) === RENTAL_STATUS_ACTIVE) {
      activeIds.push(id);
    }
  }
  return activeIds;
}

// reportUptime() is gated by NodePool.sol's onlyAuthorizedReporterForRental modifier — only the
// machine's owner or its authorized device key may call it for that machine's rentals. If this
// device key isn't (or is no longer) authorized, it reverts — surface that clearly (once)
// instead of just crashing or silently failing every cycle.
let reporterWarningShown = false;

async function reportUptimeForRental(contract, rentalId, isOnline) {
  try {
    const tx = await contract.reportUptime(rentalId, isOnline);
    await tx.wait();
    return { ok: true };
  } catch (err) {
    const reason = (err && err.reason) || (err && err.shortMessage) || (err && err.message) || 'unknown error';
    if (/not authorized reporter/i.test(reason) && !reporterWarningShown) {
      reporterWarningShown = true;
      console.warn(
        '  Note: reportUptime reverted with "Not authorized reporter". This device key is no ' +
        "longer authorized for this machine — the owner may have re-pointed it elsewhere via " +
        'authorizeReporter(). The agent will keep trying every cycle in case that changes.'
      );
    }
    return { ok: false, reason };
  }
}

// setMachineOnline() is gated the same way as reportUptime — owner or this machine's
// reporterOf. Same failure mode as above if the authorization was revoked or re-pointed.
async function setMachineOnlineStatus(contract, machineId, isOnline) {
  try {
    const tx = await contract.setMachineOnline(machineId, isOnline);
    await tx.wait();
    return { ok: true };
  } catch (err) {
    const reason = (err && err.reason) || (err && err.shortMessage) || (err && err.message) || 'unknown error';
    return { ok: false, reason };
  }
}

function timestamp() {
  return new Date().toLocaleTimeString();
}

// Blocks until some machine authorizes this device key, printing instructions periodically
// (not every poll — that would spam the log) rather than exiting and making the provider
// re-run the agent after authorizing.
async function waitForAuthorization(contract, deviceAddress) {
  let attempts = 0;
  while (true) {
    const authorized = await findAuthorizedMachineIds(contract, deviceAddress);
    if (authorized.length > 0) return authorized;

    if (attempts % 6 === 0) {
      console.log('');
      console.log('This device is not authorized to report for any machine yet.');
      console.log('Open the website, connect your wallet, and either:');
      console.log('  - Register Machine, pasting this device address, or');
      console.log('  - Authorize Device on an existing machine you own,');
      console.log(`  with this address: ${deviceAddress}`);
      console.log(`Checking again every ${REGISTRATION_POLL_MS / 1000}s...`);
    }
    attempts++;
    await sleep(REGISTRATION_POLL_MS);
  }
}

async function runUptimeLoop(contract, machineId) {
  console.log(`Starting uptime reporting for Machine ${machineId} (every ${REPORT_INTERVAL_MS / 1000}s, Ctrl+C to stop)...`);

  const tick = async () => {
    const healthy = await checkOwnHealth(HEALTH_PORT);
    if (!healthy) {
      console.log(`[${timestamp()}] Machine ${machineId} - local health check failed, skipping this cycle`);
      return;
    }

    // Heartbeat: refreshes lastSeen on-chain so the marketplace keeps showing this machine as
    // online. Runs every cycle regardless of active rentals - the marketplace listing depends
    // on it even when nobody is renting yet.
    const heartbeat = await setMachineOnlineStatus(contract, machineId, true);
    if (!heartbeat.ok) {
      console.log(`[${timestamp()}] Machine ${machineId} - heartbeat failed: ${heartbeat.reason}`);
    }

    let activeRentalIds;
    try {
      activeRentalIds = await findActiveRentalIds(contract, machineId);
    } catch (err) {
      console.log(`[${timestamp()}] Machine ${machineId} - couldn't read rentals: ${err.message}`);
      return;
    }

    if (activeRentalIds.length === 0) {
      console.log(`[${timestamp()}] Machine ${machineId} online - no active rentals`);
      return;
    }

    for (const rentalId of activeRentalIds) {
      const result = await reportUptimeForRental(contract, rentalId, true);
      console.log(
        result.ok
          ? `[${timestamp()}] Machine ${machineId} online - reported uptime for rental ${rentalId}`
          : `[${timestamp()}] Machine ${machineId} online - reportUptime for rental ${rentalId} failed: ${result.reason}`
      );
    }
  };

  await tick(); // first heartbeat immediately instead of waiting a full interval
  const interval = setInterval(tick, REPORT_INTERVAL_MS);

  let shuttingDown = false;
  const shutdown = async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log('\nShutting down...');
    clearInterval(interval);

    const offline = await setMachineOnlineStatus(contract, machineId, false);
    console.log(offline.ok ? `Marked machine ${machineId} offline` : `Could not mark machine ${machineId} offline: ${offline.reason}`);

    try {
      const activeRentalIds = await findActiveRentalIds(contract, machineId);
      for (const rentalId of activeRentalIds) {
        const result = await reportUptimeForRental(contract, rentalId, false);
        console.log(result.ok ? `Marked rental ${rentalId} offline` : `Could not mark rental ${rentalId} offline: ${result.reason}`);
      }
    } catch (err) {
      console.warn('Could not mark rentals offline on shutdown:', err.message);
    }
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

async function main() {
  const deviceWallet = loadOrCreateDeviceKey();
  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const signer = deviceWallet.connect(provider);
  // NonceManager tracks the next nonce locally instead of re-querying the RPC for every send -
  // without it, back-to-back sends (e.g. the startup heartbeat and a reportUptime call) can
  // race the provider's pending-nonce lookup and get "nonce too low" on the second transaction.
  const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, new ethers.NonceManager(signer));

  console.log(`Device address: ${deviceWallet.address}`);

  startHealthServer(HEALTH_PORT);
  console.log('Health server is running — keep this process alive so uptime checks can reach it.');

  let machineId = loadMachineId();

  // Verify the cached id is still authorized for this device key. It won't be after a contract
  // redeploy, if machine-id.json was hand-edited, or if the owner re-pointed reporterOf
  // elsewhere — blindly trusting it means heartbeating a machine that will just reject us.
  if (machineId && !(await isAuthorizedForMachine(contract, deviceWallet.address, machineId))) {
    console.log(`machine-id.json points at Machine ${machineId}, but this device is not authorized for it on ${CONTRACT_ADDRESS} — ignoring it.`);
    machineId = null;
  }

  if (!machineId) {
    const authorized = await findAuthorizedMachineIds(contract, deviceWallet.address);
    if (authorized.length > 0) {
      machineId = authorized[0]; // lowest id
      console.log(`Found authorization for Machine ${machineId}.`);
      if (authorized.length > 1) {
        console.log(`  Note: this device is authorized for ${authorized.length} machines: [${authorized.join(', ')}]. Using the lowest id.`);
      }
      saveMachineId(machineId);
    }
  }

  if (!machineId) {
    const authorized = await waitForAuthorization(contract, deviceWallet.address);
    machineId = authorized[0];
    console.log(`Authorized for Machine ${machineId}.`);
    saveMachineId(machineId);
  }

  const startup = await setMachineOnlineStatus(contract, machineId, true);
  console.log(startup.ok ? `Marked machine ${machineId} online` : `Could not mark machine ${machineId} online: ${startup.reason}`);

  await runUptimeLoop(contract, machineId);
}

main().catch((err) => {
  console.error('Agent failed:', err.message || err);
  process.exit(1);
});
