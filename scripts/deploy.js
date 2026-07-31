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
  console.log("  Network   :", network.name, `(chainId ${chainId})`);
  console.log("  Deployer  :", deployer.address);
  console.log("  Balance   :", ethers.formatEther(balance), "ETH");

  if (balance === 0n) {
    throw new Error(
      "Deployer has no ETH. Fund it first — Base Sepolia faucet: https://www.alchemy.com/faucets/base-sepolia"
    );
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

  // Save deployment info
  const record = {
    contract: "NodePool",
    network: network.name,
    chainId,
    address,
    deployer: deployer.address,
    txHash: deployTx.hash,
    deployedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(__dirname, "..", "deployments.json"),
    JSON.stringify(record, null, 2) + "\n"
  );

  // Summary
  console.log("\n  ══════════════════════════════════════════════════════════");
  console.log("   NodePool deployed at:", address);
  console.log("  ══════════════════════════════════════════════════════════");

  if (chainId === 84532) {
    console.log("\n  Base Sepolia Explorer:");
    console.log("    https://sepolia.basescan.org/address/" + address);
    console.log("\n  Verify contract:");
    console.log("    npx hardhat verify --network baseSepolia " + address);
  }

  console.log("\n  Deployment saved to deployments.json\n");
}

main().catch((error) => {
  console.error("\n  ✗ Deploy failed:", error.message, "\n");
  process.exitCode = 1;
});
