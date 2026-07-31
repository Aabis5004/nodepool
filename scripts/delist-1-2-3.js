// Calls delistMachine(1), delistMachine(2), delistMachine(3) on the deployed
// NodePool contract (address read from deployments.json).
const { ethers, network } = require("hardhat");
const deployments = require("../deployments.json");

async function main() {
  const [signer] = await ethers.getSigners();
  const contract = await ethers.getContractAt("NodePool", deployments.address, signer);

  console.log("Network :", network.name);
  console.log("Signer  :", signer.address);
  console.log("Contract:", deployments.address);

  const machineIds = [1, 2, 3];

  for (const id of machineIds) {
    const machine = await contract.getMachine(id);
    if (machine.owner.toLowerCase() !== signer.address.toLowerCase()) {
      console.log(`Skipping machine ${id}: signer is not the owner (owner=${machine.owner})`);
      continue;
    }
    if (!machine.isAvailable) {
      console.log(`Skipping machine ${id}: already delisted`);
      continue;
    }

    console.log(`Delisting machine ${id}...`);
    const tx = await contract.delistMachine(id);
    const receipt = await tx.wait();
    console.log(`✓ Machine ${id} delisted. Tx: ${receipt.hash}`);
  }

  console.log("\nDone.");
}

main().catch((error) => {
  console.error("\n✗ Script failed:", error.message, "\n");
  process.exitCode = 1;
});
