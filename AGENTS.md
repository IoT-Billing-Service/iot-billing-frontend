# AGENTS.md

## Purpose

This file provides guidance for contributors and AI coding agents working in this repository. It explains how to approach changes safely, consistently, and with respect for the security requirements of Web3 software.

Web3 code often handles irreversible transactions, user funds, wallet permissions, cryptographic assumptions, and protocol-level state. Treat every change as security-sensitive unless it is clearly documentation-only.

## Repository Principles

Contributors should prioritise:

* Correctness over speed
* Security over convenience
* Readability over cleverness
* Explicit assumptions over hidden behaviour
* Small, reviewable changes over broad rewrites
* Deterministic behaviour over implicit side effects

Do not introduce unnecessary abstractions, dependencies, network calls, or protocol assumptions.

## Expected Agent Behaviour

Before making changes:

1. Read the relevant source files, tests, configuration files, and documentation.
2. Identify the exact scope of the requested change.
3. Avoid modifying unrelated files.
4. Preserve existing architecture, naming conventions, formatting, and testing patterns.
5. Check whether the change affects contracts, signing flows, transaction construction, wallet integrations, chain configuration, or protocol logic.

When implementing:

1. Make the smallest correct change.
2. Prefer explicit validation and clear error messages.
3. Add or update tests for any behavioural change.
4. Do not remove safety checks unless the reason is documented and justified.
5. Do not silence linting, type, or test failures without addressing the cause.

After implementing:

1. Run the relevant checks.
2. Summarise what changed.
3. Mention any tests that were run.
4. Mention any tests that could not be run.
5. Highlight any remaining risks or assumptions.

## Project Setup

Use the package manager already configured in the repository. Do not switch package managers unless explicitly requested.

Common commands may include:

```bash
npm install
npm run dev
npm run build
npm run test
npm run lint
npm run typecheck
```

or:

```bash
pnpm install
pnpm dev
pnpm build
pnpm test
pnpm lint
pnpm typecheck
```

or:

```bash
yarn install
yarn dev
yarn build
yarn test
yarn lint
yarn typecheck
```

Use the commands defined in `package.json`, `foundry.toml`, `hardhat.config.*`, `forge.config.*`, or project documentation as the source of truth.

## Smart Contract Guidelines

Treat all smart contract changes as high risk.

When modifying contracts:

* Preserve storage layout unless the migration or upgrade path is explicitly part of the task.
* Do not reorder state variables in upgradeable contracts.
* Do not change access control without tests.
* Do not introduce unchecked external calls without justification.
* Do not add privileged roles without documenting their purpose.
* Do not alter token accounting, fee logic, oracle usage, slippage checks, signature validation, or withdrawal logic casually.
* Prefer established libraries such as OpenZeppelin where already used by the repository.
* Avoid custom cryptography unless the repository already depends on it and the change is narrowly scoped.

Pay special attention to:

* Re-entrancy
* Integer precision and rounding
* Access control
* Signature replay
* Oracle manipulation
* Front-running and sandwich risk
* Chain ID assumptions
* Upgradeability safety
* Denial of service vectors
* Unsafe token transfer behaviour
* Incorrect event emissions
* Inconsistent accounting between internal state and token balances

## Frontend Web3 Guidelines

When working on the frontend:

* Never assume a wallet is connected.
* Always handle unsupported networks.
* Always handle rejected wallet requests.
* Always handle pending, confirmed, failed, and reverted transactions.
* Avoid hardcoded chain IDs unless the repository already centralises them.
* Use existing wallet, provider, and contract abstractions.
* Do not expose private keys, mnemonics, API secrets, or privileged RPC endpoints.
* Do not log sensitive wallet, session, or authentication data.
* Keep user-facing transaction information clear and accurate.

Transaction flows should make the following clear to users:

* What action they are taking
* Which network they are using
* Which asset is involved
* The amount involved
* The recipient or contract involved
* Any fees, approvals, or permissions requested

## Backend and Indexing Guidelines

When working on backend services, indexers, bots, relayers, or API routes:

* Validate all external input.
* Treat RPC responses as unreliable until checked.
* Handle chain reorganisations where relevant.
* Make indexing idempotent where possible.
* Avoid assuming event order across different chains or RPC providers.
* Do not store secrets in source code.
* Do not weaken authentication, rate limits, or permission checks.
* Preserve retry, timeout, and failure handling behaviour unless intentionally changing it.

## Testing Expectations

Add tests for behavioural changes. Prefer tests that verify observable outcomes rather than implementation details.

Relevant test types may include:

* Unit tests
* Integration tests
* Contract tests
* Fork tests
* Invariant tests
* Snapshot tests
* End-to-end tests

For smart contracts, include tests for:

* Success paths
* Reverts
* Permission boundaries
* Edge values
* Rounding behaviour
* Events
* Upgrade or migration safety, if applicable

For frontend transaction flows, include tests for:

* Wallet disconnected state
* Wrong network state
* User rejection
* Transaction pending state
* Transaction success
* Transaction failure or revert

## Security Requirements

Never commit or expose:

* Private keys
* Seed phrases
* API keys
* RPC credentials
* Admin wallet addresses that are meant to remain private
* Production secrets
* `.env` files containing real values

Use example values in documentation and tests.

If a change touches security-sensitive logic, include a note in the pull request describing:

* What security boundary is affected
* What assumptions are being made
* What tests cover the change
* What risks remain

## Dependencies

Do not add dependencies unless necessary.

Before adding a dependency, consider:

* Whether the repository already has an equivalent utility
* Whether the package is actively maintained
* Whether it affects bundle size
* Whether it introduces supply-chain risk
* Whether it handles cryptography, signing, parsing, or network requests

Avoid adding dependencies for small utilities that can be implemented clearly in a few lines.

## Code Style

Follow the repository’s existing style.

General expectations:

* Use clear names.
* Keep functions focused.
* Prefer explicit types where helpful.
* Avoid broad catch blocks that hide failures.
* Avoid global mutable state.
* Keep error messages useful.
* Do not introduce formatting churn.
* Do not rewrite files only to satisfy personal style preferences.

## Documentation

Update documentation when behaviour, configuration, commands, environment variables, or user-facing flows change.

Documentation should be:

* Accurate
* Concise
* Actionable
* Close to the code it describes where practical

For Web3 features, document:

* Supported chains
* Required environment variables
* Contract addresses
* Deployment steps
* Verification steps
* Known limitations
* Operational risks

## Pull Request Standards

A good pull request should include:

* A clear description of the change
* The reason for the change
* The files or systems affected
* Tests run
* Screenshots or recordings for UI changes
* Security considerations for contract, wallet, signing, relayer, or backend changes
* Any migration or deployment steps

Keep pull requests focused. Avoid mixing refactors, feature work, formatting changes, and dependency updates unless they are directly connected.

## Agent Change Policy

AI agents should not:

* Make broad architectural changes without being asked
* Remove tests because they fail
* Weaken security checks to make tests pass
* Invent contract addresses, ABIs, or deployment data
* Assume mainnet behaviour from local mocks
* Replace established libraries without justification
* Modify generated files unless required
* Commit secrets or real credentials
* Change public APIs without documenting the impact
* Ignore failing checks

AI agents should:

* Explain meaningful trade-offs
* Keep diffs small
* Preserve existing behaviour unless asked to change it
* Ask for clarification when requirements are unsafe or contradictory
* Flag security-sensitive areas clearly
* Prefer safe defaults

## Review Checklist

Before submitting work, confirm:

* The change is scoped to the request.
* Relevant tests pass.
* New behaviour is tested.
* Security-sensitive assumptions are documented.
* No secrets are committed.
* No unrelated formatting churn is included.
* User-facing text is clear.
* Contract changes preserve storage safety where relevant.
* Network and wallet failure states are handled.
* Documentation is updated where needed.

## Final Notes

Web3 systems are adversarial by default. Code should be written as though every public function, transaction path, API route, and signature flow may be targeted by mistake, misuse, or attack.

When uncertain, choose the safer, smaller, and more explicit implementation.
