# Changelog

## Unreleased

- Supply chain: refreshed the npm lockfile within the existing Hardhat 2
  compatibility range, reducing high-severity dev-toolchain advisories from 38
  to 17; the production dependency graph now reports zero vulnerabilities.
- CI: made npm/package-lock canonical, added read-only workflow permissions,
  concurrency cancellation, a timeout, and a production dependency audit gate.
- Remaining: the 17 high dev-toolchain advisories require the documented
  Hardhat 3 ESM/plugin/test migration and are not represented as fixed here.
