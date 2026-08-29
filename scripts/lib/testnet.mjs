/**
 * What makes an entry a testnet entry, in one place.
 *
 * The registry's gates exist because a mainnet route moves real money: a v1.3
 * splitter must be owned by the governance Safe, and a route may not settle
 * unless two independent RPC providers can confirm it. Both are correct, and
 * both make a testnet deployment impossible to register — a testnet contract is
 * owned by whoever deployed it, and nobody runs two providers for Amoy.
 *
 * The consequence was not theoretical. With no testnet entry, the backend had
 * nothing to resolve a version from, assumed v1.2, and published an instruction
 * naming a function the deployed v1.3 contract does not have. Every test-mode
 * settlement reverted (AIFINP-219), and "rehearse on a testnet before mainnet"
 * could not be done at all.
 *
 * So a testnet entry is allowed, and the exemption is made impossible to
 * misuse rather than merely discouraged:
 *
 *   - `testnet: true` on a chain that is not in the closed set below is a hard
 *     failure. The exemption cannot be claimed for Polygon by writing a field.
 *   - a chain in the set WITHOUT `testnet: true` is also a hard failure, so a
 *     testnet deployment cannot be slipped in as though it were production and
 *     inherit a mainnet route's trust.
 *
 * Both directions matter. One stops a mainnet route escaping the gates; the
 * other stops a testnet route pretending it already passed them.
 */

/** Closed set. Adding to it is a reviewed change, which is the point. */
export const TESTNET_CHAIN_IDS = Object.freeze({
  80002: 'amoy',
});

export const isTestnetChainId = (chainId) =>
  Object.prototype.hasOwnProperty.call(TESTNET_CHAIN_IDS, Number(chainId));

/**
 * @returns {{ ok: true, testnet: boolean } | { ok: false, reason: string }}
 */
export function classifyNetwork(entry) {
  const onTestnetChain = isTestnetChainId(entry.chainId);
  const claimsTestnet = entry.testnet === true;

  if (claimsTestnet && !onTestnetChain) {
    return {
      ok: false,
      reason:
        `declares testnet: true on chain ${entry.chainId}, which is not a known testnet. ` +
        `The testnet exemptions skip the governance-Safe owner requirement and the ` +
        `two-provider rule; a mainnet route must never reach them.`,
    };
  }
  if (onTestnetChain && !claimsTestnet) {
    return {
      ok: false,
      reason:
        `is on ${TESTNET_CHAIN_IDS[Number(entry.chainId)]} (chain ${entry.chainId}) but does ` +
        `not declare testnet: true. A testnet deployment must say so, or it is read as ` +
        `production and inherits trust it has not earned.`,
    };
  }
  return { ok: true, testnet: claimsTestnet };
}
