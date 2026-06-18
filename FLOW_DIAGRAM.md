# Transaction Flow Diagrams

## User Submission Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER CLICKS SUBMIT                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  TransactionModal    │
                  │  handleSubmit()      │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  POST /api/escrow/   │
                  │  deposit|withdraw    │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  Response: { hash }  │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  enqueue({           │
                  │    hash,             │
                  │    contractId,       │
                  │    amount,           │
                  │    asset,            │
                  │    publicKey,        │
                  │    type              │
                  │  })                  │
                  └──────────┬───────────┘
                             │
        ┌────────────────────┴────────────────────┐
        │                                         │
        ▼                                         ▼
┌──────────────────┐                   ┌──────────────────┐
│  Duplicate       │                   │  New Transaction │
│  Detection       │                   │  Created         │
└────────┬─────────┘                   └─────────┬────────┘
         │                                       │
         ▼                                       ▼
┌──────────────────┐                   ┌──────────────────┐
│  Return existing │                   │  Save to         │
│  transaction ID  │                   │  IndexedDB       │
└──────────────────┘                   └─────────┬────────┘
                                                 │
                                                 ▼
                                       ┌──────────────────┐
                                       │  Start Status    │
                                       │  Polling         │
                                       └─────────┬────────┘
                                                 │
                                                 ▼
                                       ┌──────────────────┐
                                       │  Update UI       │
                                       │  (TxStatusPill)  │
                                       └──────────────────┘
```

## Deduplication Logic Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                         enqueue() called                         │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  findDuplicate()     │
                  │                      │
                  │  Check:              │
                  │  - contractId        │
                  │  - amount            │
                  │  - asset             │
                  │  - publicKey         │
                  │  - type              │
                  │  - status=pending    │
                  │  - within 30s        │
                  └──────────┬───────────┘
                             │
        ┌────────────────────┴────────────────────┐
        │                                         │
        ▼                                         ▼
┌──────────────────┐                   ┌──────────────────┐
│  DUPLICATE FOUND │                   │  NO DUPLICATE    │
│                  │                   │                  │
│  ✓ Same params   │                   │  ✗ Different     │
│  ✓ Within 30s    │                   │    OR            │
│  ✓ Still pending │                   │  ✗ Outside 30s   │
│                  │                   │    OR            │
│                  │                   │  ✗ Not pending   │
└────────┬─────────┘                   └─────────┬────────┘
         │                                       │
         ▼                                       ▼
┌──────────────────┐                   ┌──────────────────┐
│  Console log:    │                   │  Create new      │
│  "Duplicate      │                   │  PendingTx       │
│   detected"      │                   │                  │
└────────┬─────────┘                   │  id: unique      │
         │                             │  hash: provided  │
         │                             │  status: pending │
         ▼                             │  createdAt: now  │
┌──────────────────┐                   └─────────┬────────┘
│  Return existing │                             │
│  transaction.id  │                             ▼
│                  │                   ┌──────────────────┐
│  (DO NOT create  │                   │  Save to         │
│   new entry)     │                   │  IndexedDB       │
└──────────────────┘                   └─────────┬────────┘
                                                 │
                                                 ▼
                                       ┌──────────────────┐
                                       │  Start polling   │
                                       └──────────────────┘
```

## Status Polling Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                Transaction saved to IndexedDB                    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  startPollingTxStatus│
                  │  (id, hash)          │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  setInterval(5000ms) │
                  └──────────┬───────────┘
                             │
                             ▼
┌────────────────────────────────────────────────────────────────┐
│                        EVERY 5 SECONDS                          │
└────────────────────────────┬───────────────────────────────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  GET /api/escrow/    │
                  │  tx-status?hash=XXX  │
                  └──────────┬───────────┘
                             │
        ┌────────────────────┴────────────────────┐
        │                    │                    │
        ▼                    ▼                    ▼
┌──────────────┐  ┌──────────────────┐  ┌──────────────┐
│  PENDING     │  │  CONFIRMED       │  │  FAILED      │
└──────┬───────┘  └─────────┬────────┘  └──────┬───────┘
       │                    │                   │
       ▼                    ▼                   ▼
┌──────────────┐  ┌──────────────────┐  ┌──────────────┐
│  Continue    │  │  Update IndexedDB│  │  Update      │
│  polling     │  │  status=confirmed│  │  IndexedDB   │
│              │  │  ledger=X        │  │  status=     │
│  Increment   │  └─────────┬────────┘  │  failed      │
│  attempts    │            │           └──────┬───────┘
└──────┬───────┘            │                  │
       │                    ▼                  ▼
       │           ┌──────────────────┐  ┌──────────────┐
       │           │  Update UI       │  │  Update UI   │
       │           │  Show ✓ + ledger │  │  Show ✗ +    │
       │           │                  │  │  retry count │
       │           └─────────┬────────┘  └──────┬───────┘
       │                     │                  │
       │                     ▼                  ▼
       │           ┌──────────────────┐  ┌──────────────┐
       │           │  clearInterval() │  │  clearInterval│
       │           │  STOP POLLING    │  │  STOP POLLING│
       │           └──────────────────┘  └──────────────┘
       │
       ▼
┌──────────────┐
│  attempts >= │
│  120?        │
└──────┬───────┘
       │
       ├─ NO ──→ Continue polling
       │
       └─ YES ─→ Mark as failed, stop polling
```

## Page Reload Recovery Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                          PAGE LOADS                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  useTxRetryQueue     │
                  │  useEffect() runs    │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  persistenceKey      │
                  │  provided?           │
                  └──────────┬───────────┘
                             │
        ┌────────────────────┴────────────────────┐
        │ NO                                  YES │
        ▼                                         ▼
┌──────────────────┐                   ┌──────────────────┐
│  In-memory only  │                   │  Restore from    │
│  No persistence  │                   │  IndexedDB       │
│                  │                   │                  │
│  (DO NOTHING)    │                   │  getAllPending   │
└──────────────────┘                   │  Transactions()  │
                                       └─────────┬────────┘
                                                 │
                                                 ▼
                                       ┌──────────────────┐
                                       │  Found:          │
                                       │  3 pending       │
                                       │  2 confirmed     │
                                       │  1 failed        │
                                       └─────────┬────────┘
                                                 │
                                                 ▼
                                       ┌──────────────────┐
                                       │  setPendingTxs() │
                                       │  Update state    │
                                       └─────────┬────────┘
                                                 │
                                                 ▼
                                       ┌──────────────────┐
                                       │  Filter pending  │
                                       │  transactions    │
                                       └─────────┬────────┘
                                                 │
                                                 ▼
                                       ┌──────────────────┐
                                       │  forEach: start  │
                                       │  polling again   │
                                       │                  │
                                       │  tx1: polling    │
                                       │  tx2: polling    │
                                       │  tx3: polling    │
                                       └─────────┬────────┘
                                                 │
                                                 ▼
                                       ┌──────────────────┐
                                       │  UI shows all    │
                                       │  transactions    │
                                       │  with correct    │
                                       │  status          │
                                       └──────────────────┘
```

## Clear Completed Flow

```
┌─────────────────────────────────────────────────────────────────┐
│              USER CLICKS "Clear completed"                       │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  clearCompleted()    │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  persistenceKey      │
                  │  provided?           │
                  └──────────┬───────────┘
                             │
        ┌────────────────────┴────────────────────┐
        │ NO                                  YES │
        ▼                                         ▼
┌──────────────────┐                   ┌──────────────────┐
│  Return 0        │                   │  IndexedDB:      │
│  (no persistence)│                   │  deleteCompleted │
└──────────────────┘                   │  Transactions()  │
                                       └─────────┬────────┘
                                                 │
                                                 ▼
                                       ┌──────────────────┐
                                       │  Open cursor on  │
                                       │  status=confirmed│
                                       │  index           │
                                       └─────────┬────────┘
                                                 │
                                                 ▼
                                       ┌──────────────────┐
                                       │  For each result │
                                       │  cursor.delete() │
                                       │  count++         │
                                       └─────────┬────────┘
                                                 │
                                                 ▼
                                       ┌──────────────────┐
                                       │  Return count    │
                                       │  (e.g., 5)       │
                                       └─────────┬────────┘
                                                 │
                                                 ▼
                                       ┌──────────────────┐
                                       │  setPendingTxs() │
                                       │  Filter out      │
                                       │  confirmed       │
                                       └─────────┬────────┘
                                                 │
                                                 ▼
                                       ┌──────────────────┐
                                       │  UI updates      │
                                       │  Confirmed items │
                                       │  removed         │
                                       └──────────────────┘
```

## IndexedDB Structure

```
┌─────────────────────────────────────────────────────────────────┐
│                  iot-billing-cache Database                      │
│                         (Version 2)                              │
└────────────────────────────┬────────────────────────────────────┘
                             │
        ┌────────────────────┴────────────────────┐
        │                                         │
        ▼                                         ▼
┌──────────────────┐                   ┌──────────────────┐
│  Existing Stores │                   │  New Store (v2)  │
│  (from v1)       │                   │                  │
│                  │                   │  pending         │
│  - telemetry     │                   │  Transactions    │
│  - transactions  │                   └─────────┬────────┘
│  - fleetViews    │                             │
│  - authSession   │               ┌─────────────┴───────────────┐
└──────────────────┘               │                             │
                                   ▼                             ▼
                        ┌──────────────────┐         ┌──────────────────┐
                        │  Key: id         │         │  Indexes:        │
                        │                  │         │                  │
                        │  Data:           │         │  1. status       │
                        │  {               │         │     - non-unique │
                        │    id            │         │                  │
                        │    hash          │         │  2. createdAt    │
                        │    contractId    │         │     - non-unique │
                        │    amount        │         │                  │
                        │    asset         │         │  3. hash         │
                        │    publicKey     │         │     - non-unique │
                        │    type          │         │                  │
                        │    status        │         └──────────────────┘
                        │    retryCount    │
                        │    maxRetries    │
                        │    lastScanned   │
                        │    createdAt     │
                        │    updatedAt     │
                        │  }               │
                        └──────────────────┘
```

## Transaction State Machine

```
┌──────────┐
│  START   │
└────┬─────┘
     │
     ▼
┌──────────────────┐
│    SUBMITTED     │ ← User clicks submit
└────┬─────────────┘
     │
     ▼
┌──────────────────┐
│    PENDING       │ ← Saved to IndexedDB, polling starts
└────┬─────────────┘
     │
     ▼
   ┌─┴─┐
   │ ? │ ← Poll every 5s
   └─┬─┘
     │
  ┌──┴───────────────────────┐
  │                          │
  ▼                          ▼
┌──────────────┐    ┌──────────────────┐
│  CONFIRMED   │    │     FAILED       │
│              │    │                  │
│  - Show ✓    │    │  - Show ✗        │
│  - Show      │    │  - Show retry    │
│    ledger    │    │    count         │
│  - Stop poll │    │  - Stop poll     │
└──────┬───────┘    └─────────┬────────┘
       │                      │
       ▼                      ▼
┌──────────────┐    ┌──────────────────┐
│  CLEARED     │    │  MANUAL CLEANUP  │
│  (optional)  │    │  (optional)      │
└──────────────┘    └──────────────────┘
```

## Component Hierarchy

```
TransactionModal
├── Form Input (amount, asset)
├── Gas Estimation Button
├── Submit Button
└── TxStatusList
    ├── Header
    │   ├── Title: "Transaction Status"
    │   └── Clear Completed Button (conditional)
    └── Transaction Items (map)
        └── For each transaction:
            ├── Transaction Info
            │   ├── Type (Deposit/Withdrawal)
            │   ├── Amount & Asset
            │   └── Hash (truncated)
            └── TxStatusPill
                ├── Status Icon (⏳/✓/✗)
                ├── Status Text
                └── Additional Info
                    ├── Timestamp (pending)
                    ├── Ledger (confirmed)
                    └── Retry count (failed)
```
