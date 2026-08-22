module glory_verification::glory_verification {
    use std::vector;
    use sui::event;
    use sui::object::{Self, ID, UID};
    use sui::transfer;
    use sui::tx_context::{Self, TxContext};

    const E_INVALID_HASH: u64 = 0;
    const E_ALREADY_REVOKED: u64 = 1;

    // This capability is transferred to the package publisher during deployment.
    // It must remain in the operator-controlled testnet wallet, never in Railway.
    public struct AdminCap has key, store {
        id: UID,
    }

    // Shared only to provide a public, stable registry object for explorers and
    // Glory's backend configuration. It holds no personal or product data.
    public struct VerificationRegistry has key {
        id: UID,
        issued_count: u64,
    }

    public struct ProductVerification has key, store {
        id: UID,
        registry_id: ID,
        product_hash: vector<u8>,
        evidence_hash: vector<u8>,
        active: bool,
        issued_by: address,
    }

    public struct ProductVerified has copy, drop {
        registry_id: ID,
        verification_id: ID,
        product_hash: vector<u8>,
        evidence_hash: vector<u8>,
        issued_by: address,
    }

    public struct ProductVerificationRevoked has copy, drop {
        verification_id: ID,
        revoked_by: address,
    }

    fun init(ctx: &mut TxContext) {
        let admin_cap = AdminCap { id: object::new(ctx) };
        let registry = VerificationRegistry {
            id: object::new(ctx),
            issued_count: 0,
        };

        transfer::transfer(admin_cap, tx_context::sender(ctx));
        transfer::share_object(registry);
    }

    public fun verify_product(
        _admin_cap: &AdminCap,
        registry: &mut VerificationRegistry,
        product_hash: vector<u8>,
        evidence_hash: vector<u8>,
        ctx: &mut TxContext,
    ) {
        assert!(has_expected_hash_length(&product_hash), E_INVALID_HASH);
        assert!(has_expected_hash_length(&evidence_hash), E_INVALID_HASH);

        let product_hash_for_event = copy product_hash;
        let evidence_hash_for_event = copy evidence_hash;
        let registry_id = object::id(registry);
        let issuer = tx_context::sender(ctx);
        let verification = ProductVerification {
            id: object::new(ctx),
            registry_id,
            product_hash,
            evidence_hash,
            active: true,
            issued_by: issuer,
        };
        let verification_id = object::id(&verification);
        registry.issued_count = registry.issued_count + 1;

        event::emit(ProductVerified {
            registry_id,
            verification_id,
            product_hash: product_hash_for_event,
            evidence_hash: evidence_hash_for_event,
            issued_by: issuer,
        });
        transfer::share_object(verification);
    }

    public fun revoke_product(
        _admin_cap: &AdminCap,
        verification: &mut ProductVerification,
        ctx: &TxContext,
    ) {
        assert!(verification.active, E_ALREADY_REVOKED);
        verification.active = false;
        event::emit(ProductVerificationRevoked {
            verification_id: object::id(verification),
            revoked_by: tx_context::sender(ctx),
        });
    }

    public fun registry_id(registry: &VerificationRegistry): ID {
        object::id(registry)
    }

    public fun verification_id(verification: &ProductVerification): ID {
        object::id(verification)
    }

    public fun is_active(verification: &ProductVerification): bool {
        verification.active
    }

    fun has_expected_hash_length(hash: &vector<u8>): bool {
        vector::length(hash) == 32
    }

    #[test]
    fun accepts_a_32_byte_attestation_hash() {
        let hash = vector[
            0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0,
            0, 0, 0, 0, 0, 0, 0, 0,
        ];
        assert!(has_expected_hash_length(&hash), 0);
    }

    #[test]
    fun rejects_a_short_attestation_hash() {
        let hash = vector[0, 0, 0];
        assert!(!has_expected_hash_length(&hash), 0);
    }
}
