# Solidity Style Guide — Project Insights

Source: [Solidity v0.8.x Style Guide](https://docs.soliditylang.org/en/latest/style-guide.html)

> This document captures the style-guide rules that are relevant to the AiFinPay Solidity codebase so the team can enforce them consistently via Prettier, Solhint, and code review.

---

## 1. Code Layout

### 1.1 Indentation
- Use **4 spaces** per indentation level for Solidity files.
- Spaces are the preferred indentation method; never mix tabs and spaces.

### 1.2 Blank Lines
- Surround **top-level declarations** (`contract`, `library`, `interface`) with **two blank lines**.
- Inside a contract, surround **function declarations** with a **single blank line**.
- Blank lines may be omitted between groups of related one-liners (e.g. stub functions in an abstract contract).

### 1.3 Maximum Line Length
- Maximum suggested line length is **120 characters**.
- Wrapped lines should follow these rules:
  1. The first argument should not be attached to the opening parenthesis.
  2. Use one, and only one, indent level for continuation.
  3. Each argument should fall on its own line.
  4. The terminating element `);` should be placed on its own final line.

Applies to:
- Function calls
- Assignment statements
- Event definitions and emit statements
- Function declarations with many arguments or modifiers

### 1.4 Source File Encoding
- Prefer **UTF-8** or ASCII encoding.

### 1.5 Imports
- Import statements must always be placed at the **top of the file**, immediately after the pragma/license.

---

## 2. Order of Layout

### 2.1 File-level order
1. Pragma statements
2. Import statements
3. Events (if declared at file level)
4. Errors (if declared at file level)
5. Interfaces
6. Libraries
7. Contracts

### 2.2 Inside each contract / library / interface
1. Type declarations (`struct`, `enum`)
2. State variables
3. Events
4. Errors
5. Modifiers
6. Functions

Note: types may be declared close to their use if that improves readability.

### 2.3 Function ordering
Functions should be grouped by visibility and ordered:
1. `constructor`
2. `receive` function (if exists)
3. `fallback` function (if exists)
4. `external`
5. `public`
6. `internal`
7. `private`

Within each visibility group, place `view` and `pure` functions **last**.

---

## 3. Whitespace and Formatting

### 3.1 Control Structures
- Opening brace on the **same line** as the declaration, preceded by a single space.
- Closing brace on its **own line** at the same indentation as the declaration.
- `if`, `while`, `for`: single space before the parenthetic condition and between the condition and the opening brace.
- For single-statement bodies the braces may be omitted **only if** the statement is on one line.
- `else` / `else if` must be on the same line as the closing brace of the preceding `if` block.

### 3.2 Function Declarations
- Short declarations keep the opening brace on the same line.
- Closing brace at the same indentation level as the function declaration.
- For long declarations drop each argument onto its own line at the same indentation as the function body.
- If modifiers make the line long, each modifier goes on its own line, indented once.
- Base constructor calls can be dropped to their own lines for readability.

### 3.3 Modifier Order
1. Visibility (`external`, `public`, `internal`, `private`)
2. Mutability (`view`, `pure`, `payable`)
3. `virtual`
4. `override`
5. Custom modifiers (`onlyOwner`, `nonReentrant`, etc.)

### 3.4 Mappings
- Do **not** separate `mapping` from its type by a space:
  - `mapping(uint => uint) map;`
  - `mapping(uint => mapping(bool => Data[])) public data;`

### 3.5 Variable Declarations
- No space between type and brackets for arrays:
  - `uint[] x;` (not `uint [] x;`)

### 3.6 General Whitespace Rules
- No whitespace immediately inside parentheses, brackets or braces, except single-line function declarations.
- No whitespace immediately before a comma or semicolon.
- Surround operators with a single space on either side.
- Operators with higher precedence may drop whitespace to denote precedence, but keep equal whitespace on both sides.
- Strings should use **double quotes** instead of single quotes.
- No extra spaces used to align `=` or other operators across lines.

---

## 4. Naming Conventions

| Item | Convention | Examples |
|------|------------|----------|
| Contracts / libraries | `CapWords` | `AiFinPayCore`, `AgentPassport`, `MSECCOToken` |
| Filenames | Match the core contract name | `AiFinPayCore.sol` |
| Structs | `CapWords` | `PassportData` |
| Events | `CapWords` | `TopUpStable`, `B2BPayment` |
| Functions | `mixedCase` | `mintPassport`, `b2bPay`, `topUpStable` |
| Function arguments | `mixedCase` | `_amount`, `_recipient` |
| Local / state variables | `mixedCase` | `storedData`, `dailyLimit` |
| Constants | `UPPER_CASE_WITH_UNDERSCORES` | `STABLE_DECIMALS_DIVISOR`, `MAX_DAILY_LIMIT` |
| Modifiers | `mixedCase` | `onlyOwner`, `nonReentrant` |
| Enums | `CapWords` | `PassportStatus` |

### Special prefixes
- `_singleLeadingUnderscore` — suggested for `private` / `internal` functions and state variables.
- `_singleTrailingUnderscore_` — suggested when a name collides with a reserved or existing name.

Names to avoid as single-letter variables: `l`, `O`, `I` (can be mistaken for `1` or `0`).

---

## 5. NatSpec

- Use NatSpec (`///` or `/** ... */`) directly above function declarations or statements.
- All **public interfaces** (everything in the ABI) should be documented.
- Common tags: `@title`, `@author`, `@notice`, `@dev`, `@param`, `@return`.

---

## 6. Project-Specific Alignment

The AiFinPay codebase already follows many of these conventions. This is how the tooling is configured:

- **Prettier** (`prettier-plugin-solidity`) is used for formatting `.sol` files with:
  - `tabWidth: 4`
  - `printWidth: 120`
  - `trailingComma: none`
  - `singleQuote: false` (double-quoted strings)
- **Solhint** (`solhint 'contracts/**/*.sol'`) catches ordering, visibility, and security issues.
- **CI order**: `bun install` → `bun run build` → `bun test` → `bun run lint` → `bun run prettify:check`.

### Action items surfaced from this guide
1. Keep contract / library / interface declarations separated by two blank lines.
2. Keep functions ordered: constructor → receive/fallback → external → public → internal → private, with view/pure last in each group.
3. Ensure modifier order: visibility → mutability → virtual → override → custom modifiers.
4. Continue using double quotes for Solidity strings.
5. Avoid `uint [] x;` style array declarations.
6. Keep `mapping(uint => uint)` style (no space after `mapping`).

---

## 7. Quick Reference — Yes / No Examples

```solidity
// YES — blank lines between top-level declarations
contract A { ... }


contract B { ... }


// YES — function ordering and modifier order
contract Example {
    constructor() { }

    receive() external payable { }

    function externalFn() external { }

    function externalViewFn() external view returns (uint256) { return 0; }

    function publicFn() public { }

    function _internalFn() internal { }

    function _privateFn() private { }
}

// YES — long function signature wrapping
function longFunction(
    address _a,
    address _b,
    uint256 _c
)
    external
    onlyOwner
    nonReentrant
    returns (bool)
{
    return true;
}

// NO — wrong array spacing
uint [] x;

// YES — correct array spacing
uint[] x;

// NO — space after mapping
mapping (uint => uint) map;

// YES — mapping attached to type
mapping(uint => uint) map;
```

---

*Last updated: 2026-08-06*
