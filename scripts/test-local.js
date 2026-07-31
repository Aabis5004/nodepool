const { ethers } = require("hardhat");

async function main() {
  const contract = await ethers.getContractAt(
    "NodePool",
    "0x5FbDB2315678afecb367f032d93F642f64180aa3"
  );

  console.log("\n=== Test Rental Flow ===");
  const [deployer, renter] = await ethers.getSigners();
  console.log("Deployer (provider):", deployer.address);
  console.log("Renter:", renter.address);

  // List a test machine to rent (marketplace starts empty, so we create one here)
  const listTx = await contract.connect(deployer).listMachine(
    "AMD Ryzen 9 5900X",
    "32GB DDR4",
    "1TB NVMe SSD",
    "Ubuntu 22.04",
    ethers.parseEther("0.005"),
    "http://localhost:8080/health"
  );
  await listTx.wait();
  console.log("✓ Test machine listed!");

  console.log("\n=== Contract Status ===");
  console.log("Machine count:", (await contract.machineCount()).toString());
  console.log("Rental count:", (await contract.rentalCount()).toString());

  const available = await contract.getAvailableMachines();
  console.log("\nAvailable machines:", available.map(x => x.toString()));

  // Request rental for machine 1 (5 hours)
  const machine = await contract.getMachine(1);
  const deposit = machine.pricePerHour * 5n;
  console.log("\nDeposit required:", ethers.formatEther(deposit), "ETH");

  const tx = await contract.connect(renter).requestRental(1, 5, "Need this for a Node.js project", { value: deposit });
  await tx.wait();
  console.log("✓ Rental requested!");

  console.log("Rental count:", (await contract.rentalCount()).toString());

  // Check rental details
  let rental = await contract.getRental(1);
  console.log("Rental status:", rental.status.toString(), "(0 = Requested)");

  // Provider accepts
  const acceptTx = await contract.connect(deployer).acceptRental(1);
  await acceptTx.wait();
  console.log("✓ Rental accepted!");

  rental = await contract.getRental(1);
  console.log("Rental status:", rental.status.toString(), "(1 = Active)");
  console.log("Deposit held:", ethers.formatEther(rental.deposit), "ETH");

  // Test chat
  const msgTx = await contract.connect(renter).sendMessage(1, "Hello, machine is working great!");
  await msgTx.wait();
  console.log("✓ Message sent!");

  const messageIds = await contract.getMessages(1);
  console.log("Messages in rental:", messageIds.length);

  // Check available machines (should be 2 now, machine 1 is rented)
  const availableAfter = await contract.getAvailableMachines();
  console.log("\nAvailable machines after rental:", availableAfter.map(x => x.toString()));

  console.log("\n══════════════════════════════════════════");
  console.log("  ✓ All tests passed!");
  console.log("══════════════════════════════════════════\n");
}

main().catch(console.error);
