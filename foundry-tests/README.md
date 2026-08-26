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

## Timelock Tests

### TimelockTest.t.sol

Comprehensive tests for the 48-hour timelock governance system:

| Test | Purpose | Status |
|------|---------|--------|
| `test_TimelockBecomesOwner` | Verify ownership transfer | ✅ |
| `test_ProposerCanSchedule` | Safe can schedule operations | ✅ |
| `test_AttackerCannotSchedule` | Unauthorized users blocked | ✅ |
| `test_CannotExecuteBeforeDelay` | 48h delay enforced | ✅ |
| `test_CanExecuteAfterDelay` | Execution after delay | ✅ |
| `test_ProposerCanCancel` | Safe can cancel operations | ✅ |
| `test_FeeCapsEnforcedDuringScheduling` | Fee caps still work | ✅ |
| `test_TreasuryChangeRequiresTimelock` | Treasury changes timelocked | ✅ |
| `test_PauseRequiresTimelock` | Pause function timelocked | ✅ |
| `test_MultipleOperationsScheduled` | Batch scheduling works | ✅ |
| `testFuzz_ScheduleAndExecute` | Fuzz test all valid fees | ✅ |

### Coverage

- ✅ Scheduling operations
- ✅ Execution delays (48h)
- ✅ Cancellation rights
- ✅ Access control (proposer/executor)
- ✅ Fee cap enforcement
- ✅ All protected functions
- ✅ Multi-operation scheduling

### Running Timelock Tests

```bash
# All timelock tests
forge test --match-contract TimelockTest

# Specific test
forge test --match-test test_CanExecuteAfterDelay

# With gas report
forge test --match-contract TimelockTest --gas-report
```

### Key Test Scenarios

1. **Happy Path**: Schedule → Wait 48h → Execute
2. **Security**: Attacker cannot schedule
3. **Safety**: Cannot execute before delay
4. **Governance**: Proposer can cancel
5. **Validation**: Fee caps enforced at execution
6. **Fuzz**: All valid fee combinations work
