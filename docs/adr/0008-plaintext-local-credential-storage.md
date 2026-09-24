# ADR 0008: Plaintext Local Storage for AI Credentials

## Status
Accepted

## Context
`read-buddy` is a personal, client-side offline-first desktop reading application. Storing third-party AI credentials (API keys) can either utilize:
1. **OS Keychain / Stronghold Encryption**: Requires native system keystore bridge plugins, password unlocks, and platform-specific native dependencies.
2. **Plaintext Local Storage**: Persisting configuration directly into the client's local IndexedDB / SQLite database.

## Decision
We select **Plaintext Local Storage** for AI credentials:
- Configuration is stored directly in local client storage.
- No OS keychain dependency or unlock dialogues are required.
- The UI masks the secret key visually (`sk-***`) during display.

## Consequences

### Positive
- **Simplicity**: Zero friction in installation, zero OS keychain permission issues, and zero external cryptographic dependencies.
- **Portability**: Database backup and sync mechanisms remain straightforward.

### Negative / Trade-offs
- If an adversary achieves local filesystem read access to the user's local application data directory, the API key is accessible in plaintext.
