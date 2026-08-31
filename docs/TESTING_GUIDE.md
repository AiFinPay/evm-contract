# AiFinPay Testing Guide

## Overview

The AiFinPay protocol uses a **dual testing strategy** with both Hardhat/Mocha and Foundry/Forge for comprehensive coverage.

## Test Suites

### 1. Hardhat/Mocha Tests (TypeScript)

**Location:** `test/`  
**Count:** 22 tests (v1.4) + 29 tests (v1.3)  
**Purpose:** Unit tests, contract interactions, full protocol flows

```bash
# Run all tests
bun test

# Run v1.4 unit tests
bun test test/unit/B2BSplitter.v14.test.ts

# Run v1.3 splitter tests
bun test test/unit/B2BSplitter.v13.test.ts
bun test test/unit/B2BSplitter.v13.stable.test.ts

# Run with grep
bun test --grep "B2B payment"
```

**Coverage:**
- ✅ B2BSplitter v1.3 (15 tests)
- ✅ B2BSplitter v1.3 stable (14 tests)
- ✅ B2BSplitter v1.4 (22 tests)

### 2. Foundry/Forge Tests (Solidity)

**Location:** `foundry-tests/`  
**Count:** 15 tests (256 fuzz runs each = 3,840 total iterations)  
**Purpose:** Math validation, invariant testing, edge cases, timelock

```bash
# Run all Foundry tests
forge test

# Run specific test contract
forge test --match-contract SimpleMathTest
forge test --match-contract TimelockTest

# Run specific test
forge test --match-test testFuzz_FeeSplit

# With gas report
forge test --gas-report

# More fuzz runs (CI)
forge test --fuzz-runs 1000
```

**Coverage:**
- ✅ SimpleMathTest (4 tests) - Pure math validation
- ✅ TimelockTest (11 tests) - Governance timelock

## Test Categories

### Unit Tests
- Individual contract functions
- Error handling
- Access control
- State changes

### Integration Tests
- Multi-contract interactions
- Full protocol flows
- End-to-end scenarios

### Fuzz Tests (Foundry)
- Random input validation
- Edge case discovery
- Invariant verification
- 256+ runs per test

### Invariant Tests
- Fee conservation: `treasury + ip + merchant == total`
- Division precision: `quotient * divisor + remainder == dividend`
- Timelock enforcement: 48h delay required
- Access control: Only authorized users

## Running Tests

### Quick Test (Development)
```bash
# Fast feedback loop
bun test
forge test
```

### Pre-Commit
```bash
# Ensure everything passes
bun test && bun run build && bun run lint
```

### CI/CD
```bash
# Full test suite with increased fuzz runs
bun test
forge test --fuzz-runs 1000
bun run build
bun run lint
bun run prettify:check
```

### Gas Reporting
```bash
# Analyze gas costs
forge test --gas-report
```

## Test Coverage by Feature

| Feature | Hardhat Tests | Foundry Tests | Total |
|---------|---------------|---------------|-------|
| **Splitters** | 51 | 0 | 51 |
| **Math/Invariants** | 0 | 4 | 4 |
| **Timelock** | 0 | 11 | 11 |
| **TOTAL** | **51** | **15** | **66** |

## Fuzz Testing Parameters

| Test | Input Range | Runs | Purpose |
|------|-------------|------|---------|
| Fee Split | 100k - 1000 ether | 256 | Fee calculation |
| Stable Division | 1 - 1M USDC | 256 | Precision |

| Treasury BPS | 1 - 500 | 256 | Fee caps |
| Timelock Schedule | All valid params | 256 | Governance |

## Writing New Tests

### Hardhat/Mocha (TypeScript)

```typescript
import { expect } from "chai";
import { ethers, loadFixture } from "./fixtures";

describe("MyContract", () => {
  it("should do something", async () => {
    const { contract } = await loadFixture(deployFixture);
    await contract.myFunction();
    expect(await contract.value()).to.equal(42);
  });
});
```

### Foundry (Solidity)

```solidity
function testFuzz_MyTest(uint256 value) public {
    value = bound(value, min, max);
    vm.assume(precision);

    uint256 result = myFunction(value);

    assertEq(result, expected, "Error message");
}
```

## Debugging Failed Tests

### Hardhat
```bash
# Run with verbose output
bun test --verbose

# Run specific test
bun test --grep "exact test name"
```

### Foundry
```bash
# Verbose output
forge test -vvv

# Specific test
forge test --match-test testName

# Reproduce fuzz failure
forge test --fuzz-seed 0x...
```

## Continuous Integration

The CI pipeline runs:
1. `bun install` - Install dependencies
2. `bun run build` - Compile contracts
3. `bun test` - Run Hardhat tests
4. `forge test` - Run Foundry tests
5. `bun run lint` - Lint Solidity
6. `bun run prettify:check` - Check formatting

**All must pass** for PR merge.

## Monitoring Test Health

- ✅ **Pass Rate**: Should be 100%
- ✅ **Fuzz Runs**: Minimum 256 per test
- ✅ **Gas Trends**: Monitor for regressions
- ✅ **Coverage**: Add tests for new features

## Best Practices

1. **Test happy paths AND error cases**
2. **Use fuzzing for math-heavy logic**
3. **Test access control thoroughly**
4. **Include integration tests for multi-contract flows**
5. **Document test scenarios**
6. **Keep tests fast (< 2 minutes total)**
7. **Use fixtures for common setups**
8. **Test boundary conditions**

## Resources

- [Hardhat Testing Docs](https://hardhat.org/hardhat-runner/docs/guides/test-contracts)
- [Foundry Book](https://book.getfoundry.sh/forge/tests)
- [Testing Best Practices](https://github.com/OpenZeppelin/openzeppelin-contracts/tree/master/test)
