/**
 * ═══════════════════════════════════════════════════════════════════
 *  Admin Password Configuration
 *
 *  This password protects the /api/settings/* endpoints.
 *  Only someone who knows this password can add or change API keys
 *  through the Settings page.
 *
 *  HOW TO SET YOUR PASSWORD:
 *  Change the string below to whatever password you want.
 *  After saving, restart the server for it to take effect.
 *
 *  You can also override it at runtime without touching this file
 *  by setting the ADMIN_PASSWORD environment variable (Replit Secrets).
 *  The environment variable always takes priority over the value here.
 * ═══════════════════════════════════════════════════════════════════
 */

export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? "4964$Leka?";
