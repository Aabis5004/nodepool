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
        bool online;            // set truthfully by the agent's heartbeat, not by the owner's intent
        uint256 lastSeen;       // timestamp of the last heartbeat; stale beyond ONLINE_WINDOW means offline
    }

    struct Rental {
        uint256 id;
        uint256 machineId;
        address renter;
        uint256 deposit;
        uint256 startTime;
        uint256 endTime;          // expected end (startTime + hours * 3600)
        uint256 secondsPaid;      // seconds of verified online time paid to provider so far
        uint256 secondsVerified;  // seconds machine was verified online (== secondsPaid; kept
                                   // separate for clarity between "credited" and "paid")
        uint256 totalHours;       // total hours requested (deposit/duration are still hour-priced)
        RentalStatus status;
        uint256 lastHealthCheck;  // checkpoint reportUptime advances each call; never past endTime
        string initialMessage;    // message from renter when requesting
    }

    struct Message {
        uint256 rentalId;
        address sender;
        string text;
        uint256 timestamp;
    }

    // Encrypted SSH access credentials for a rental. renterPubKey is an X25519 public key the
    // renter derives client-side from a wallet signature (never a secret); encryptedBlob is
    // ciphertext readable only by the matching private key, which never leaves the renter's
    // browser. See the frontend for the exact derivation.
    struct AccessCredentials {
        bytes32 renterPubKey;
        bytes encryptedBlob;   // agentEphemeralPubKey(32) || nonce(24) || nacl.box ciphertext
        uint256 updatedAt;
    }

    // ============ State Variables ============

    uint256 public machineCount;
    uint256 public rentalCount;
    uint256 public messageCount;

    // A machine is only considered live if its agent heartbeat landed within this window
    uint256 public constant ONLINE_WINDOW = 3 minutes;

    mapping(uint256 => Machine) public machines;
    mapping(uint256 => Rental) public rentals;
    mapping(uint256 => Message) public messages;

    // rentalId => SSH access credentials, encrypted to that rental's renterPubKey. Written only
    // by the machine's authorized reporter (device key); readable by anyone, but useless without
    // the renter's private key, which is never submitted anywhere.
    mapping(uint256 => AccessCredentials) public accessCredentials;

    // Per-machine device key authorized to report uptime for THAT machine only (setMachineOnline,
    // reportUptime). Set by the machine owner, either at listing time or via authorizeReporter().
    // It can never withdraw, delist, or move funds — those stay gated to the owner.
    mapping(uint256 => address) public reporterOf;

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
    event MachineOnlineStatusChanged(uint256 indexed machineId, bool online, uint256 timestamp);
    event ReporterAuthorized(uint256 indexed machineId, address indexed reporter);

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
    event RentalEnded(uint256 indexed rentalId, uint256 secondsPaid, uint256 refund);
    event RentalDisputed(uint256 indexed rentalId, string reason);

    event UptimeReported(uint256 indexed rentalId, bool isOnline, uint256 timestamp);
    event PaymentReleased(uint256 indexed rentalId, address indexed provider, uint256 amount);
    event AccessCredentialsWritten(uint256 indexed rentalId, uint256 timestamp);

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

    // Machine owner, or the per-machine device key the owner authorized — never a global address
    modifier onlyAuthorizedReporter(uint256 machineId) {
        require(
            msg.sender == machines[machineId].owner || msg.sender == reporterOf[machineId],
            "Not authorized reporter"
        );
        _;
    }

    // Same check, but for call sites that only have a rentalId (reportUptime)
    modifier onlyAuthorizedReporterForRental(uint256 rentalId) {
        uint256 machineId = rentals[rentalId].machineId;
        require(
            msg.sender == machines[machineId].owner || msg.sender == reporterOf[machineId],
            "Not authorized reporter"
        );
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

    constructor() {}

    // ============ Machine Functions ============

    /**
     * @notice List a new machine on the marketplace, optionally authorizing its device key
     *         (the agent's heartbeat reporter) in the same transaction — one signature covers
     *         both listing and device authorization.
     * @param cpu CPU specs (e.g., "AMD Ryzen 9 5900X")
     * @param ram RAM amount (e.g., "32GB DDR4")
     * @param storage_ Storage specs (e.g., "1TB NVMe SSD")
     * @param os Operating system (e.g., "Ubuntu 22.04")
     * @param pricePerHour Price per hour in wei
     * @param healthEndpoint URL for health check endpoint
     * @param reporter Device key to authorize for uptime reporting, or address(0) to skip and
     *        authorize later via authorizeReporter()
     */
    function listMachine(
        string calldata cpu,
        string calldata ram,
        string calldata storage_,
        string calldata os,
        uint256 pricePerHour,
        string calldata healthEndpoint,
        address reporter
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
            createdAt: block.timestamp,
            online: false,  // agent marks it online with its own heartbeat right after listing
            lastSeen: 0
        });

        ownerMachines[msg.sender].push(machineId);

        if (reporter != address(0)) {
            reporterOf[machineId] = reporter;
            emit ReporterAuthorized(machineId, reporter);
        }

        emit MachineCreated(machineId, msg.sender, cpu, ram, pricePerHour);
        return machineId;
    }

    /**
     * @notice Authorize (or re-point) the device key allowed to report uptime for this machine.
     *         Lets a provider swap in a new agent (e.g. after reinstalling it) without re-listing.
     *         The reporter can only call setMachineOnline/reportUptime for THIS machine — it can
     *         never withdraw, delist, or move funds.
     */
    function authorizeReporter(uint256 machineId, address reporter)
        external
        onlyMachineOwner(machineId)
        machineExists(machineId)
    {
        reporterOf[machineId] = reporter;
        emit ReporterAuthorized(machineId, reporter);
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

    /**
     * @notice Set a machine's live/online status - called by the agent's heartbeat
     * @dev Only the machine owner or that machine's authorized device key (reporterOf) may call
     *      this, so the status reflects what that machine's agent actually observed, not a claim
     *      anyone — or any other machine's device key — can make.
     *      Going online refreshes lastSeen; going offline (e.g. on agent shutdown) does not,
     *      so the machine reads as offline immediately rather than waiting out the window.
     */
    function setMachineOnline(uint256 machineId, bool isOnline)
        external
        machineExists(machineId)
        onlyAuthorizedReporter(machineId)
    {
        machines[machineId].online = isOnline;
        if (isOnline) {
            machines[machineId].lastSeen = block.timestamp;
        }

        emit MachineOnlineStatusChanged(machineId, isOnline, block.timestamp);
    }

    /**
     * @notice True if the machine's agent heartbeat landed within the last ONLINE_WINDOW
     */
    function _isOnline(Machine storage machine) internal view returns (bool) {
        return machine.online && (block.timestamp - machine.lastSeen <= ONLINE_WINDOW);
    }

    // ============ Rental Functions ============

    /**
     * @notice Request to rent a machine - deposits payment into escrow
     * @param machineId The machine to rent
     * @param rentalHours Number of hours to rent
     * @param message Message to the provider
     * @param renterPubKey X25519 public key the renter derived client-side from a wallet
     *        signature, submitted in this same transaction so SSH access credentials can be
     *        encrypted to it as soon as the rental goes active. Not a secret — a public key.
     */
    function requestRental(
        uint256 machineId,
        uint256 rentalHours,
        string calldata message,
        bytes32 renterPubKey
    ) external payable machineExists(machineId) returns (uint256) {
        Machine storage machine = machines[machineId];
        require(machine.isAvailable, "Machine not available");
        require(_isOnline(machine), "Machine agent not live");
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
            secondsPaid: 0,
            secondsVerified: 0,
            totalHours: rentalHours,
            status: RentalStatus.Requested,
            lastHealthCheck: 0,
            initialMessage: message
        });

        accessCredentials[rentalId].renterPubKey = renterPubKey;

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
     * @notice Report uptime status - called by the machine owner or its authorized device key
     * @dev On Rialo mainnet, this becomes a native HTTPS call from the contract
     */
    function reportUptime(uint256 rentalId, bool isOnline)
        external
        rentalExists(rentalId)
        onlyAuthorizedReporterForRental(rentalId)
    {
        Rental storage rental = rentals[rentalId];
        require(rental.status == RentalStatus.Active, "Rental not active");

        Machine storage machine = machines[rental.machineId];

        // Never credit time past the rental's paid end — this is what makes expiry correct: no
        // matter how late a heartbeat lands, the checkpoint can't advance past endTime, so no
        // window beyond the rental's paid duration is ever paid for.
        uint256 nowCapped = block.timestamp > rental.endTime ? rental.endTime : block.timestamp;
        uint256 elapsed = nowCapped > rental.lastHealthCheck ? nowCapped - rental.lastHealthCheck : 0;

        if (elapsed > 0 && isOnline) {
            rental.secondsVerified += elapsed;

            // Pay provider for every verified second, not whole hours - a machine that was
            // online for 40 minutes gets paid for 40 minutes, not rounded down to zero.
            uint256 payment = (elapsed * machine.pricePerHour) / 3600;
            if (payment > rental.deposit) payment = rental.deposit; // defensive cap only

            if (payment > 0) {
                rental.deposit -= payment;
                rental.secondsPaid += elapsed;
                pendingWithdrawals[machine.owner] += payment;
                machine.totalEarnings += payment;

                emit PaymentReleased(rentalId, machine.owner, payment);
            }
        }

        // rental.lastHealthCheck always advances to nowCapped, whether this call reported
        // online or offline. An offline call still closes off its window with zero credit -
        // once earned, a payment already in pendingWithdrawals is never reversed by a later
        // offline report, but no window can ever be paid for twice or credited retroactively.
        rental.lastHealthCheck = nowCapped;

        if (rental.totalHours > 0) {
            machine.uptimeScore = (rental.secondsVerified * 10000) / (rental.totalHours * 3600);
        }
        emit UptimeReported(rentalId, isOnline, block.timestamp);

        // Auto-end if past end time
        if (block.timestamp >= rental.endTime) {
            _endRental(rentalId);
        }
    }

    /**
     * @notice Write encrypted SSH access credentials for an active rental. Callable only by the
     *         machine's owner or its authorized device key — the same permission reportUptime
     *         uses. encryptedBlob is opaque ciphertext the contract never inspects; only the
     *         renter's private key (derived client-side, never submitted anywhere) can read it.
     */
    function writeAccessCredentials(uint256 rentalId, bytes calldata encryptedBlob)
        external
        rentalExists(rentalId)
        onlyAuthorizedReporterForRental(rentalId)
    {
        require(rentals[rentalId].status == RentalStatus.Active, "Rental not active");

        AccessCredentials storage creds = accessCredentials[rentalId];
        creds.encryptedBlob = encryptedBlob;
        creds.updatedAt = block.timestamp;

        emit AccessCredentialsWritten(rentalId, block.timestamp);
    }

    /**
     * @notice End a rental. The renter or machine owner may end it early at any time (e.g. the
     *         renter is done, or the provider needs to reclaim the machine). Once the rental has
     *         passed its paid endTime, ANYONE may call this to sweep it closed - this is what
     *         guarantees a rental always settles even if the provider's agent goes offline right
     *         at expiry and never gets to call reportUptime again. Either path pays out exactly
     *         what reportUptime already streamed into pendingWithdrawals - this function only
     *         refunds whatever of the deposit is left unearned.
     */
    function endRental(uint256 rentalId) external rentalExists(rentalId) {
        Rental storage rental = rentals[rentalId];
        require(rental.status == RentalStatus.Active, "Rental not active");

        Machine storage machine = machines[rental.machineId];
        bool isPastEnd = block.timestamp >= rental.endTime;
        require(
            isPastEnd || msg.sender == rental.renter || msg.sender == machine.owner,
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

        // The container behind these credentials is being torn down by the agent — revoke
        // on-chain access immediately rather than leaving stale (if harmless) ciphertext around.
        delete accessCredentials[rentalId];

        if (refund > 0) {
            (bool success, ) = rental.renter.call{value: refund}("");
            require(success, "Refund failed");
        }

        emit RentalEnded(rentalId, rental.secondsPaid, refund);
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
     * @dev Only machines that are listed AND whose agent heartbeat is still live -
     *      a delisted or offline machine has nothing behind it to actually rent.
     */
    function getAvailableMachines() external view returns (uint256[] memory) {
        // First, count available machines
        uint256 count = 0;
        for (uint256 i = 1; i <= machineCount; i++) {
            if (machines[i].isAvailable && machines[i].owner != address(0) && _isOnline(machines[i])) {
                count++;
            }
        }

        // Then populate array
        uint256[] memory available = new uint256[](count);
        uint256 index = 0;
        for (uint256 i = 1; i <= machineCount; i++) {
            if (machines[i].isAvailable && machines[i].owner != address(0) && _isOnline(machines[i])) {
                available[index] = i;
                index++;
            }
        }

        return available;
    }

    /**
     * @notice Whether a machine's agent heartbeat is currently live (within ONLINE_WINDOW)
     */
    function isMachineOnline(uint256 machineId)
        external
        view
        machineExists(machineId)
        returns (bool)
    {
        return _isOnline(machines[machineId]);
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

}
