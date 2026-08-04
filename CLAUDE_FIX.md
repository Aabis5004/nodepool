Fix rental payment and make it per-second streaming with auto-expiry. Read
contracts/NodePool.sol, agent/agent.js, and frontend/index.html first, and explain
the current settlement logic and WHY a completed ~1-hour rental just paid out 0
(the rental showed "0 of 1 hours paid out, 0%" and refunded the full deposit to the
renter, provider earned nothing). Give a PLAN and confirm with me before writing
code or deploying. Do NOT deploy without my go.

## Diagnose first
- Explain exactly why that rental verified 0 uptime and paid 0. Is it because
  reportUptime only credits whole completed hours, because the agent's reportUptime
  calls failed/were skipped, or because settlement rounds down to whole hours? Show
  the relevant contract lines.

## Target model: per-second streaming payment
- Change settlement from whole-hours to per-SECOND. The rental has startTime and a
  paid duration (hours * 3600 seconds). The amount owed to the provider at any moment
  is elapsedSeconds * (pricePerHour / 3600), capped at the deposit. Elapsed is
  min(now, startTime + paidDurationSeconds) - startTime, so it stops growing at the
  end.
- The provider's earned amount should therefore increase every second automatically
  from the timestamps — no per-second transaction (that's impossible on-chain).
  Settlement (actually moving ETH to the provider's withdrawable balance) happens on
  claim/withdraw and on rental end, computed from elapsed seconds.
- IMPORTANT: uptime should still gate payment (provider only earns while the machine
  is actually online), but the accrual must be per-second of verified-online time,
  not rounded to whole hours. Decide the cleanest way: e.g. track last-verified
  timestamp and credit the online interval in seconds. Explain your approach.

## Auto-offline / auto-expiry
- When elapsed >= paidDurationSeconds, the rental is over: the contract treats it as
  ended (no more accrual), the provider can claim final payment, and remaining escrow
  (if any) refunds correctly.
- The agent must detect the rental leaving the active set and tear down the
  container + tunnel (this already exists for end/cancel — make sure expiry triggers
  it too).
- The machine should return to available/online for new rentals after expiry.

## Frontend
- Rental detail: show earned/paid amount and time remaining ticking DOWN every second
  live (computed client-side from startTime + rate, matching the contract math), and
  escrow-left ticking down. Provider dashboard: show real earnings that reflect
  streamed accrual, and per-rental history (which address rented, when, how much
  paid).
- Provider "Withdraw Earnings" must actually pay out the accrued streamed amount.

## Constraints
- Keep existing security: device key can only report uptime / write creds / set
  online, never move funds. Owner-only for withdraw/delist.
- One active rental per machine (unchanged).
- Fresh deploy since contract changes; update CONTRACT_ADDRESS in frontend,
  agent/.env, deployments.json (all three match).

## Process
Diagnose + plan first, confirm with me, then implement in phases, hold deploy until
I say go.
