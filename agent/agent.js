// NodePool provider agent.
// Stage 1: auto-list this machine with its real specs.
// Stage 2: report uptime for its active rentals on a heartbeat, reusing the same listing
//          across restarts instead of creating a duplicate machine every run.
require('dotenv').config();

const os = require('os');
const http = require('http');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { ethers } = require('ethers');

const PRIVATE_KEY = process.env.PROVIDER_PRIVATE_KEY;
const PRICE_PER_HOUR = process.env.PRICE_PER_HOUR || '0.001';
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0xc8D26E0aEbB17B6c68F9EBb8483Ac5298537F3A8';
const RPC_URL = process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com';
const HEALTH_PORT = Number(process.env.HEALTH_PORT || 3939);

const MACHINE_ID_FILE = path.join(__dirname, 'machine-id.json');
const REPORT_INTERVAL_MS = 60_000;
const RENTAL_STATUS_ACTIVE = 1; // RentalStatus.Active in NodePool.sol's enum

// Only the pieces of the NodePool ABI this agent actually calls.
const CONTRACT_ABI = [
  'function listMachine(string cpu, string ram, string storage_, string os, uint256 pricePerHour, string healthEndpoint) returns (uint256)',
  'function rentalCount() view returns (uint256)',
  'function getRental(uint256) view returns (tuple(uint256 id, uint256 machineId, address renter, uint256 deposit, uint256 startTime, uint256 endTime, uint256 hoursPaid, uint256 hoursVerified, uint256 totalHours, uint8 status, uint256 lastHealthCheck, string initialMessage))',
  'function reportUptime(uint256 rentalId, bool isOnline)',
  'function setMachineOnline(uint256 machineId, bool isOnline)',
  'function machineCount() view returns (uint256)',
  'function getMyMachines(address owner) view returns (uint256[])',
  'function getMachine(uint256) view returns (tuple(uint256 id, address owner, string cpu, string ram, string storage_, string os, uint256 pricePerHour, string healthEndpoint, bool isAvailable, uint256 uptimeScore, uint256 totalEarnings, uint256 createdAt, bool online, uint256 lastSeen))',
  'event MachineCreated(uint256 indexed machineId, address indexed owner, string cpu, string ram, uint256 pricePerHour)',
];

function readCpu() {
  const cpus = os.cpus();
  const model = cpus.length ? cpus[0].model.trim() : 'Unknown CPU';
  return `${model} (${cpus.length} cores)`;
}

function readRam() {
  const gb = os.totalmem() / 1024 ** 3;
  return `${gb.toFixed(1)}GB`;
}

function readOs() {
  return `${os.platform()} ${os.release()}`;
}

// Total disk space of the root volume, in GB. Falls back to "Unknown" if `df` isn't
// available (e.g. plain Windows) so a missing disk tool doesn't crash the whole agent.
function readStorage() {
  try {
    if (os.platform() === 'win32') {
      return 'Unknown (run on macOS/Linux for automatic disk detection)';
    }
    const lines = execSync('df -k /').toString().trim().split('\n');
    const cols = lines[1].trim().split(/\s+/);
    const totalKb = Number(cols[1]);
    const gb = totalKb / (1024 * 1024);
    return `${gb.toFixed(0)}GB`;
  } catch (err) {
    console.warn('Could not read disk space (df failed), using placeholder:', err.message);
    return 'Unknown';
  }
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
    // No existing listing yet — that's the normal first-run case.
  }
  return null;
}

function saveMachineId(machineId) {
  fs.writeFileSync(MACHINE_ID_FILE, JSON.stringify({ machineId: String(machineId) }, null, 2));
}

async function listMachine(contract, wallet) {
  console.log('Reading specs...');
  const cpu = readCpu();
  const ram = readRam();
  const storage = readStorage();
  const osInfo = readOs();
  console.log(`  CPU: ${cpu}`);
  console.log(`  RAM: ${ram}`);
  console.log(`  Storage: ${storage}`);
  console.log(`  OS: ${osInfo}`);

  const healthEndpoint = process.env.HEALTH_ENDPOINT || `http://localhost:${HEALTH_PORT}/health`;
  console.log(`  Health endpoint: ${healthEndpoint} (placeholder — Stage 2 handles reporting, not public exposure yet)`);

  const priceWei = ethers.parseEther(String(PRICE_PER_HOUR));

  console.log(`Listing to contract ${CONTRACT_ADDRESS} as ${wallet.address}...`);
  const tx = await contract.listMachine(cpu, ram, storage, osInfo, priceWei, healthEndpoint);
  console.log(`  Tx sent: ${tx.hash}`);
  const receipt = await tx.wait();

  const created = receipt.logs
    .map((log) => {
      try { return contract.interface.parseLog(log); } catch { return null; }
    })
    .find((parsed) => parsed && parsed.name === 'MachineCreated');

  if (!created) {
    throw new Error(`listMachine succeeded but no MachineCreated event was found — check the tx on BaseScan: https://sepolia.basescan.org/tx/${tx.hash}`);
  }

  const machineId = created.args.machineId.toString();
  console.log(`Done! Machine ID: ${machineId}`);
  console.log(`  https://sepolia.basescan.org/tx/${tx.hash}`);
  return machineId;
}

// Every machine on the contract currently owned by this wallet, lowest id first.
// getMyMachines() is the cheap path; fall back to scanning if that call isn't available.
async function findOwnedMachineIds(contract, owner) {
  try {
    const ids = await contract.getMyMachines(owner);
    const mine = [];
    for (const id of ids) {
      const m = await contract.getMachine(id).catch(() => null);
      if (m && m.owner.toLowerCase() === owner.toLowerCase()) mine.push(Number(id));
    }
    return mine.sort((a, b) => a - b);
  } catch {
    const count = Number(await contract.machineCount());
    const mine = [];
    for (let id = 1; id <= count; id++) {
      const m = await contract.getMachine(id).catch(() => null);
      if (m && m.owner.toLowerCase() === owner.toLowerCase()) mine.push(id);
    }
    return mine;
  }
}

async function ownsMachine(contract, owner, machineId) {
  try {
    const m = await contract.getMachine(machineId);
    return m && m.owner.toLowerCase() === owner.toLowerCase();
  } catch {
    return false; // id doesn't exist on this contract
  }
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

// reportUptime() is gated by NodePool.sol's onlyKeeper modifier — only the contract's
// designated keeper address may call it (see setKeeper()). A provider's own wallet is
// usually NOT the keeper, so this will typically revert unless the deployer has
// explicitly authorized this wallet. That's a real on-chain permission, not a bug here —
// surface it clearly (once) instead of just crashing or silently failing every cycle.
let keeperWarningShown = false;

async function reportUptimeForRental(contract, rentalId, isOnline) {
  try {
    const tx = await contract.reportUptime(rentalId, isOnline);
    await tx.wait();
    return { ok: true };
  } catch (err) {
    const reason = (err && err.reason) || (err && err.shortMessage) || (err && err.message) || 'unknown error';
    if (/not authorized keeper/i.test(reason) && !keeperWarningShown) {
      keeperWarningShown = true;
      console.warn(
        '  Note: reportUptime reverted with "Not authorized keeper". That call is restricted to the ' +
        "contract's keeper address (NodePool.sol's onlyKeeper modifier) — this agent's wallet isn't " +
        'authorized to call it unless the keeper has run setKeeper(<this wallet>). The agent will keep ' +
        'trying every cycle in case that changes.'
      );
    }
    return { ok: false, reason };
  }
}

// setMachineOnline() only requires the machine owner or keeper - the agent's own wallet is
// always the owner (it listed the machine), so unlike reportUptime this should never revert
// on authorization grounds.
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
  if (!PRIVATE_KEY) {
    console.error('Missing PROVIDER_PRIVATE_KEY. Copy agent/.env.example to agent/.env and fill it in.');
    process.exit(1);
  }

  const provider = new ethers.JsonRpcProvider(RPC_URL);
  const wallet = new ethers.Wallet(PRIVATE_KEY, provider);
  // NonceManager tracks the next nonce locally instead of re-querying the RPC for every send -
  // without it, sending listMachine and the startup heartbeat back-to-back can race the
  // provider's pending-nonce lookup and get "nonce too low" on the second transaction.
  const contract = new ethers.Contract(CONTRACT_ADDRESS, CONTRACT_ABI, new ethers.NonceManager(wallet));

  startHealthServer(HEALTH_PORT);
  console.log('Health server is running — keep this process alive so uptime checks can reach it.');

  let machineId = loadMachineId();

  // Verify the cached id still belongs to us. It won't after a contract redeploy (ids restart
  // from 1 on the new address) or if machine-id.json was hand-edited, and blindly trusting it
  // means heartbeating someone else's listing while ours stays dark.
  if (machineId && !(await ownsMachine(contract, wallet.address, machineId))) {
    console.log(`machine-id.json points at Machine ${machineId}, but ${wallet.address} does not own it on ${CONTRACT_ADDRESS} — ignoring it.`);
    machineId = null;
  }

  // Self-heal: adopt an existing listing owned by this wallet rather than creating a duplicate
  // every time machine-id.json goes missing (that's how the earlier duplicate machines appeared).
  if (!machineId) {
    const owned = await findOwnedMachineIds(contract, wallet.address);
    if (owned.length > 0) {
      machineId = owned[0]; // lowest id = the original listing
      console.log(`Adopting existing listing — owned machines: [${owned.join(', ')}], using Machine ${machineId}.`);
      if (owned.length > 1) {
        console.log(`  Note: ${owned.length} listings owned by this wallet. Delist the extras in the UI to keep the marketplace clean.`);
      }
      saveMachineId(machineId);
    }
  }

  if (machineId) {
    console.log(`Using Machine ID ${machineId} — skipping listMachine, going straight to uptime reporting.`);
  } else {
    machineId = await listMachine(contract, wallet);
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
