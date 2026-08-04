# Changelog

## Unreleased

### Security

- Fixed H-02 in `AiFinPayCore.b2bPay()`: a zero IP-creator address no longer
  causes the creator allocation to remain in the Core contract.
- Added regression coverage for zero-creator and three-recipient native
  settlements, including the zero-contract-balance invariant.
