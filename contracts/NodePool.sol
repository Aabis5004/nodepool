// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title NodePool
 * @notice Decentralized compute marketplace - rent idle machines, pay only for verified uptime
 * @dev Built for Base Sepolia testnet, designed for Rialo mainnet with native HTTPS health checks
 */
contract NodePool {
    // ============ Enums ============

    enum RentalStatus {
        Requested,  // Renter requested, waiting for provider approval
        Active,     // Provider accepted, rental in progress
        Completed,  // Rental ended normally
        Disputed,   // Flagged for review
        Cancelled   // Declined or cancelled before start
    }

    // ============ Structs ============

    struct Machine {
        uint256 id;
        address owner;
        string cpu;
        string ram;
        string storage_;  // 'storage' is reserved keyword
        string os;
        uint256 pricePerHour;   // in wei
        string healthEndpoint;  // URL for health checks
        bool isAvailable;
        uint256 uptimeScore;    // percentage * 100 (e.g., 9950 = 99.50%)
        uint256 totalEarnings;
        uint256 createdAt;
    }

    struct Rental {
        uint256 id;
        uint256 machineId;
        address renter;
        uint256 deposit;
        uint256 startTime;
        uint256 endTime;        // expected end (startTime + hours * 3600)
        uint256 hoursPaid;      // hours paid to provider
        uint256 hoursVerified;  // hours machine was online
        uint256 totalHours;     // total hours requested
        RentalStatus status;
        uint256 lastHealthCheck;
        string initialMessage;  // message from renter when requesting
    }

    struct Message {
        uint256 rentalId;
        address sender;
        string text;
        uint256 timestamp;
    }

    // ============ State Variables ============

    uint256 public machineCount;
    uint256 public rentalCount;
    uint256 public messageCount;
    address public keeper;  // address authorized to report uptime (simulated oracle)

    mapping(uint256 => Machine) public machines;
    mapping(uint256 => Rental) public rentals;
    mapping(uint256 => Message) public messages;

    // Provider earnings ready to withdraw
    mapping(address => uint256) public pendingWithdrawals;

    // Track machines by owner for getMyMachines
    mapping(address => uint256[]) private ownerMachines;

    // Track rentals by renter
    mapping(address => uint256[]) private renterRentals;

    // Track messages by rental
    mapping(uint256 => uint256[]) private rentalMessages;

    // ============ Events ============

    event MachineCreated(
        uint256 indexed machineId,
        address indexed owner,
        string cpu,
        string ram,
        uint256 pricePerHour
    );

    event MachineUpdated(uint256 indexed machineId);
    event MachineDelisted(uint256 indexed machineId);

    event RentalRequested(
        uint256 indexed rentalId,
        uint256 indexed machineId,
        address indexed renter,
        uint256 deposit,
        uint256 hours_
    );

    event RentalAccepted(uint256 indexed rentalId, uint256 startTime);
    event RentalDeclined(uint256 indexed rentalId);
    event RentalStarted(uint256 indexed rentalId);
    event RentalEnded(uint256 indexed rentalId, uint256 hoursPaid, uint256 refund);
    event RentalDisputed(uint256 indexed rentalId, string reason);

    event UptimeReported(uint256 indexed rentalId, bool isOnline, uint256 timestamp);
    event PaymentReleased(uint256 indexed rentalId, address indexed provider, uint256 amount);

    event MessageSent(
        uint256 indexed messageId,
        uint256 indexed rentalId,
        address indexed sender,
        string text
    );

    // ============ Modifiers ============

    modifier onlyMachineOwner(uint256 machineId) {
        require(machines[machineId].owner == msg.sender, "Not machine owner");
        _;
    }

    modifier onlyKeeper() {
        require(msg.sender == keeper, "Not authorized keeper");
        _;
    }

    modifier machineExists(uint256 machineId) {
        require(machineId > 0 && machineId <= machineCount, "Machine does not exist");
        require(machines[machineId].owner != address(0), "Machine deleted");
        _;
    }

    modifier rentalExists(uint256 rentalId) {
        require(rentalId > 0 && rentalId <= rentalCount, "Rental does not exist");
        _;
    }

    // ============ Constructor ============

    constructor() {
        keeper = msg.sender;  // deployer is initial keeper
    }

    // ============ Machine Functions ============

    /**
     * @notice List a new machine on the marketplace
     * @param cpu CPU specs (e.g., "AMD Ryzen 9 5900X")
     * @param ram RAM amount (e.g., "32GB DDR4")
     * @param storage_ Storage specs (e.g., "1TB NVMe SSD")
     * @param os Operating system (e.g., "Ubuntu 22.04")
     * @param pricePerHour Price per hour in wei
     * @param healthEndpoint URL for health check endpoint
     */
    function listMachine(
        string calldata cpu,
        string calldata ram,
        string calldata storage_,
        string calldata os,
        uint256 pricePerHour,
        string calldata healthEndpoint
    ) external returns (uint256) {
        require(pricePerHour > 0, "Price must be greater than 0");
        require(bytes(healthEndpoint).length > 0, "Health endpoint required");

        machineCount++;
        uint256 machineId = machineCount;

        machines[machineId] = Machine({
            id: machineId,
            owner: msg.sender,
            cpu: cpu,
            ram: ram,
            storage_: storage_,
            os: os,
            pricePerHour: pricePerHour,
            healthEndpoint: healthEndpoint,
            isAvailable: true,
            uptimeScore: 10000,  // Start at 100%
            totalEarnings: 0,
            createdAt: block.timestamp
        });

        ownerMachines[msg.sender].push(machineId);

        emit MachineCreated(machineId, msg.sender, cpu, ram, pricePerHour);
        return machineId;
    }

    /**
     * @notice Update machine specs and pricing
     */
    function updateMachine(
        uint256 machineId,
        string calldata cpu,
        string calldata ram,
        string calldata storage_,
        string calldata os,
        uint256 pricePerHour,
        string calldata healthEndpoint,
        bool isAvailable
    ) external onlyMachineOwner(machineId) machineExists(machineId) {
        require(pricePerHour > 0, "Price must be greater than 0");

        Machine storage machine = machines[machineId];
        machine.cpu = cpu;
        machine.ram = ram;
        machine.storage_ = storage_;
        machine.os = os;
        machine.pricePerHour = pricePerHour;
        machine.healthEndpoint = healthEndpoint;
        machine.isAvailable = isAvailable;

        emit MachineUpdated(machineId);
    }

    /**
     * @notice Take machine offline (soft delete)
     */
    function delistMachine(uint256 machineId)
        external
        onlyMachineOwner(machineId)
        machineExists(machineId)
    {
        machines[machineId].isAvailable = false;
        emit MachineDelisted(machineId);
    }

    // ============ Rental Functions ============

    /**
     * @notice Request to rent a machine - deposits payment into escrow
     * @param machineId The machine to rent
     * @param rentalHours Number of hours to rent
     * @param message Message to the provider
     */
    function requestRental(
        uint256 machineId,
        uint256 rentalHours,
        string calldata message
    ) external payable machineExists(machineId) returns (uint256) {
        Machine storage machine = machines[machineId];
        require(machine.isAvailable, "Machine not available");
        require(machine.owner != msg.sender, "Cannot rent your own machine");
        require(rentalHours > 0, "Must rent for at least 1 hour");

        uint256 requiredDeposit = machine.pricePerHour * rentalHours;
        require(msg.value >= requiredDeposit, "Insufficient deposit");

        rentalCount++;
        uint256 rentalId = rentalCount;

        rentals[rentalId] = Rental({
            id: rentalId,
            machineId: machineId,
            renter: msg.sender,
            deposit: msg.value,
            startTime: 0,  // Set when accepted
            endTime: 0,
            hoursPaid: 0,
            hoursVerified: 0,
            totalHours: rentalHours,
            status: RentalStatus.Requested,
            lastHealthCheck: 0,
            initialMessage: message
        });

        renterRentals[msg.sender].push(rentalId);

        // If message provided, store it as first message
        if (bytes(message).length > 0) {
            _sendMessage(rentalId, message);
        }

        emit RentalRequested(rentalId, machineId, msg.sender, msg.value, rentalHours);
        return rentalId;
    }

    /**
     * @notice Provider accepts a rental request - rental starts immediately
     */
    function acceptRental(uint256 rentalId) external rentalExists(rentalId) {
        Rental storage rental = rentals[rentalId];
        require(rental.status == RentalStatus.Requested, "Rental not in requested state");

        Machine storage machine = machines[rental.machineId];
        require(machine.owner == msg.sender, "Not machine owner");

        rental.status = RentalStatus.Active;
        rental.startTime = block.timestamp;
        rental.endTime = block.timestamp + (rental.totalHours * 1 hours);
        rental.lastHealthCheck = block.timestamp;

        // Mark machine as unavailable while rented
        machine.isAvailable = false;

        emit RentalAccepted(rentalId, block.timestamp);
        emit RentalStarted(rentalId);
    }

    /**
     * @notice Provider declines a rental request - refunds deposit
     */
    function declineRental(uint256 rentalId) external rentalExists(rentalId) {
        Rental storage rental = rentals[rentalId];
        require(rental.status == RentalStatus.Requested, "Rental not in requested state");

        Machine storage machine = machines[rental.machineId];
        require(machine.owner == msg.sender, "Not machine owner");

        rental.status = RentalStatus.Cancelled;

        // Refund full deposit to renter
        uint256 refund = rental.deposit;
        rental.deposit = 0;

        (bool success, ) = rental.renter.call{value: refund}("");
        require(success, "Refund failed");

        emit RentalDeclined(rentalId);
    }

    /**
     * @notice Report uptime status - called by keeper/oracle
     * @dev On Rialo mainnet, this becomes a native HTTPS call from the contract
     */
    function reportUptime(uint256 rentalId, bool isOnline)
        external
        onlyKeeper
        rentalExists(rentalId)
    {
        Rental storage rental = rentals[rentalId];
        require(rental.status == RentalStatus.Active, "Rental not active");

        Machine storage machine = machines[rental.machineId];

        // Calculate hours since last check
        uint256 hoursSinceLastCheck = (block.timestamp - rental.lastHealthCheck) / 1 hours;

        if (hoursSinceLastCheck > 0) {
            if (isOnline) {
                rental.hoursVerified += hoursSinceLastCheck;

                // Pay provider for verified hours
                uint256 payment = hoursSinceLastCheck * machine.pricePerHour;
                if (payment <= rental.deposit) {
                    rental.deposit -= payment;
                    rental.hoursPaid += hoursSinceLastCheck;
                    pendingWithdrawals[machine.owner] += payment;
                    machine.totalEarnings += payment;

                    emit PaymentReleased(rentalId, machine.owner, payment);
                }
            }

            // Update uptime score (simple rolling average)
            uint256 totalChecks = rental.hoursVerified + (rental.totalHours - rental.hoursVerified);
            if (totalChecks > 0) {
                machine.uptimeScore = (rental.hoursVerified * 10000) / totalChecks;
            }
        }

        rental.lastHealthCheck = block.timestamp;
        emit UptimeReported(rentalId, isOnline, block.timestamp);

        // Auto-end if past end time
        if (block.timestamp >= rental.endTime) {
            _endRental(rentalId);
        }
    }

    /**
     * @notice End a rental - settles payment and refunds remaining deposit
     */
    function endRental(uint256 rentalId) external rentalExists(rentalId) {
        Rental storage rental = rentals[rentalId];
        require(rental.status == RentalStatus.Active, "Rental not active");

        Machine storage machine = machines[rental.machineId];
        require(
            msg.sender == rental.renter || msg.sender == machine.owner,
            "Not authorized"
        );

        _endRental(rentalId);
    }

    /**
     * @notice Internal function to end rental and settle
     */
    function _endRental(uint256 rentalId) internal {
        Rental storage rental = rentals[rentalId];
        Machine storage machine = machines[rental.machineId];

        rental.status = RentalStatus.Completed;

        // Refund remaining deposit to renter
        uint256 refund = rental.deposit;
        rental.deposit = 0;

        // Make machine available again
        machine.isAvailable = true;

        if (refund > 0) {
            (bool success, ) = rental.renter.call{value: refund}("");
            require(success, "Refund failed");
        }

        emit RentalEnded(rentalId, rental.hoursPaid, refund);
    }

    /**
     * @notice Flag a rental as disputed
     */
    function disputeRental(uint256 rentalId, string calldata reason)
        external
        rentalExists(rentalId)
    {
        Rental storage rental = rentals[rentalId];
        Machine storage machine = machines[rental.machineId];

        require(
            msg.sender == rental.renter || msg.sender == machine.owner,
            "Not authorized"
        );
        require(
            rental.status == RentalStatus.Active ||
            rental.status == RentalStatus.Requested,
            "Cannot dispute this rental"
        );

        rental.status = RentalStatus.Disputed;
        emit RentalDisputed(rentalId, reason);
    }

    // ============ Chat Functions ============

    /**
     * @notice Send a message in a rental chat
     */
    function sendMessage(uint256 rentalId, string calldata text)
        external
        rentalExists(rentalId)
    {
        Rental storage rental = rentals[rentalId];
        Machine storage machine = machines[rental.machineId];

        require(
            msg.sender == rental.renter || msg.sender == machine.owner,
            "Not a participant"
        );

        _sendMessage(rentalId, text);
    }

    function _sendMessage(uint256 rentalId, string memory text) internal {
        messageCount++;
        uint256 messageId = messageCount;

        messages[messageId] = Message({
            rentalId: rentalId,
            sender: msg.sender,
            text: text,
            timestamp: block.timestamp
        });

        rentalMessages[rentalId].push(messageId);

        emit MessageSent(messageId, rentalId, msg.sender, text);
    }

    // ============ Withdrawal ============

    /**
     * @notice Provider withdraws accumulated earnings
     */
    function withdrawEarnings() external {
        uint256 amount = pendingWithdrawals[msg.sender];
        require(amount > 0, "No earnings to withdraw");

        pendingWithdrawals[msg.sender] = 0;

        (bool success, ) = msg.sender.call{value: amount}("");
        require(success, "Withdrawal failed");
    }

    // ============ View Functions ============

    /**
     * @notice Get all machines owned by an address
     */
    function getMyMachines(address owner) external view returns (uint256[] memory) {
        return ownerMachines[owner];
    }

    /**
     * @notice Get all available machines for the marketplace
     */
    function getAvailableMachines() external view returns (uint256[] memory) {
        // First, count available machines
        uint256 count = 0;
        for (uint256 i = 1; i <= machineCount; i++) {
            if (machines[i].isAvailable && machines[i].owner != address(0)) {
                count++;
            }
        }

        // Then populate array
        uint256[] memory available = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = 1; i <= machineCount; i++) {
            if (machines[i].isAvailable && machines[i].owner != address(0)) {
                available[index] = i;
                index++;
            }
        }

        return available;
    }

    /**
     * @notice Get rental details
     */
    function getRental(uint256 rentalId)
        external
        view
        rentalExists(rentalId)
        returns (Rental memory)
    {
        return rentals[rentalId];
    }

    /**
     * @notice Get machine details
     */
    function getMachine(uint256 machineId)
        external
        view
        machineExists(machineId)
        returns (Machine memory)
    {
        return machines[machineId];
    }

    /**
     * @notice Get all rentals for a renter
     */
    function getMyRentals(address renter) external view returns (uint256[] memory) {
        return renterRentals[renter];
    }

    /**
     * @notice Get all messages for a rental
     */
    function getMessages(uint256 rentalId)
        external
        view
        rentalExists(rentalId)
        returns (uint256[] memory)
    {
        return rentalMessages[rentalId];
    }

    /**
     * @notice Get provider statistics
     */
    function getProviderStats(address owner)
        external
        view
        returns (
            uint256 totalMachines,
            uint256 totalEarnings,
            uint256 avgUptimeScore
        )
    {
        uint256[] memory machineIds = ownerMachines[owner];
        totalMachines = machineIds.length;

        uint256 uptimeSum = 0;
        uint256 activeMachines = 0;

        for (uint256 i = 0; i < machineIds.length; i++) {
            Machine storage machine = machines[machineIds[i]];
            if (machine.owner != address(0)) {
                totalEarnings += machine.totalEarnings;
                uptimeSum += machine.uptimeScore;
                activeMachines++;
            }
        }

        if (activeMachines > 0) {
            avgUptimeScore = uptimeSum / activeMachines;
        }
    }

    // ============ Admin Functions ============

    /**
     * @notice Update the keeper address (for testnet simulation)
     */
    function setKeeper(address newKeeper) external {
        require(msg.sender == keeper, "Only keeper can transfer");
        keeper = newKeeper;
    }
}
