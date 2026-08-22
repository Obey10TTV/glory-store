# Sui testnet rollout

Glory uses MongoDB as the operational source of truth. Sui testnet is an optional, public proof layer for reviewed product attestations and future payment receipts. It is not required to browse, create an account, become a seller or list a product.

## Security boundary

- The API must never hold a Sui private key, seed phrase, mnemonic or keystore path.
- A managed operator wallet holds the Move package administration capability outside Railway.
- The browser can submit a transaction digest, but Glory must retrieve the transaction through the configured Sui gRPC endpoint and verify successful execution before recording a proof.
- Only hashes and public identifiers belong on-chain. Never write passports, business documents, invoices, addresses, phone numbers, account names, photos or full listing text to Sui.
- `SUI_NETWORK` is pinned to `testnet`. Mainnet and crypto checkout remain disabled.

## Required testnet configuration

Set these in Railway only when a testnet package has been deployed:

- `SUI_NETWORK=testnet`
- `SUI_RPC_URL=https://fullnode.testnet.sui.io:443` or another trusted HTTPS testnet gRPC endpoint
- `SUI_PACKAGE_ID`
- `SUI_VERIFICATION_REGISTRY_ID`
- `SUI_VERIFICATION_EVENT_TYPE` (leave blank only when the deployed module is `glory_verification::ProductVerified`)
- `SUI_EXPLORER_BASE_URL=https://suiscan.xyz/testnet`

Do not add Sui signing material to Railway, Vercel, `.env.example`, GitHub, browser storage or source code.

## Before enabling a badge or payment option

1. Deploy and test the Move verification package on Sui testnet from an operator-controlled wallet.
2. Record package and registry object IDs only in Railway configuration.
3. Verify that a product proof transaction has a successful status, comes from the configured package and creates the expected event/object before MongoDB is updated.
4. Test duplicate digest rejection, revocation, bad package IDs, failed transactions, expired payment intents and RPC outages.
5. Keep SUI/USDC checkout disabled until a buyer-signed transaction flow validates sender, recipient, coin type, amount, nonce, expiry and transaction-digest uniqueness on the server.
