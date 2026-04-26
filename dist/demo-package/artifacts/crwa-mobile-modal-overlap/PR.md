# Bug

The mobile bottom navigation renders above an open modal on small screens.

# Repro

- Route: `/signin`
- Viewport: `iPhone 13 (390x844)`
- Auth mode: `storageState`
- Steps:
  - Launch app on the canonical local origin
  - Restore authenticated browser state
  - Open the target flow that triggers the modal
  - Set a mobile viewport
  - Capture the failing modal overlap state

# Root Cause

Pending implementation.

# Fix

Pending implementation.

# Changed Files

- Pending implementation.

# Before Evidence

- Screenshot: `./artifacts/crwa-mobile-modal-overlap/failure.png`
- Trace: `./artifacts/crwa-mobile-modal-overlap/trace.zip`
- Console: `./artifacts/crwa-mobile-modal-overlap/console.ndjson`
- Network: `./artifacts/crwa-mobile-modal-overlap/network.ndjson`

# After Evidence

- Screenshot: `./artifacts/crwa-mobile-modal-overlap/success.png`
- Verification: `./artifacts/crwa-mobile-modal-overlap/verify.json`

# Verification

- The modal visually appears above the bottom navigation
- The relevant Playwright assertion passes
- No new console errors appear in the target flow
- The app build remains green

# Residual Risk

Pending implementation.
