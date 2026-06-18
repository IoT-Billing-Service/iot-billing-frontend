# Transaction Retry Queue - Quick Start Guide

## 🚀 What Was Built

A complete transaction retry queue system with:
- ✅ IndexedDB persistence (survives page reloads)
- ✅ 30-second deduplication window (prevents double-spends)
- ✅ Automatic status polling (checks every 5 seconds)
- ✅ Real-time UI updates (pending/confirmed/failed states)
- ✅ Comprehensive test coverage (27+ tests)

## 📁 Key Files

### Implementation Files
```
src/
├── services/
│   └── indexedDbCache.ts          ← IndexedDB v2 schema + operations
├── hooks/
│   └── useTxRetryQueue.ts         ← Main queue logic + polling
├── components/wallet/
│   ├── TransactionModal.tsx       ← Integrated with queue
│   └── TxStatusPill.tsx           ← Status UI components
└── app/api/escrow/
    └── tx-status/route.ts         ← Status endpoint (MOCK)
```

### Test Files
```
src/
├── services/
│   └── indexedDbCache.test.ts     ← 7 tests
├── hooks/
│   └── useTxRetryQueue.test.ts    ← 9 tests
└── components/wallet/
    └── TxStatusPill.test.tsx      ← 11 tests
```

### Documentation
```
IMPLEMENTATION_SUMMARY.md          ← Technical details
TEST_RESULTS.md                    ← Test coverage report
TRANSACTION_QUEUE_README.md        ← Comprehensive guide
COMPLETION_CHECKLIST.md            ← Requirements checklist
FLOW_DIAGRAM.md                    ← Visual flow diagrams
QUICK_START.md                     ← This file
```

## 💻 Installation & Setup

### 1. Dependencies Already Installed
```bash
npm install fake-indexeddb --save-dev  # ✅ Already done
```

### 2. Run Tests
```bash
npm test                    # All tests
npm run test:watch          # Watch mode
npm run typecheck           # TypeScript check
npm run lint                # ESLint check
```

### 3. Build & Run
```bash
npm run build               # Production build
npm run dev                 # Development server
```

## 🎯 How to Use

### Basic Usage (with persistence)

```typescript
import { useTxRetryQueue } from '@/hooks/useTxRetryQueue';
import { TxStatusList } from '@/components/wallet/TxStatusPill';

function MyComponent() {
  // Enable persistence with a unique key
  const { pendingTransactions, enqueue, clearCompleted } = 
    useTxRetryQueue(10, 'my-queue');

  const handleSubmit = async () => {
    // 1. Submit to your API
    const response = await fetch('/api/escrow/deposit', {
      method: 'POST',
      body: JSON.stringify({ /* ... */ })
    });
    const { hash } = await response.json();

    // 2. Add to queue (auto-deduplicates)
    await enqueue({
      hash,
      contractId: 'CXXX...',
      amount: '1000',
      asset: 'USDC',
      publicKey: 'GXXX...',
      type: 'escrow_deposit'
    });
    // Polling starts automatically!
  };

  return (
    <>
      <button onClick={handleSubmit}>Submit</button>
      
      {/* Shows all pending transactions */}
      <TxStatusList
        transactions={pendingTransactions}
        onClearCompleted={clearCompleted}
      />
    </>
  );
}
```

### Without Persistence (in-memory only)

```typescript
// Omit the second parameter
const { pendingTransactions, enqueue } = useTxRetryQueue(10);
```

## ⚙️ Configuration

### Timing Settings

Located in `src/hooks/useTxRetryQueue.ts`:

```typescript
const RETRY_DELAY_BASE = 2000;        // Base retry delay: 2s
const MAX_RETRIES_DEFAULT = 10;       // Default max retries
const DEDUP_WINDOW_MS = 30_000;       // Dedup window: 30s

// In startPollingTxStatus:
const POLL_INTERVAL = 5000;           // Poll every 5s
const MAX_POLL_ATTEMPTS = 120;        // Stop after 10 minutes
```

### Custom Max Retries

```typescript
// Set custom retry limit (first parameter)
const { enqueue } = useTxRetryQueue(20, 'my-queue');
```

## 🔍 Features Explained

### 1. Deduplication

**How it works:**
- Checks last 30 seconds of pending transactions
- Compares: `contractId`, `amount`, `asset`, `publicKey`, `type`
- If match found: returns existing transaction ID
- If no match: creates new transaction entry

**Example:**
```typescript
// First submission at 10:00:00
await enqueue({ hash: 'abc', amount: '100', ... }); // ✅ Created

// Second submission at 10:00:15 (same params)
await enqueue({ hash: 'def', amount: '100', ... }); // ❌ Deduplicated

// Third submission at 10:00:35 (>30s later)
await enqueue({ hash: 'ghi', amount: '100', ... }); // ✅ Created
```

### 2. Status Polling

**Flow:**
1. Transaction enqueued → starts polling immediately
2. Polls `/api/escrow/tx-status?hash=XXX` every 5 seconds
3. Updates IndexedDB on status change
4. Stops polling when:
   - Status becomes 'confirmed' ✓
   - Status becomes 'failed' ✗
   - Max attempts reached (120 = 10 minutes)

### 3. Persistence

**What persists:**
- All pending transactions
- Transaction status (pending/confirmed/failed)
- Retry counts
- Ledger numbers
- Timestamps

**When restored:**
- On page load (if persistenceKey provided)
- Automatically resumes polling for pending transactions

### 4. UI States

| State | Icon | Color | Example |
|-------|------|-------|---------|
| Pending | ⏳ | Yellow | "Submitted (pending confirmation) 10:23:45" |
| Confirmed | ✓ | Green | "Confirmed on ledger 1000000" |
| Failed | ✗ | Red | "Failed - retry 3/10" |

## 🧪 Testing

### Run Specific Test Suites

```bash
# IndexedDB tests
npm test src/services/indexedDbCache.test.ts

# Queue logic tests
npm test src/hooks/useTxRetryQueue.test.ts

# UI component tests
npm test src/components/wallet/TxStatusPill.test.tsx
```

### Test Coverage Summary

- **IndexedDB**: Save, retrieve, filter, delete operations
- **Deduplication**: Window logic, parameter matching
- **Polling**: Status updates, auto-stop conditions
- **UI**: All states, button interactions, display logic

## 🐛 Troubleshooting

### Issue: Transactions not persisting

**Solution:**
```typescript
// Make sure persistenceKey is provided
const { enqueue } = useTxRetryQueue(10, 'my-persistence-key');
//                                       ^^^^^^^^^^^^^^^^^^^
```

### Issue: Duplicates not detected

**Check:**
1. Are you within 30 seconds? ✓
2. Are ALL parameters identical? ✓
3. Is the first transaction still 'pending'? ✓

**Debug:**
```typescript
console.log('Current pending:', pendingTransactions);
```

### Issue: Status not updating

**Check:**
1. Is polling working? (Check Network tab in DevTools)
2. Is the endpoint returning correct status?

**Test endpoint:**
```bash
curl http://localhost:3000/api/escrow/tx-status?hash=test123
```

### Issue: Build failing

```bash
# Clean and rebuild
rm -rf .next node_modules
npm install
npm run build
```

## ⚠️ Production TODO

### Critical: Replace Mock API

**Current** (`src/app/api/escrow/tx-status/route.ts`):
```typescript
// Mock simulation - NOT FOR PRODUCTION
function simulateTransactionStatus(hash: string) { ... }
```

**Needed**:
```typescript
import { SorobanRpc } from '@stellar/stellar-sdk';

const server = new SorobanRpc.Server(process.env.SOROBAN_RPC_URL);

export async function GET(request: NextRequest) {
  const hash = request.nextUrl.searchParams.get('hash');
  
  const tx = await server.getTransaction(hash);
  
  if (tx.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
    return NextResponse.json({
      status: 'confirmed',
      ledger: tx.ledger,
      hash
    });
  }
  // ... handle other cases
}
```

## 📊 Quick Reference

### Hook API

```typescript
const {
  pendingTransactions,  // PendingTransaction[]
  queue,                // QueuedTx[] (legacy)
  enqueue,              // (params) => Promise<string>
  remove,               // (id) => Promise<void>
  clearCompleted,       // () => Promise<number>
  retryFailed,          // (hash, submitFn) => Promise<string>
  processQueue,         // (submitFn) => Promise<void>
  isEmpty               // boolean
} = useTxRetryQueue(maxRetries, persistenceKey);
```

### Component API

```typescript
// Single status pill
<TxStatusPill transaction={pendingTx} />

// List of transactions
<TxStatusList
  transactions={pendingTransactions}
  onClearCompleted={handleClear}
/>
```

### IndexedDB API

```typescript
import {
  savePendingTransaction,
  getPendingTransaction,
  getAllPendingTransactions,
  getPendingTransactionsByStatus,
  deletePendingTransaction,
  deleteCompletedTransactions
} from '@/services/indexedDbCache';
```

## 📚 Full Documentation

For complete details, see:
- **Architecture**: `IMPLEMENTATION_SUMMARY.md`
- **Usage Guide**: `TRANSACTION_QUEUE_README.md`
- **Visual Flows**: `FLOW_DIAGRAM.md`
- **Tests**: `TEST_RESULTS.md`
- **Checklist**: `COMPLETION_CHECKLIST.md`

## 🎉 Success Indicators

✅ Tests pass: `npm test`  
✅ TypeScript clean: `npm run typecheck`  
✅ Linting clean: `npm run lint`  
✅ Build succeeds: `npm run build`  
✅ Transactions persist after page reload  
✅ Duplicates are prevented within 30s  
✅ Status updates automatically  
✅ UI shows correct states  

## 🚦 Ready for Production?

**Almost!** Just need to:
1. Replace mock tx-status API with real Soroban RPC
2. Add monitoring/logging
3. Test on testnet
4. Deploy!

---

**Need help?** Check the full documentation or the test files for examples.

**Found a bug?** Check `COMPLETION_CHECKLIST.md` for known limitations.
