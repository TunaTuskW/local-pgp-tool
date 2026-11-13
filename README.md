# Local PGP Tool (Dockerized & 100% Client-Side)

A self-hosted, offline-capable OpenPGP web workbench powered by **OpenPGP.js v6.3.2** (vendored locally—zero external CDN requests).

## Features (5 Tabs)
1. **Generate PGP Keys** — Create ECC (Curve25519 / NIST P-256) or RSA (2048 / 4096) key pairs with optional expiration, passphrase, and revocation certificate.
2. **Sign** — Create clearsigned messages or detached PGP signatures using your private key.
3. **Verify** — Verify clearsigned messages or detached signatures against a sender's public key.
4. **Encrypt** — Encrypt messages for one or multiple recipient public keys (with optional sign-then-encrypt or symmetric password).
5. **Decrypt** — Decrypt PGP messages using your private key (or symmetric password) and optionally verify an embedded sender signature.

## Quick Start with Docker

```bash
docker compose up -d --build
```

Then open **http://localhost:8080** in your browser.

### Or with plain `docker`:

```bash
docker build -t local-pgp-tool .
docker run -d --name local-pgp-tool -p 8080:80 local-pgp-tool
```

## Security Design
- **Offline & Self-Contained:** `openpgp.min.js` is bundled locally in `public/vendor/`.
- **Strict CSP (`connect-src 'none'`):** `nginx.conf` prevents the browser from making any outbound network requests.
- **In-Memory Only:** Keys and messages are never saved to `localStorage`, cookies, or sent to any server.
