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
const crypto = require('crypto');
const { execFile, spawn } = require('child_process');
const { promisify } = require('util');
const { ethers } = require('ethers');
const nacl = require('tweetnacl');

const execFileAsync = promisify(execFile);

const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS || '0x2D16D7F81ac8a13b1A99E74dFDc94eb6107A8243';
const RPC_URL = process.env.RPC_URL || 'https://base-sepolia-rpc.publicnode.com';
const HEALTH_PORT = Number(process.env.HEALTH_PORT || 3939);

// Stage 3: isolated per-rental SSH containers, tunneled out with ngrok. See agent/README.md.
const SSH_IMAGE = process.env.SSH_IMAGE || 'linuxserver/openssh-server';
const SSH_MEMORY_LIMIT = process.env.SSH_MEMORY_LIMIT || '2g';
const SSH_CPU_LIMIT = process.env.SSH_CPU_LIMIT || '2';
const SSH_PIDS_LIMIT = process.env.SSH_PIDS_LIMIT || '256';
const NGROK_API_URL = 'http://127.0.0.1:4040/api/tunnels';
const NGROK_POLL_ATTEMPTS = 15;
const NGROK_POLL_INTERVAL_MS = 1500;

const DEVICE_KEY_FILE = path.join(__dirname, 'device-key.json');
const MACHINE_ID_FILE = path.join(__dirname, 'machine-id.json');
const REPORT_INTERVAL_MS = 60_000;
const REGISTRATION_POLL_MS = 10_000;
const RENTAL_STATUS_ACTIVE = 1; // RentalStatus.Active in NodePool.sol's enum

// Only the pieces of the NodePool ABI this agent actually calls. It never calls listMachine —
// that's a browser-only, wallet-signed action now.
const CONTRACT_ABI = [
  'function rentalCount() view returns (uint256)',
  'function getRental(uint256) view returns (tuple(uint256 id, uint256 machineId, address renter, uint256 deposit, uint256 startTime, uint256 endTime, uint256 secondsPaid, uint256 secondsVerified, uint256 totalHours, uint8 status, uint256 lastHealthCheck, string initialMessage))',
  'function reportUptime(uint256 rentalId, bool isOnline)',
  'function setMachineOnline(uint256 machineId, bool isOnline)',
  'function machineCount() view returns (uint256)',
  'function reporterOf(uint256) view returns (address)',
  'function getMachine(uint256) view returns (tuple(uint256 id, address owner, string cpu, string ram, string storage_, string os, uint256 pricePerHour, string healthEndpoint, bool isAvailable, uint256 uptimeScore, uint256 totalEarnings, uint256 createdAt, bool online, uint256 lastSeen))',
  'function accessCredentials(uint256) view returns (bytes32 renterPubKey, bytes encryptedBlob, uint256 updatedAt)',
  'function writeAccessCredentials(uint256 rentalId, bytes encryptedBlob)',
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

/* ==========================================================================================
 * Stage 3: isolated per-rental SSH access
 *
 * When a rental goes Active, provisionRental() starts a resource-limited, network-isolated
 * Docker container running sshd, tunnels its SSH port out with ngrok so the renter can connect
 * from their own laptop like a real VPS, encrypts the connection details to the renter's
 * on-chain public key (nacl.box — see frontend/index.html for the matching decrypt side), and
 * writes the ciphertext via writeAccessCredentials(). teardownRental() reverses all of it when
 * the rental leaves the active set (ended, cancelled, disputed) or the agent shuts down.
 *
 * The contract's own onlyAuthorizedReporterForRental gate is what makes this safe to run with
 * the powerless device key: writeAccessCredentials can only ever touch this one rental's
 * ciphertext field, nothing that moves funds.
 * ========================================================================================== */

// rentalId (number) -> { containerName, hostPort, ngrokProcess }. At most one entry in practice —
// NodePool.sol only allows one active rental per machine at a time — but keyed by rentalId
// rather than held as a single slot, so nothing breaks if that constraint ever loosens.
const provisioned = new Map();

let dockerAvailable = null; // null = not checked yet
let ngrokAvailable = null;

async function checkToolAvailable(bin) {
  try {
    await execFileAsync(bin, ['--version']);
    return true;
  } catch {
    return false;
  }
}

async function ensureProvisioningTools() {
  if (dockerAvailable === null) {
    dockerAvailable = await checkToolAvailable('docker');
    if (!dockerAvailable) {
      console.warn('  Note: `docker` was not found on PATH. SSH access provisioning is disabled — ' +
        'this agent will still report uptime normally. Install Docker to enable Stage 3.');
    }
  }
  if (ngrokAvailable === null) {
    ngrokAvailable = await checkToolAvailable('ngrok');
    if (!ngrokAvailable) {
      console.warn('  Note: `ngrok` was not found on PATH. SSH access provisioning is disabled — ' +
        'this agent will still report uptime normally. Install ngrok (and run `ngrok config ' +
        'add-authtoken <token>` once) to enable Stage 3.');
    }
  }
  return dockerAvailable && ngrokAvailable;
}

function randomPassword() {
  return crypto.randomBytes(16).toString('hex');
}

// Starts an isolated, resource-limited sshd container for this rental. No bind mounts to any
// host path — that, plus the default (non-privileged) bridge network, is what actually
// guarantees the renter never reaches the host or the provider's files.
async function startContainer(rentalId, password) {
  const containerName = `nodepool-rental-${rentalId}`;

  // Clean up any stale container from a previous crashed run before creating a fresh one.
  await execFileAsync('docker', ['rm', '-f', containerName]).catch(() => {});

  await execFileAsync('docker', [
    'run', '-d',
    '--name', containerName,
    '--memory', SSH_MEMORY_LIMIT,
    '--cpus', SSH_CPU_LIMIT,
    '--pids-limit', SSH_PIDS_LIMIT,
    '--security-opt', 'no-new-privileges',
    '--cap-drop', 'ALL',
    '--cap-add', 'CHOWN',
    '--cap-add', 'SETUID',
    '--cap-add', 'SETGID',
    '--cap-add', 'DAC_OVERRIDE',
    '-e', 'PUID=1000',
    '-e', 'PGID=1000',
    '-e', 'USER_NAME=renter',
    '-e', `USER_PASSWORD=${password}`,
    '-e', 'PASSWORD_ACCESS=true',
    '-p', '0:2222', // random host port — Docker picks it, avoids collisions
    SSH_IMAGE,
  ]);

  const { stdout } = await execFileAsync('docker', ['port', containerName, '2222/tcp']);
  // e.g. "0.0.0.0:54321\n[::]:54321\n" — take the first mapping's port
  const firstLine = stdout.trim().split('\n')[0];
  const hostPort = Number(firstLine.split(':').pop());
  if (!hostPort) throw new Error(`Could not determine host port for ${containerName} (docker port said: ${stdout})`);

  return { containerName, hostPort };
}

async function stopContainer(containerName) {
  await execFileAsync('docker', ['rm', '-f', containerName]).catch((err) => {
    console.warn(`Could not remove container ${containerName}:`, err.message);
  });
}

function httpGetJson(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (err) { reject(err); }
      });
    });
    req.on('error', reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error('timed out')); });
  });
}

// Spawns `ngrok tcp <hostPort>` and polls ngrok's local admin API for the public tcp:// endpoint
// it was assigned. Returns the still-running child process plus the parsed public host/port.
async function startNgrokTunnel(hostPort) {
  const ngrokProcess = spawn('ngrok', ['tcp', String(hostPort), '--log=stdout'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let earlyExit = null;
  ngrokProcess.once('exit', (code) => { earlyExit = code; });

  // Captured so a failure can surface ngrok's actual reason (e.g. missing authtoken, or ngrok's
  // account-level requirement to add a card before TCP endpoints work even on the free tier —
  // see https://ngrok.com/docs/errors/err_ngrok_8013) instead of a generic guess.
  let lastErrorLine = null;
  const captureError = (chunk) => {
    const lines = chunk.toString().split('\n').filter((l) => /err|ERROR/i.test(l));
    if (lines.length) lastErrorLine = lines[lines.length - 1].trim();
  };
  ngrokProcess.stdout.on('data', captureError);
  ngrokProcess.stderr.on('data', captureError);

  for (let attempt = 0; attempt < NGROK_POLL_ATTEMPTS; attempt++) {
    await sleep(NGROK_POLL_INTERVAL_MS);
    if (earlyExit !== null) {
      throw new Error(`ngrok exited early (code ${earlyExit})${lastErrorLine ? `: ${lastErrorLine}` : ' — check `ngrok config add-authtoken <token>` is set up'}`);
    }
    try {
      const data = await httpGetJson(NGROK_API_URL);
      const tunnel = (data.tunnels || []).find((t) => t.proto === 'tcp' && t.config && t.config.addr && t.config.addr.endsWith(`:${hostPort}`));
      if (tunnel && tunnel.public_url) {
        const match = /^tcp:\/\/([^:]+):(\d+)$/.exec(tunnel.public_url);
        if (!match) throw new Error(`Unexpected ngrok public_url format: ${tunnel.public_url}`);
        return { ngrokProcess, publicHost: match[1], publicPort: Number(match[2]) };
      }
    } catch {
      // ngrok's local API isn't up yet — keep polling until NGROK_POLL_ATTEMPTS is exhausted
    }
  }

  ngrokProcess.kill();
  throw new Error('Timed out waiting for ngrok to establish a tunnel');
}

function stopNgrokTunnel(ngrokProcess) {
  try { ngrokProcess.kill(); } catch { /* already exited */ }
}

// Encrypts {host, port, username, password} to the rental's renterPubKey with a fresh ephemeral
// X25519 keypair (perfect forward secrecy — this keypair is used once and discarded). Blob
// format: ephemeralPubKey(32) || nonce(24) || ciphertext — matches decryptAccessCredentials() in
// frontend/index.html exactly.
function encryptCredentials(renterPubKeyHex, creds) {
  const renterPubKey = ethers.getBytes(renterPubKeyHex);
  const ephemeral = nacl.box.keyPair();
  const nonce = nacl.randomBytes(24);
  const plaintext = new TextEncoder().encode(JSON.stringify(creds));
  const ciphertext = nacl.box(plaintext, nonce, renterPubKey, ephemeral.secretKey);

  const blob = new Uint8Array(32 + 24 + ciphertext.length);
  blob.set(ephemeral.publicKey, 0);
  blob.set(nonce, 32);
  blob.set(ciphertext, 56);
  return ethers.hexlify(blob);
}

// Spins up the container + tunnel for a newly-active rental, encrypts the connection details to
// the renter's submitted public key, and writes them on-chain. Best-effort: logs and leaves the
// rental untracked (so the next tick retries) rather than throwing out of the whole loop.
async function provisionRental(contract, rentalId) {
  if (provisioned.has(rentalId)) return;
  if (!(await ensureProvisioningTools())) return;

  console.log(`[${timestamp()}] Rental ${rentalId} - provisioning SSH access...`);
  const password = randomPassword();
  let containerName = null;
  let ngrokProcess = null;

  try {
    const creds = await contract.accessCredentials(rentalId);
    if (!creds.renterPubKey || creds.renterPubKey === ethers.ZeroHash) {
      console.warn(`[${timestamp()}] Rental ${rentalId} - no renterPubKey on-chain, skipping (renter submitted no encryption key)`);
      return;
    }

    const started = await startContainer(rentalId, password);
    containerName = started.containerName;
    console.log(`[${timestamp()}] Rental ${rentalId} - container ${containerName} listening on host port ${started.hostPort}, pulling image + starting sshd (first run may take a minute)...`);

    const tunnel = await startNgrokTunnel(started.hostPort);
    ngrokProcess = tunnel.ngrokProcess;
    console.log(`[${timestamp()}] Rental ${rentalId} - tunnel up at ${tunnel.publicHost}:${tunnel.publicPort}`);

    const blob = encryptCredentials(creds.renterPubKey, {
      host: tunnel.publicHost,
      port: tunnel.publicPort,
      username: 'renter',
      password,
    });

    const tx = await contract.writeAccessCredentials(rentalId, blob);
    await tx.wait();
    console.log(`[${timestamp()}] Rental ${rentalId} - encrypted access credentials written on-chain`);

    provisioned.set(rentalId, { containerName, hostPort: started.hostPort, ngrokProcess });
  } catch (err) {
    console.warn(`[${timestamp()}] Rental ${rentalId} - provisioning failed: ${err.message}`);
    if (ngrokProcess) stopNgrokTunnel(ngrokProcess);
    if (containerName) await stopContainer(containerName);
    // Not added to `provisioned` — the next tick will retry from scratch.
  }
}

async function teardownRental(rentalId) {
  const record = provisioned.get(rentalId);
  if (!record) return;
  provisioned.delete(rentalId);

  console.log(`[${timestamp()}] Rental ${rentalId} - tearing down SSH access...`);
  stopNgrokTunnel(record.ngrokProcess);
  await stopContainer(record.containerName);
  // On-chain credentials are already deleted by the contract's _endRental() — nothing to clear here.
  console.log(`[${timestamp()}] Rental ${rentalId} - torn down`);
}

async function teardownAllProvisioned() {
  const ids = Array.from(provisioned.keys());
  for (const rentalId of ids) {
    await teardownRental(rentalId);
  }
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

    // Read active rentals regardless of health — needed either way: to report them OFFLINE
    // below if unhealthy, or to report/provision them normally if healthy. Previously an
    // unhealthy tick just returned here without calling reportUptime at all, which left the
    // on-chain checkpoint frozen mid-rental; the next successful report would then credit the
    // entire unhealthy gap as if the machine had stayed online the whole time.
    let activeRentalIds = null;
    try {
      activeRentalIds = await findActiveRentalIds(contract, machineId);
    } catch (err) {
      console.log(`[${timestamp()}] Machine ${machineId} - couldn't read rentals: ${err.message}`);
    }

    // Tear down any previously-provisioned rental that's no longer active (ended, cancelled,
    // disputed, or swept past expiry by someone else) — independent of local health, since a
    // container/tunnel can and should be cleaned up even while the health server itself is down.
    if (activeRentalIds) {
      const activeSet = new Set(activeRentalIds);
      for (const rentalId of Array.from(provisioned.keys())) {
        if (!activeSet.has(rentalId)) await teardownRental(rentalId);
      }
    }

    if (!healthy) {
      console.log(`[${timestamp()}] Machine ${machineId} - local health check failed`);
      if (activeRentalIds) {
        for (const rentalId of activeRentalIds) {
          // Closes off the on-chain checkpoint at "now" with isOnline=false, so no window
          // during this unhealthy stretch can ever be credited as paid time later.
          const result = await reportUptimeForRental(contract, rentalId, false);
          console.log(
            result.ok
              ? `[${timestamp()}] Machine ${machineId} unhealthy - reported rental ${rentalId} offline`
              : `[${timestamp()}] Machine ${machineId} unhealthy - reporting rental ${rentalId} offline failed: ${result.reason}`
          );
        }
      }
      return;
    }

    // Heartbeat: refreshes lastSeen on-chain so the marketplace keeps showing this machine as
    // online. Runs every cycle regardless of active rentals - the marketplace listing depends
    // on it even when nobody is renting yet.
    const heartbeat = await setMachineOnlineStatus(contract, machineId, true);
    if (!heartbeat.ok) {
      console.log(`[${timestamp()}] Machine ${machineId} - heartbeat failed: ${heartbeat.reason}`);
    }

    if (activeRentalIds === null) return; // couldn't read rentals this cycle - try again next tick

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

      // Provision SSH access once a rental is genuinely active - fire-and-forget so a slow
      // container pull/tunnel setup for one rental never blocks the heartbeat for others.
      provisionRental(contract, rentalId).catch((err) => {
        console.warn(`[${timestamp()}] Rental ${rentalId} - provisioning error: ${err.message}`);
      });
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

    await teardownAllProvisioned();
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
