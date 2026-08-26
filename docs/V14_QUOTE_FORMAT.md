# B2BSplitter v1.4 — EIP-712 Quote Format

**Status:** design spec
**Audience:** backend, SDK, frontend, audit

This document defines the exact bytes that the backend must sign and the contract must verify. Any deviation will cause a settlement revert (`InvalidSignature` or `SignatureExpired`).

---

## 1. Role Context

Signatures must come from an address that holds the contract's **`SIGN_OPERATOR_ROLE`** (a custom role defined in `AccessControl`). The role is held by the backend hot key (typically a public key generated in an HSM/KMS). The backend operator must:

1. Hold a secp256k1 keypair (`K_priv`, `K_pub`).
2. Register `K_pub` with the contract's `ADMIN_ROLE` holder via `grantSignerRole(K_pub)`. The grant is timelock-gated (48h on production).
3. Use `K_priv` only inside the signing service. Never expose `K_priv` to a UI, a frontend, or an agent wallet.

The contract enforces signature validity via `ecrecover` + `hasRole(SIGN_OPERATOR_ROLE, recovered)`. See `V14_ARCHITECTURE.md` §3.2 for the role model.

---

## 2. Domain Separator

```solidity
DOMAIN_SEPARATOR = keccak256(
    abi.encode(
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
        keccak256(bytes("AiFinPayB2BSplitter")),
        keccak256(bytes("1")),
        block.chainid,           // ← per-chain binding
        address(this)            // ← per-contract binding at the same chain
    )
)
```

| Field | Type | Source | Purpose |
|---|---|---|---|
| `name` | `string` | literal `"AiFinPayB2BSplitter"` | Human-readable name shown in wallets |
| `version` | `string` | literal `"1"` | Bumped if the typed-data layout ever changes; contract stores and asserts |
| `chainId` | `uint256` | `block.chainid` | Prevents cross-chain replay |
| `verifyingContract` | `address` | `address(this)` | Prevents cross-contract replay at the same chain |

The domain separator is computed once at construction and cached. If `block.chainid` ever changes (EIP-155 chain aliasing is rare), the cached value becomes stale; the contract must recompute on each settlement and store the new value if it differs. The standard OZ implementation does this in the constructor's `_domainSeparatorV4` flow.

---

## 3. Quote Type Hash

```solidity
QUOTE_TYPEHASH = keccak256(
    "Quote(address payer,address merchant,address token,uint256 grossAmount,address ipCreator,uint256 validUntil,bytes32 orderIdHash,uint256 nonce,bytes32 routeId)"
)
```

The field order in the typehash **must match** the field order in `abi.encode`. Solidity does not reorder fields automatically.

---

## 4. Quote Struct

```solidity
struct Quote {
    address payer;        // 20 bytes  — settlement is paid by this address
    address merchant;     // 20 bytes  — receives gross − treasury − ip
    address token;        // 20 bytes  — address(0) for native, USDC/USDT for stable
    uint256 grossAmount;  // 32 bytes  — exactly what the payer sends (msg.value or approve amount)
    address ipCreator;    // 20 bytes  — address(0) if route has no creator leg
    uint256 validUntil;   // 32 bytes  — UNIX seconds; must be > block.timestamp
    bytes32 orderIdHash;  // 32 bytes  — keccak256(bytes(orderId))
    uint256 nonce;        // 32 bytes  — must equal payerNonce[payer] at settlement time
    bytes32 routeId;      // 32 bytes  — keccak256(route name)
}
```

### 4.1 Field semantics

| Field | Type | Required | Notes |
|---|---|---|---|
| `payer` | address | yes | Must equal `msg.sender` at settlement. The contract reverts `InvalidPayer` if not. |
| `merchant` | address | yes | Cannot be `address(0)` (contract reverts `ZeroMerchant`). |
| `token` | address | yes | `address(0)` for native settlement; one of `whitelistedTokens` for stable settlement. Contract reverts `InvalidTokenForNative` or `UnsupportedToken`. |
| `grossAmount` | uint256 | yes | For native, must equal `msg.value` exactly. For stable, must equal the `safeTransferFrom` amount. Cannot be zero (`ZeroAmount`). |
| `ipCreator` | address | depends | If the route's `ipCreatorBps == 0`, `address(0)` is allowed. If `ipCreatorBps > 0`, must be non-zero (contract reverts `MissingIPCreator`). |
| `validUntil` | uint256 | yes | Must be `> block.timestamp` at settlement. Cannot be zero. Backend should set `validUntil = now + ttl` where `ttl` is per-route (recommended ≤ 1 hour). |
| `orderIdHash` | bytes32 | yes | `keccak256(bytes(orderId))`. Backend must hash the off-chain `orderId` once and never re-publish a different `orderId` under the same hash. Frontend/SDK should also hash and verify. |
| `nonce` | uint256 | yes | Must equal `payerNonce[payer]` exactly. Contract reverts `InvalidNonce` otherwise. |
| `routeId` | bytes32 | yes | `keccak256("agent-x402")` or `keccak256("merchant-aifp1")` (or any other ADMIN-configured route). Contract checks the route exists and is enabled; reverts `UnknownRoute` or `RouteDisabled` otherwise. |

### 4.2 Why these fields

- `payer` — the contract rejects any settlement where `msg.sender != quote.payer`. This binds the signature to a specific EOA; an attacker who steals the signature cannot rebroadcast it from a different wallet.
- `merchant` — locks the payee.
- `token` — locks the asset; the SDK cannot "forget" to switch from USDC to a malicious token.
- `grossAmount` — locks the exact settlement size; the SDK cannot inflate it.
- `ipCreator` — locks the royalty recipient.
- `validUntil` — front-end bounded window.
- `orderIdHash` — locks the off-chain identifier; if the backend reuses `orderId` for a different quote, the hashes will differ and the contract will reject.
- `nonce` — replay protection per payer.
- `routeId` — binds the quote to a specific route profile. Same nonce + same `orderIdHash` + different `routeId` produces a different digest; the original signature does not validate for the new route.

### 4.3 `routeId` enumeration

| Route name (literal) | `routeId = keccak256(bytes(name))` | Default profile |
|---|---|---|
| `"agent-x402"` | `0x...` (literal bytes32) | `treasuryBps = 0`, `ipCreatorBps = 0` |
| `"merchant-aifp1"` | `0x...` (literal bytes32) | `treasuryBps = 100`, `ipCreatorBps = 0` |

ADMIN can configure additional routes via `configureRoute(routeId, treasuryBps, ipCreatorBps, routeTreasury)`. The contract does **not** restrict the `routeId` to these two values; any `bytes32` is allowed, with caps (`treasuryBps ≤ 500`, `ipCreatorBps ≤ 100`).

---

## 5. Hash Computation

```solidity
function _hashTypedDataV4(Quote calldata _quote) internal pure returns (bytes32) {
    return keccak256(
        abi.encode(
            _QUOTE_TYPEHASH,
            _quote.payer,
            _quote.merchant,
            _quote.token,
            _quote.grossAmount,
            _quote.ipCreator,
            _quote.validUntil,
            _quote.orderIdHash,
            _quote.nonce,
            _quote.routeId
        )
    );
}

function _digest(Quote calldata _quote) internal view returns (bytes32) {
    return keccak256(
        abi.encode(
            DOMAIN_SEPARATOR,
            _hashTypedDataV4(_quote)
        )
    );
}
```

This is the standard EIP-712 double-hash. Wallets that recognise EIP-712 will display the structured data to the user before signing.

---

## 6. Signature Recovery

```solidity
address recovered = ECDSA.recover(_digest(_quote), _signature);
if (recovered == address(0)) revert InvalidSignature();
if (!hasRole(SIGN_OPERATOR_ROLE, recovered)) revert InvalidSigner();
if (_signature.length != 65) revert InvalidSignatureLength();
```

The signature is 65 bytes:
- `[0]` — recovery id (27 or 28)
- `[1..32]` — r
- `[33..64]` — s

`s` must be in the lower half-order (EIP-2). OpenZeppelin's `ECDSA.recover` handles this; we delegate to it.

`InvalidSigner` and `InvalidSignature` are distinct errors:
- `InvalidSignature` — recovery returned `address(0)` (malformed signature) or wrong length
- `InvalidSigner` — recovery returned a valid address, but that address is not a `SIGN_OPERATOR_ROLE` holder

This distinction helps backend observability: `InvalidSigner` means the recovered address is well-formed but lacks authority (likely a misconfigured signer key or a leaked key whose role has been revoked); `InvalidSignature` means a corrupted/garbled signature.

---

## 7. Backend Responsibilities

The backend's quote-signing service must:

1. **Authenticate the payer.** The payer sends a JWT or signed auth header. Backend must verify the wallet address claimed in the JWT matches `quote.payer`.
2. **Verify business policy.** Quotas, KYC, AML, daily limits — all in backend DB. The contract is not aware of these.
3. **Read route profile.** Backend calls `getProfile(routeId)` on the contract (or uses a cached version) to confirm the requested route is enabled and the user agrees with the implied economics.
4. **Assign `nonce = payerNonce(payer)`** by reading `payerNonce(payer)` from the contract (via RPC). If the contract returns nothing, the next nonce is 0.
5. **Set `validUntil`** to `now + quoteTtl(route)`. The TTL is per-route; production recommendation is 15 minutes for `agent-x402` and 1 hour for `merchant-aifp1`. Shorter windows reduce the impact of a leaked signature.
6. **Compute `orderIdHash = keccak256(bytes(orderId))`**. Store `(orderIdHash, quote, signature)` in the backend DB. Reject any request to re-sign under the same `orderId` with a different payload.
7. **Sign with the hot key** (`K_priv`). The key is the only thing that can produce a valid quote. Backend must keep it in an HSM or KMS.
8. **Return `{quote, signature}`** to the SDK. The SDK hands both to the contract in one transaction.

### 7.1 Backend must not do

- **Sign a quote whose `payer` the backend did not authenticate.** Otherwise the quote is forgeable for any wallet the signer wants.
- **Sign a quote whose `grossAmount` differs from the price the SDK quoted.** Otherwise the price is meaningless.
- **Sign a quote whose `routeId` is not configured or is disabled.** Otherwise the settlement will revert `RouteDisabled`.
- **Sign with a key whose `SIGN_OPERATOR_ROLE` has been revoked.** The contract will reject, but the user pays gas for the revert.
- **Sign a quote with `validUntil = 0` or `validUntil < now`.** Always rejected.

---

## 8. SDK / Frontend Responsibilities

The SDK must:

1. **Receive `{quote, signature}` from backend.** Never construct quotes locally.
2. **Display the quote to the user** (using EIP-712 typed data). Wallets like MetaMask will render the struct automatically. The display must include:
   - `payer` (the connected wallet)
   - `merchant` (who receives the funds)
   - `token` (USDC, USDT, or "native")
   - `grossAmount` (the exact amount)
   - `validUntil` (countdown)
   - `routeId` (human-readable: "agent-x402" or "merchant-aifp1")
3. **Verify `orderIdHash`** if the SDK has access to the off-chain `orderId`. Hash locally and check `keccak256(bytes(orderId)) == quote.orderIdHash`.
4. **Check `quote.validUntil` against current time.** If expired, do not submit; request a fresh quote.
5. **Send `settleNative(quote, signature)` with `msg.value == quote.grossAmount`** for native. Send `settleStable(quote, signature)` after `approve(splitter, quote.grossAmount)` for stable.
6. **Never re-broadcast a settled quote.** Check `consumedNonce(payer, nonce)` first via RPC.
7. **Refuse to submit a quote whose `routeId` is not in the SDK's allow-list.** The SDK should maintain a list of routeIds it understands (initially `agent-x402` and `merchant-aifp1`). Routes added by ADMIN after the SDK is shipped will not be recognised by old SDKs — this is acceptable; old SDKs gracefully refuse.

---

## 9. Payer Responsibilities

The payer (agent wallet) must:

1. **Approve the splitter for `quote.grossAmount`** before calling `settleStable`.
2. **Send `msg.value == quote.grossAmount`** with `settleNative`.
3. **Not sign the quote themselves.** The quote is signed by the backend; the payer just submits the transaction.

The payer's wallet signature is the regular EOA signature on the `settle*` transaction. There is no additional signature from the payer required.

---

## 10. Worked Example

### 10.1 Backend: sign a `merchant-aifp1` quote

```javascript
// Off-chain
const routeId    = ethers.keccak256(ethers.toUtf8Bytes("merchant-aifp1"));
const payer      = "0xAgent...";
const merchant   = "0xMerchant...";
const token      = "0xUSDC...";            // or address(0) for native
const grossAmount = 1_000_000n;            // 1 USDC (6 decimals)
const ipCreator  = ethers.ZeroAddress;     // merchant-aifp1, no creator leg
const validUntil = Math.floor(Date.now()/1000) + 900;  // 15 min
const orderId    = "order-12345";
const orderIdHash = ethers.keccak256(ethers.toUtf8Bytes(orderId));
const nonce      = await splitter.payerNonce(payer);  // 0 for first-time

const domain = {
  name: "AiFinPayB2BSplitter",
  version: "1",
  chainId: 137,
  verifyingContract: await splitter.getAddress()
};

const types = {
  Quote: [
    { name: "payer",        type: "address" },
    { name: "merchant",     type: "address" },
    { name: "token",        type: "address" },
    { name: "grossAmount",  type: "uint256" },
    { name: "ipCreator",    type: "address" },
    { name: "validUntil",   type: "uint256" },
    { name: "orderIdHash",  type: "bytes32" },
    { name: "nonce",        type: "uint256" },
    { name: "routeId",      type: "bytes32" }
  ]
};

const quote = { payer, merchant, token, grossAmount, ipCreator, validUntil, orderIdHash, nonce, routeId };

// Backend signs with hot key (KMS / HSM)
const signature = await backendSigner.signTypedData(domain, types, quote);

// Backend returns to SDK
return { quote, signature };
```

### 10.2 SDK: submit

```javascript
// SDK receives the signed quote, displays it, then submits
const tx = await splitter
  .connect(agentWallet)
  .settleStable(quote, signature, { gasLimit: 300_000 });

const receipt = await tx.wait();
```

### 10.3 Contract: verify and settle

```solidity
// Pseudocode of what the contract does
function settleStable(Quote calldata q, bytes calldata sig) external nonReentrant whenNotPaused {
    bytes32 digest = _digest(q);
    address signer = ECDSA.recover(digest, sig);
    if (signer == address(0)) revert InvalidSignature();
    if (sig.length != 65) revert InvalidSignatureLength();
    if (!hasRole(SIGN_OPERATOR_ROLE, signer)) revert InvalidSigner();
    if (block.timestamp > q.validUntil) revert SignatureExpired(q.validUntil, block.timestamp);
    if (q.payer != msg.sender) revert InvalidPayer();
    if (q.nonce != payerNonce[q.payer]) revert InvalidNonce();
    if (q.token == address(0) || !whitelistedTokens[q.token]) revert UnsupportedToken();
    if (q.merchant == address(0)) revert ZeroMerchant();

    RouteProfile memory p = profiles[q.routeId];
    if (!p.enabled) revert RouteDisabled(q.routeId);

    unchecked { payerNonce[q.payer] = q.nonce + 1; }
    consumedNonce[q.payer][q.nonce] = true;

    (uint256 m, uint256 t, uint256 i) = _splitGross(q.grossAmount, p, q.ipCreator);

    IERC20(q.token).safeTransferFrom(msg.sender, q.merchant, m);

    address routeTreasury = p.routeTreasury == address(0) ? treasury : p.routeTreasury;
    if (t > 0) IERC20(q.token).safeTransferFrom(msg.sender, routeTreasury, t);
    if (i > 0) IERC20(q.token).safeTransferFrom(msg.sender, q.ipCreator, i);

    emit Payment(keccak256(abi.encode(q)), q, m, t, i, q.routeId);
}
```

---

## 11. Failure-Mode Reverts

| Revert | Cause | Backend/SDK remediation |
|---|---|---|
| `InvalidSignature()` | ECDSA recovery returned `address(0)` | Backend bug — signature is malformed |
| `InvalidSignatureLength()` | Signature not 65 bytes | Never accept non-65-byte signatures from backend |
| `InvalidSigner()` | Recovery returned a valid address, but it has no `SIGN_OPERATOR_ROLE` | Signer key has been revoked or never granted; rotate to a new key |
| `SignatureExpired(q.validUntil, block.timestamp)` | `validUntil <= now` | Request a new quote from backend |
| `InvalidPayer()` | `quote.payer != msg.sender` | SDK/frontend bug — agent wallet must match backend-issued payer |
| `InvalidNonce()` | `quote.nonce != payerNonce[payer]` | Backend must re-fetch nonce and re-issue |
| `NonceAlreadyConsumed()` | `consumedNonce[payer][nonce] == true` | Replay attempt; do not retry |
| `NonceOverflow()` | `payerNonce[payer]` would exceed `type(uint256).max` | Practically impossible; if hit, agent must migrate wallet |
| `UnknownRoute(_routeId)` | `routeId` not in `profiles` mapping | Backend signed a typo; check routeId computation |
| `RouteDisabled(_routeId)` | `profiles[routeId].enabled == false` | Backend rejected; user must request a quote under a different `routeId` |
| `InvalidOrderIdHash()` | (reserved for future use) | n/a |
| `UnsupportedToken()` | `quote.token` not whitelisted | Payer requested wrong quote; SDK must reject and request fresh |
| `InvalidTokenForNative()` | `settleNative` called with non-zero `token` | SDK bug; `settleNative` requires `token == address(0)` |
| `IncorrectNativeValue(expected, received)` | `msg.value != grossAmount` | SDK must set `msg.value = grossAmount` exactly |
| `ZeroAmount()` | `grossAmount == 0` | Backend bug; do not issue zero-value quotes |
| `ZeroMerchant()` | `merchant == address(0)` | Backend must require non-zero merchant |
| `MissingIPCreator()` | `route.ipCreatorBps > 0` but `ipCreator == address(0)` | Backend must require creator if the route's profile demands it |
| `PaymentTooSmallForTreasury()` / `PaymentTooSmallForRoyalty()` | Rounding to zero | Backend should refuse quotes that produce zero-fee legs |
| `MerchantTransferFailed()` / `TreasuryTransferFailed()` / `IPCreatorTransferFailed()` | Recipient reverted on transfer | Atomic rollback — quote still valid; payer can retry after recipient recovers |

---

## 12. Versioning

The contract stores `EIP712_VERSION = "1"`. If the typed-data layout ever changes (added field, reordered field, new type), the version bumps to "2" and a new contract is deployed. The new contract has a new `DOMAIN_SEPARATOR` because the version string is hashed into it. The two contracts can coexist on the same chain with different `verifyingContract` addresses.

The backend must select the contract address per `version` and route traffic to the correct one. This is the same pattern as Solang SDK's multi-version support.

---

## 13. Reference Implementation Skeleton (Pseudocode)

```solidity
// In B2BSplitterV14.sol — not implemented yet, design only.

bytes32 private constant QUOTE_TYPEHASH = keccak256(
    "Quote(address payer,address merchant,address token,uint256 grossAmount,address ipCreator,uint256 validUntil,bytes32 orderIdHash,uint256 nonce,bytes32 routeId)"
);

bytes32 private immutable _CACHED_DOMAIN_SEPARATOR;
uint256 private immutable _CACHED_CHAIN_ID;
address private immutable _CACHED_THIS;

bytes32 private immutable _HASHED_NAME;
bytes32 private immutable _HASHED_VERSION;
bytes32 private immutable _TYPE_HASH;

constructor(...) {
    _HASHED_NAME = keccak256("AiFinPayB2BSplitter");
    _HASHED_VERSION = keccak256("1");
    _TYPE_HASH = keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");
    _CACHED_CHAIN_ID = block.chainid;
    _CACHED_DOMAIN_SEPARATOR = _buildDomainSeparator();
    _CACHED_THIS = address(this);

    // RBAC bootstrap
    _grantRole(DEFAULT_ADMIN_ROLE, initialAdmin);
    _grantRole(SIGN_OPERATOR_ROLE, initialSigner);

    // Multi-route bootstrap
    for (uint256 i = 0; i < _routeIds.length; i++) {
        profiles[_routeIds[i]] = RouteProfile({
            treasuryBps: _treasuryBps[i],
            ipCreatorBps: _ipCreatorBps[i],
            enabled: true,
            configuredAt: uint64(block.timestamp),
            routeTreasury: address(0)
        });
        enabledRouteIds.push(_routeIds[i]);
    }
}

function _domainSeparatorV4() internal view returns (bytes32) {
    if (block.chainid == _CACHED_CHAIN_ID) return _CACHED_DOMAIN_SEPARATOR;
    return _buildDomainSeparator();
}

function _buildDomainSeparator() private view returns (bytes32) {
    return keccak256(abi.encode(
        _TYPE_HASH,
        _HASHED_NAME,
        _HASHED_VERSION,
        block.chainid,
        address(this)
    ));
}

function _hashQuote(Quote calldata q) internal pure returns (bytes32) {
    return keccak256(abi.encode(
        QUOTE_TYPEHASH,
        q.payer, q.merchant, q.token, q.grossAmount,
        q.ipCreator, q.validUntil, q.orderIdHash, q.nonce, q.routeId
    ));
}

function _verifyQuote(Quote calldata q, bytes calldata sig) internal {
    if (sig.length != 65) revert InvalidSignatureLength();
    bytes32 digest = keccak256(abi.encode(_domainSeparatorV4(), _hashQuote(q)));
    address recovered = ECDSA.recover(digest, sig);
    if (recovered == address(0)) revert InvalidSignature();
    if (!hasRole(SIGN_OPERATOR_ROLE, recovered)) revert InvalidSigner();
    if (block.timestamp > q.validUntil) revert SignatureExpired(q.validUntil, block.timestamp);
    if (q.payer == address(0)) revert InvalidPayer();
    if (q.payer != msg.sender) revert InvalidPayer();
    if (q.merchant == address(0)) revert ZeroMerchant();
    if (q.token != address(0) && !whitelistedTokens[q.token]) revert UnsupportedToken();

    RouteProfile storage p = profiles[q.routeId];
    if (p.configuredAt == 0) revert UnknownRoute(q.routeId);
    if (!p.enabled) revert RouteDisabled(q.routeId);

    if (q.nonce != payerNonce[q.payer]) revert InvalidNonce();

    unchecked { payerNonce[q.payer] = q.nonce + 1; }
    consumedNonce[q.payer][q.nonce] = true;
}
```

The pseudocode is **not committed**. It is here only to make the spec unambiguous.

---

— End of quote format spec —