Restyle the APP screens (Marketplace, My Machines, My Rentals, Dashboard, rental
detail) to match the new landing design. They still look like the OLD website - big
flat boxy cards, long text blocks. Bring them up to the new visual system WITHOUT
changing any logic. This is a VISUAL restyle only.

## What's wrong now
- Dashboard stat cards, marketplace machine cards, rental-detail stat boxes are big,
  flat, and boxy - old style. Long paragraph messages feel heavy.
- They should match the new landing: the same dark violet/cyan system, cleaner and
  more compact cards, rounded/glassy style, subtle motion (hover lift, glow, entrance
  animation), and shorter punchy text instead of long sentences.

## What to do
- Restyle the shared app card classes (machine cards, rental cards, the .metric/stat
  boxes, dashboard stat cards, rental-detail panels) to the new design language:
  compact, rounded, glassy, violet/cyan accents, hover motion, tasteful entrance
  reveal. Make cards feel like polished popup-style cards, not big flat boxes - smaller,
  denser, cleaner.
- Shorten heavy copy: e.g. long lines like "Provider's agent is offline — can't be
  rented until it reconnects." and "Paid out and time remaining update live, assuming
  the machine stays online — they resync from the blockchain every 15 seconds." and
  "Decrypted locally with a key only your wallet can reproduce — nobody else can read
  this, including us." -> make them short and clean (a few words), remove em-dashes.
- Keep the SAME data and the SAME numbers shown - just present them in cleaner, more
  compact, animated cards.
- Add subtle animation: cards fade/slide in when a tab loads, hover states, soft glow.

## ABSOLUTELY do not break (these live in these exact screens)
- The rent flow, requestRental + encryption signature, Accept/Decline.
- The SSH Access panel: Show SSH Access, the decrypt signature, credential display.
- The per-second live ticker + offline-freeze (Term/Time remaining, Escrow left, Paid
  out) - keep it working exactly, just restyle its cards.
- Withdraw Earnings, Cancel Rental & Settle, machine registration, Authorize Device,
  Delist.
- Every element ID the JS reads/updates (the ticker writes to these live), all onclick
  handlers, all contract calls. Restyle CSS + shorten text only - do not touch the JS,
  the data flow, or the IDs.

## Process
Because these screens hold the core working logic, be careful: restyle the CSS classes
and shorten text strings only. After, test on localhost:3000 - every flow must still
work: connect wallet, browse marketplace, rent (with encryption sig), Show SSH Access +
decrypt, the live ticker moving + freezing when offline, withdraw, register machine,
all tabs/modals. Confirm the ticker still updates the restyled cards live. Don't push
until I confirm.
