The toast notifications are not visible to the user. Every transaction (deposit, rent, withdraw, list, accept, etc.) calls showToast() but nothing appears on screen. Fix the toast system completely.

## Rebuild showToast in frontend/index.html:
1. Find the existing showToast function and the toast container element.
2. Make toasts HIGHLY visible:
   - Fixed position, bottom-right corner, z-index 99999 (above everything including modals)
   - Large enough to read: min-width 300px, padding 16px 20px
   - Success = green with checkmark icon, error = red, warning = amber, info = blue
   - Slide in from the right with animation, stay for 4 seconds, then slide out
   - Multiple toasts stack vertically
3. Make sure the toast container exists in the HTML and is never hidden by modals or overflow.
4. Test that showToast('Test message', 'success') actually renders a visible green toast.

## Also verify these show success toasts after confirmation:
- depositFromMetaMask: "Deposited X ETH"
- submitRental: "Rental requested!"
- acceptRental: "Rental accepted!"
- endRental / cancel: "Rental ended, funds settled"
- withdrawEarnings: "Withdrew X ETH"
- sendFunds: "Sent X ETH"
- submitMachine: "Machine listed!"
- delistMachine: "Machine delisted"
Each must fire AFTER tx.wait() confirms, and each must be clearly visible.

The core problem is likely the toast CSS (positioning, z-index, or the container missing). Fix it so toasts are always visible on top of everything.
