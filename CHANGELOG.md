# Changelog

## Unreleased

- Security: `AgentPassport.updateSpendLimit` now reverts when a payment exceeds
  the daily cap, preventing future callers from accidentally ignoring a `false`
  result. Added an atomic rollback regression test covering spend state,
  recipient balances, and contract balance.
