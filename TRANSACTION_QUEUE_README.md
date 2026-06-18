# Transaction Retry Queue with Persistence & Deduplication

## Problem Statement

The IoT Billing Frontend application had issues with:

1. **Lost transaction state** - When users refreshed the page during pending transactions, the transaction hash was lost
2. **Duplicate submissions** - Users clicking "Submit" multiple times due to network latency resulted in duplicate contract calls
3. **No confirmation tracking** - No UI feedback showing transaction status after submission

## Solution Overview

This implementation provides:

- ✅ **IndexedDB persistence** - Transaction state survives page reloads
- ✅ **30-second deduplication window** - Prevents duplicate submissions
- ✅ **Automatic status polling** - Checks transaction status every 5 seconds
- ✅ **Real-time UI updates** - Visual feedback for pending, confirmed, and failed states
- ✅ **Retry tracking** - Monitors retry attempts and ledger confirmations

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    TransactionModal                          │
│  - User initiates deposit/withdrawal                        │
│  - Calls useTxRetryQueue.enqueue()                         │
└───────────────────┬─────────────────────────────────────────┘
                    │
                    ▼
┌─────────────────────────────────────────────────────────────┐
│                  useTxRetryQueue Hook                        │
│  - Checks for duplicates (30s window)                       │
│  - Saves to IndexedDB                                       │
│  - Starts status polling                                    │
└───────────────────┬─────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
┌──────────────────┐    ┌──────────────────┐
│   IndexedDB      │    │  Status Polling   │
│   Persistence    │    │  (5s intervals)   │
│                  │    │                   │
│  - pendingTxs    │    │  GET /api/escrow/ │
│    store         │    │      tx-status    │
│  - status index  │    │                   │
└──────────────────┘    └─────────┬─────────┘
                                  │
                                  ▼
                        ┌──────────────────┐
                        │  Update Status   │
                        │  in IndexedDB    │
                        └─────────┬────────┘
                                  │
                                  ▼
                        ┌──────────────────┐
                        │  TxStatusPill    │
                        │  UI Component    │
                        └──────────────────┘
```

## Key Components

### 1. IndexedDB Schema (v2)

**Store**: `pendingTransactions`

**Indexes**:
- `status` - Filter by transaction status
- `createdAt` - Time-based queries
- `hash` - Hash-based lookups

**Schema**:
```typescript
interface PendingTransaction {
  id: string;                    // Unique identifier
  hash: string;                  // Transaction hash
  contractId: string;            // Contract address
  amount: string;                // Transaction amount
  asset: string;                 // Asset type (USDC, XLM, etc.)
  publicKey: string;             // User's public key
  type: 'escrow_deposit' | 'escrow_withdrawal';
  status: 'pending' | 'confirmed' | 'failed';
  retryCount: number;            // Number of confirmation attempts
  maxRetries: number;            // Maximum retry attempts (default 10)
  lastScannedLedger?: number;    // Last confirmed ledger number
  createdAt: number;             // Creation timestamp
  updatedAt: number;             // Last update timestamp
}
```

### 2. useTxRetryQueue Hook

**API**:
```typescript
const {
  pendingTransactions,  // Array of pending transactions
  enqueue,              // Add new transaction
  remove,               // Remove transaction by ID
  clearCompleted,       // Remove all confirmed transactions
  isEmpty               // Check if queue is empty
} = useTxRetryQueue(maxRetries, persistenceKey);
```

**Parameters**:
- `maxRetries` - Maximum retry attempts (default: 10)
- `persistenceKey` - Optional key for persistence (enables IndexedDB)

**Deduplication Logic**:
```typescript
// Checks within 30-second window
// Compares: contractId, amount, asset, publicKey, type
// Only deduplicates 'pending' transactions
```

**Status Polling**:
- Interval: 5 seconds
- Max attempts: 120 (10 minutes total)
- Endpoint: `GET /api/escrow/tx-status?hash={hash}`

### 3. TxStatusPill Component

**Visual States**:

| Status | Icon | Color | Display Text |
|--------|------|-------|-------------|
| Pending | ⏳ | Yellow | "Submitted (pending confirmation)" + timestamp |
| Confirmed | ✓ | Green | "Confirmed on ledger {number}" |
| Failed | ✗ | Red | "Failed - retry {count}/{max}" |

**Usage**:
```tsx
<TxStatusList 
  transactions={pendingTransactions}
  onClearCompleted={handleClearCompleted}
/>
```

## Usage Examples

### Basic Usage

```tsx
import { useTxRetryQueue } from '@/hooks/useTxRetryQueue';
import { TxStatusList } from '@/components/wallet/TxStatusPill';

function MyComponent() {
  const { pendingTransactions, enqueue, clearCompleted } = 
    useTxRetryQueue(10, 'my-queue-key');

  const handleSubmit = async () => {
    // Submit transaction to API
    const response = await fetch('/api/escrow/deposit', {
      method: 'POST',
      body: JSON.stringify({ /* params */ })
    });
    
    const { hash } = await response.json();
    
    // Add to queue (with deduplication)
    await enqueue({
      hash,
      contractId: 'CXXX...',
      amount: '1000',
      asset: 'USDC',
      publicKey: 'GXXX...',
      type: 'escrow_deposit'
    });
  };

  return (
    <>
      <button onClick={handleSubmit}>Submit</button>
      <TxStatusList 
        transactions={pendingTransactions}
        onClearCompleted={clearCompleted}
      />
    </>
  );
}
```

### Without Persistence

```tsx
// No persistenceKey = in-memory only
const { pendingTransactions, enqueue } = useTxRetryQueue(10);
```

### Custom Retry Limit

```tsx
// Set custom max retries
const { pendingTransactions, enqueue } = useTxRetryQueue(20, 'my-key');
```

## API Endpoint

### Transaction Status Endpoint

**Endpoint**: `GET /api/escrow/tx-status?hash={transactionHash}`

**Response**:
```json
{
  "status": "pending" | "confirmed" | "failed",
  "ledger": 1000000,  // Optional, only for confirmed
  "hash": "abc123..."
}
```

**Current Implementation**: Mock simulation

**Production TODO**: Replace with real Soroban RPC calls:

```typescript
import { SorobanRpc } from '@stellar/stellar-sdk';

const server = new SorobanRpc.Server(process.env.SOROBAN_RPC_URL);

export async function GET(request: NextRequest) {
  const hash = request.nextUrl.searchParams.get('hash');
  
  try {
    const tx = await server.getTransaction(hash);
    
    if (tx.status === SorobanRpc.Api.GetTransactionStatus.SUCCESS) {
      return NextResponse.json({
        status: 'confirmed',
        ledger: tx.ledger,
        hash
      });
    } else if (tx.status === SorobanRpc.Api.GetTransactionStatus.FAILED) {
      return NextResponse.json({
        status: 'failed',
        hash
      });
    }
    
    return NextResponse.json({
      status: 'pending',
      hash
    });
  } catch (error) {
    // Handle errors
  }
}
```

## Testing

### Run All Tests
```bash
npm test
```

### Test Coverage
- **IndexedDB operations**: 7 tests
- **Queue deduplication**: 9 tests
- **UI components**: 11 tests
- **Total**: 27+ new tests

### Manual Testing Checklist

1. **Deduplication**:
   - [ ] Click submit twice quickly - should only create one entry
   - [ ] Wait 30 seconds, submit again - should create new entry

2. **Persistence**:
   - [ ] Submit transaction, refresh page - transaction should still show
   - [ ] Close tab, reopen - transaction should still show
   - [ ] Clear browser data - transaction should be gone

3. **Status Updates**:
   - [ ] Submit transaction - should show "pending"
   - [ ] Wait for confirmation - should update to "confirmed"
   - [ ] Failed transaction - should show "failed" with retry count

4. **Clear Completed**:
   - [ ] Confirm some transactions
   - [ ] Click "Clear completed"
   - [ ] Only confirmed transactions should be removed

## Configuration

### Timing Constants

```typescript
// In useTxRetryQueue.ts
const RETRY_DELAY_BASE = 2000;        // 2 seconds
const MAX_RETRIES_DEFAULT = 10;       // 10 retries
const DEDUP_WINDOW_MS = 30_000;       // 30 seconds

// In polling logic
const POLL_INTERVAL = 5000;           // 5 seconds
const MAX_POLL_ATTEMPTS = 120;        // 10 minutes
```

### Adjusting Polling

To change polling frequency:
```typescript
// In startPollingTxStatus function
const pollInterval = setInterval(async () => {
  // ... status check logic
}, 3000); // Change from 5000 to 3000 for 3-second intervals

const MAX_POLL_ATTEMPTS = 200; // Adjust attempts accordingly
```

## Performance Considerations

### IndexedDB Operations
- **Async by nature** - All operations are non-blocking
- **Indexed queries** - Status lookups use indexes for fast filtering
- **Batch operations** - `getAllPendingTransactions()` fetches all at once

### Memory Usage
- **Minimal state** - Only pending transactions kept in memory
- **Cleanup** - `clearCompleted()` removes finished transactions
- **Auto-cleanup** - Failed transactions removed after max retries

### Network Usage
- **Polling frequency** - 5 seconds (configurable)
- **Auto-stop** - Polling stops on confirmation or after 10 minutes
- **Batch restore** - On mount, restores all at once

## Troubleshooting

### Transactions Not Persisting

**Check**:
1. Is `persistenceKey` provided to `useTxRetryQueue`?
2. Are IndexedDB operations allowed in browser?
3. Check browser console for IndexedDB errors

**Fix**:
```typescript
// Ensure persistenceKey is provided
const { enqueue } = useTxRetryQueue(10, 'my-persistence-key');
```

### Duplicates Not Being Detected

**Check**:
1. Are you submitting within 30 seconds?
2. Are all parameters exactly the same?
3. Is the first transaction still 'pending'?

**Debug**:
```typescript
// Add logging to findDuplicate
const duplicate = findDuplicate(params);
console.log('Checking for duplicate:', params);
console.log('Found duplicate:', duplicate);
```

### Status Not Updating

**Check**:
1. Is the tx-status API endpoint working?
2. Check network tab for polling requests
3. Verify transaction hash is correct

**Debug**:
```typescript
// Check polling in browser console
// Should see requests every 5 seconds
fetch('/api/escrow/tx-status?hash=YOUR_HASH')
  .then(r => r.json())
  .then(console.log);
```

### Clear Completed Not Working

**Check**:
1. Are there any confirmed transactions?
2. Check IndexedDB in DevTools

**Fix**:
```typescript
// Manually clear all
const count = await clearCompleted();
console.log(`Cleared ${count} transactions`);
```

## Migration Guide

### From Old useTxRetryQueue

**Before**:
```typescript
const { queue, enqueue } = useTxRetryQueue(3);
enqueue(transaction); // Transaction object
```

**After**:
```typescript
const { pendingTransactions, enqueue } = useTxRetryQueue(10, 'queue-key');
await enqueue({
  hash: tx.hash,
  contractId: tx.contractId,
  amount: tx.amount,
  asset: tx.asset,
  publicKey: tx.publicKey,
  type: 'escrow_deposit'
});
```

### IndexedDB Version Migration

The implementation handles migration from v1 to v2 automatically:
- Existing stores are preserved
- New `pendingTransactions` store is created
- Indexes are added automatically

## Security Considerations

1. **Input Validation**: All transaction parameters should be validated before storage
2. **XSS Protection**: Transaction hashes and IDs are displayed using React (auto-escaped)
3. **Data Privacy**: IndexedDB is origin-specific (won't leak across domains)
4. **Rate Limiting**: Consider rate-limiting the status endpoint in production

## Future Enhancements

1. **Service Worker Integration**: Move polling to background service worker
2. **Push Notifications**: Notify users when transactions confirm
3. **Transaction History**: Add dedicated history view with pagination
4. **Export Functionality**: Allow users to export transaction history
5. **Advanced Filtering**: Filter by date range, status, amount, etc.
6. **Retry UI**: Manual retry button for failed transactions
7. **Batch Operations**: Clear multiple transactions at once
8. **Analytics**: Track transaction success rates and timing

## Support

For issues or questions:
1. Check browser console for errors
2. Verify IndexedDB is enabled
3. Test with mock API endpoint first
4. Check test files for usage examples

## License

Same as parent project.
