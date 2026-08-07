const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");

async function main() {
  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const isLocal = chainId === 31337;

  console.log("");
  console.log("  ╔═══════════════════════════════════════════════════════╗");
  console.log("  ║              NodePool Deploy Script                   ║");
  console.log("  ╚═══════════════════════════════════════════════════════╝");
  console.log("");
  const gasCcy = chainId === 5042002 ? "USDC" : "ETH";
  console.log("  Network   :", network.name, `(chainId ${chainId})`);
  console.log("  Deployer  :", deployer.address);
  console.log("  Balance   :", ethers.formatEther(balance), gasCcy);

  if (balance === 0n) {
    const faucet = chainId === 5042002
      ? "https://faucet.circle.com"
      : "https://www.alchemy.com/faucets/base-sepolia";
    throw new Error(`Deployer has no ${gasCcy}. Fund it first — faucet: ${faucet}`);
  }

  // Deploy NodePool contract
  console.log("\n  Deploying NodePool...");
  const NodePool = await ethers.getContractFactory("NodePool");
  const nodePool = await NodePool.deploy();
  await nodePool.waitForDeployment();

  const address = await nodePool.getAddress();
  const deployTx = nodePool.deploymentTransaction();
  await deployTx.wait(isLocal ? 1 : 2);

  console.log("  ✓ NodePool deployed at:", address);

  // Save deployment info — keyed by network name so both chains' addresses persist
  // side by side instead of overwriting each other.
  const deploymentsPath = path.join(__dirname, "..", "deployments.json");
  let deployments = {};
  if (fs.existsSync(deploymentsPath)) {
    const existing = JSON.parse(fs.readFileSync(deploymentsPath, "utf8"));
    // Migrate the old single-record shape ({ contract, network, ... }) into the new
    // per-network map shape the first time this runs against an existing file.
    deployments = existing.network ? { [existing.network]: existing } : existing;
  }
  deployments[network.name] = {
    contract: "NodePool",
    network: network.name,
    chainId,
    address,
    deployer: deployer.address,
    txHash: deployTx.hash,
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(deploymentsPath, JSON.stringify(deployments, null, 2) + "\n");

  // Summary
  console.log("\n  ══════════════════════════════════════════════════════════");
  console.log("   NodePool deployed at:", address);
  console.log("  ══════════════════════════════════════════════════════════");

  if (chainId === 84532) {
    console.log("\n  Base Sepolia Explorer:");
    console.log("    https://sepolia.basescan.org/address/" + address);
    console.log("\n  Verify contract:");
    console.log("    npx hardhat verify --network baseSepolia " + address);
  } else if (chainId === 5042002) {
    console.log("\n  Arc Testnet Explorer:");
    console.log("    https://testnet.arcscan.app/address/" + address);
  }

  console.log("\n  Deployment saved to deployments.json\n");
}

main().catch((error) => {
  console.error("\n  ✗ Deploy failed:", error.message, "\n");
  process.exitCode = 1;
});
