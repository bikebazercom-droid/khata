#!/usr/bin/env bash
# =============================================================================
#  BanglaKhata — master build pipeline
#  Usage:  pnpm run build:all
# =============================================================================
set -euo pipefail

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
RESET='\033[0m'

DOWNLOADS_DIR="$(cd "$(dirname "$0")/.." && pwd)/artifacts/api-server/public/downloads"

echo ""
echo -e "${BOLD}${BLUE}╔══════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${BLUE}║       BanglaKhata — Automated Build Pipeline         ║${RESET}"
echo -e "${BOLD}${BLUE}╚══════════════════════════════════════════════════════╝${RESET}"
echo ""

# ── Step 1: Ensure downloads directory exists with write permissions ──────────
echo -e "${CYAN}[1/3] Verifying downloads directory …${RESET}"
mkdir -p "$DOWNLOADS_DIR"
chmod 775 "$DOWNLOADS_DIR"
# Ensure any existing binaries in the folder are group-writable
find "$DOWNLOADS_DIR" -maxdepth 1 -type f \( -name "*.apk" -o -name "*.exe" -o -name "*.dmg" \) \
  -exec chmod 664 {} \; 2>/dev/null || true
echo -e "${GREEN}    ✓ ${DOWNLOADS_DIR}${RESET}"
echo ""

# ── Step 2: Trigger EAS Android build (cloud, non-interactive) ────────────────
echo -e "${CYAN}[2/3] Submitting Android APK build to EAS …${RESET}"
echo -e "      Profile: ${BOLD}preview${RESET}  |  Platform: ${BOLD}android${RESET}  |  Output: ${BOLD}.apk${RESET}"
echo ""

cd "$(dirname "$0")/../artifacts/khatabook-mobile"
pnpm run build:apk

echo ""
echo -e "${GREEN}[2/3] ✓ EAS build job submitted.${RESET}"
echo ""

# ── Step 3: Print sync instructions ───────────────────────────────────────────
echo -e "${BOLD}${YELLOW}╔══════════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}${YELLOW}║           Binary Sync Instructions                   ║${RESET}"
echo -e "${BOLD}${YELLOW}╚══════════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  EAS builds run in the cloud. Once your build completes:"
echo ""
echo -e "  ${BOLD}Option A — Admin Upload UI (recommended)${RESET}"
echo -e "  1. Open  ${CYAN}/admin/settings${RESET}  in your browser."
echo -e "  2. Scroll to ${BOLD}\"অ্যাপ বাইনারি আপলোড\"${RESET}."
echo -e "  3. Click ${BOLD}Android APK আপলোড করুন${RESET} and select the downloaded .apk file."
echo -e "  4. The download button on the landing page activates immediately."
echo ""
echo -e "  ${BOLD}Option B — Direct file copy (CLI)${RESET}"
echo -e "  1. Download the .apk from the EAS build URL printed above."
echo -e "  2. Copy it into the downloads directory:"
echo ""
echo -e "     ${CYAN}cp ~/Downloads/banglakhata.apk \\"
echo -e "        ${DOWNLOADS_DIR}/banglakhata.apk${RESET}"
echo ""
echo -e "  3. The file is served immediately at:"
echo -e "     ${CYAN}/api/downloads/banglakhata.apk${RESET}"
echo ""
echo -e "  ${BOLD}Windows EXE / macOS DMG${RESET}"
echo -e "  Use the same Admin Upload UI for Windows (.exe) and macOS (.dmg) binaries."
echo -e "  Target directory: ${CYAN}${DOWNLOADS_DIR}/${RESET}"
echo ""
echo -e "${GREEN}${BOLD}Done.${RESET}"
echo ""
