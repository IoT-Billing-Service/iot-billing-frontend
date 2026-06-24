/**
 * tx_manager.ts — Transaction submission with retry on RPC restart errors.
 */

import { sendTransaction, getTransaction, GetTransactionResult } from './rpc_client';

const POLL_INTERVAL_MS = 3_000;
const MAX_POLLS = 20;

export async function submitAndWait(txXdr: string): Promise<GetTransactionResult> {
  const { hash } = await sendTransaction(txXdr);

  for (let i = 0; i < MAX_POLLS; i++) {
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    const result = await getTransaction(hash);
    if (result.status !== 'NOT_FOUND') return result;
  }

  throw new Error(`Transaction ${hash} not confirmed after ${MAX_POLLS} polls`);
}
