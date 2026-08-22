# Glory verification package

This Move package creates a shared verification registry and allows only the holder of `AdminCap` to create or revoke a public product-verification object.

It stores only:

- a 32-byte product attestation hash;
- a 32-byte evidence hash;
- public Sui object IDs and the public issuer address;
- active/revoked state.

It never stores a seller name, government ID, business/tax record, invoice, address, image, barcode, batch code, full listing text or payment information.

## Testnet workflow

1. Install the Sui CLI on the operator machine.
2. Create a separate `glory-testnet-operator` address and retain its recovery backup outside this repository.
3. Add/select Sui testnet and request faucet funds for that address.
4. From this directory, run `sui move build` then `sui move test`.
5. Publish with the selected testnet operator address.
6. Save the resulting package ID and `VerificationRegistry` object ID as Railway variables. Keep `AdminCap` in the operator wallet.
7. Call `verify_product` only after Glory's normal seller and product review is complete.

The source is intentionally not wired to any buyer payment flow. Testnet product verification is the only intended use of this package.
