Fix Privy integration. Two console errors:
1. "Embedded wallet proxy not initialized"
2. "PrivyApiError: Invalid email and code combination" (422 from auth API)

The root cause is the Privy SDK is not fully initialized before auth calls. Fix the initialization flow:
- Make sure PrivyClient is created with proper config including embeddedWallets
- Wait for the SDK to be fully ready before enabling the login button
- The embedded wallet proxy needs to be initialized before calling loginWithCode
- Check Privy JS SDK Core docs - the email OTP flow needs auth.email.sendCode() then auth.email.loginWithCode() with the correct parameters
- Add proper error logging so we can see what fails
- Disable the Sign In button until SDK reports ready
