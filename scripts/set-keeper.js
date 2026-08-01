// Calls setKeeper(newKeeper) on the deployed NodePool contract to transfer
// keeper (uptime-oracle) authorization to a new address.
const { ethers, network } = require("hardhat");
const deployments = require("../deployments.json");

const NEW_KEEPER = "0xCb925E602038ba28588784B339de553F02F6B429";

async function main() {
  const [signer] = await ethers.getSigners();
  const contract = await ethers.getContractAt("NodePool", deployments.address, signer);

  console.log("Network    :", network.name);
  console.log("Signer     :", signer.address);
  console.log("Contract   :", deployments.address);

  const currentKeeper = await contract.keeper();
  console.log("Old keeper :", currentKeeper);
  console.log("New keeper :", NEW_KEEPER);

  if (currentKeeper.toLowerCase() === NEW_KEEPER.toLowerCase()) {
    console.log("\nKeeper is already set to this address. Nothing to do.");
    return;
  }

  const tx = await contract.setKeeper(NEW_KEEPER);
  console.log("\nTx sent    :", tx.hash);
  const receipt = await tx.wait();
  console.log("Tx mined   :", receipt.hash, `(block ${receipt.blockNumber})`);

  const updatedKeeper = await contract.keeper();
  if (updatedKeeper.toLowerCase() !== NEW_KEEPER.toLowerCase()) {
    throw new Error(`Keeper mismatch after tx: expected ${NEW_KEEPER}, got ${updatedKeeper}`);
  }

  console.log("\n✓ Keeper successfully updated to", updatedKeeper);
}

main().catch((error) => {
  console.error("\n✗ Script failed:", error.message, "\n");
  process.exitCode = 1;
});
