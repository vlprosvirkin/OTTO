#!/usr/bin/env tsx
/**
 * Generates a Circle Entity Secret + ciphertext for console registration.
 *
 * Usage (run from arc-openclaw dir):
 *   tsx scripts/setup_entity_secret.ts
 */

import { randomBytes, publicEncrypt, constants } from "crypto";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { readFileSync } from "fs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Load .env
try {
  for (const line of readFileSync(resolve(ROOT, ".env"), "utf-8").split("\n")) {
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    const val = line.slice(eq + 1).trim();
    if (key && val && !process.env[key]) process.env[key] = val;
  }
} catch { /* no .env */ }

const apiKey = process.env.CIRCLE_API_KEY;
if (!apiKey) {
  console.error("Error: CIRCLE_API_KEY not set in .env");
  process.exit(1);
}

// 1. Generate 32-byte entity secret
const secretBytes = randomBytes(32);
const entitySecret = secretBytes.toString("hex"); // 64 hex chars

console.log("\n═══════════════════════════════════════════════════");
console.log("  Circle Entity Secret Generator");
console.log("═══════════════════════════════════════════════════\n");
console.log("1️⃣  New entity secret (save in .env as CIRCLE_ENTITY_SECRET):");
console.log(`\n   ${entitySecret}\n`);

// 2. Fetch Circle's RSA public key
console.log("2️⃣  Fetching Circle public key...");
const res = await fetch("https://api.circle.com/v1/w3s/config/entity/publicKey", {
  headers: { Authorization: `Bearer ${apiKey}` },
});

if (!res.ok) {
  const body = await res.text();
  console.error(`\nFailed: HTTP ${res.status}`);
  console.error(body);
  console.error("\nCheck your CIRCLE_API_KEY is correct.");
  process.exit(1);
}

const { data } = await res.json() as { data?: { publicKey?: string } };
const publicKeyPem = data?.publicKey;

if (!publicKeyPem) {
  console.error("No publicKey in Circle response");
  process.exit(1);
}

// 3. RSA-OAEP encrypt
const encrypted = publicEncrypt(
  { key: publicKeyPem, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: "sha256" },
  secretBytes
);
const ciphertext = encrypted.toString("base64");

console.log("   Done ✓\n");
console.log("3️⃣  Paste this ciphertext into Circle Console:");
console.log("   console.circle.com → Wallets → Developer Controlled → Entity Secret\n");
console.log("─────────────────────────────────────────────────────");
console.log(ciphertext);
console.log("─────────────────────────────────────────────────────\n");
console.log("Then update your .env:");
console.log(`   CIRCLE_ENTITY_SECRET=${entitySecret}`);
console.log("\n═══════════════════════════════════════════════════\n");
