# Foundry Tests for AiFinPay EVM Contracts

## Overview

This directory contains **Foundry (Forge)** tests focused on mathematical correctness, edge cases, and invariant testing for the AiFinPay protocol.

**Key Benefits:**
- ⚡ **100x faster** than Hardhat tests for fuzzing
- 🎲 **Built-in fuzzing** with 256+ runs per test
- 🔍 **Invariant testing** for critical protocol properties
- 📊 **Gas reports** for optimization

## Test Coverage

### SimpleMathTest.t.sol

| Test | Purpose | Fuzz Runs | Status |
|------|---------|-----------|--------|
| `testFuzz_FeeSplit` | Fee calculation preserves total | 256 | ✅ |
| `testFuzz_StableDivision` | Division precision & remainder | 256 | ✅ |
| `testFuzz_ConfidenceCheck` | Pyth 2% confidence threshold | 256 | ✅ |
| `testFuzz_NoOverflow` | Large number safety | 256 | ✅ |

## Running Tests

```bash
# All Foundry tests
forge test

# Specific test
forge test --match-test testFuzz_FeeSplit

# With gas report
forge test --gas-report

# More fuzz runs (for CI)
forge test --fuzz-runs 1000

# Verbose output
forge test -vvv
```

## Invariants Validated

1. **Fee Conservation**: `treasury + ip + merchant == total`
2. **Division Correctness**: `quotient * divisor + remainder == dividend`
3. **Confidence Threshold**: `conf <= price * 2%`
4. **No Overflow**: All arithmetic stays within bounds

## Configuration

- **Compiler**: Solc 0.8.35 (Cancun)
- **Optimizer**: viaIR, 200 runs
- **Fuzz**: 256 runs (default), configurable
- **Location**: `foundry-tests/` (separate from Hardhat tests)

## Adding New Tests

```solidity
function testFuzz_MyTest(uint256 value) public {
    value = bound(value, min, max);
    vm.assume(precondition);
    
    uint256 result = myFunction(value);
    
    assertEq(result, expected, "Error message");
}
```

## CI Integration

Add to your CI pipeline:
```bash
forge test --fuzz-runs 1000
```

## Troubleshooting

**Issue**: Import errors  
**Fix**: Check `foundry.toml` remappings

**Issue**: Test fails with counterexample  
**Fix**: Use the seed from output: `forge test --fuzz-seed 0x...`

**Issue**: Slow tests  
**Fix**: Reduce `--fuzz-runs` for local dev
