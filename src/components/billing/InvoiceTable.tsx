'use client';

import React, { useRef, useState, useMemo, startTransition, useReducer, useCallback } from 'react';
import { useCurrencyPref, type CurrencyCode } from '@/stores/useCurrencyPref';
import { useCachedCurrencyFormatter } from '@/hooks/useCurrencyFormatter';
import { useBillingStream, type BillingUpdate } from '@/hooks/useBillingStream';

/* ─── Types ──────────────────────────────────────────── */

export interface BillingLineItem {
  deviceId: string;
  deviceName: string;
  amount: number; // Display amount (already converted from u128)
  currencyCode: CurrencyCode;
}

interface InvoiceTableProps {
  /** Static initial line items (from SSR or initial fetch) */
  initialItems: BillingLineItem[];
}

type SelectionAction =
  | { type: 'TOGGLE'; deviceId: string }
  | { type: 'SELECT_ALL'; deviceIds: string[] }
  | { type: 'CLEAR_ALL' }
  | { type: 'RECONCILE'; visibleIds: Set<string> };

function selectionReducer(state: Set<string>, action: SelectionAction): Set<string> {
  switch (action.type) {
    case 'TOGGLE': {
      const next = new Set(state);
      if (next.has(action.deviceId)) {
        next.delete(action.deviceId);
      } else {
        next.add(action.deviceId);
      }
      return next;
    }
    case 'SELECT_ALL':
      return new Set(action.deviceIds);
    case 'CLEAR_ALL':
      return new Set();
    case 'RECONCILE': {
      // Keep only selected IDs that are actually visible
      const next = new Set<string>();
      state.forEach((id) => {
        if (action.visibleIds.has(id)) {
          next.add(id);
        }
      });
      // Only return new Set if size changed (to avoid unnecessary re-renders)
      return next.size === state.size ? state : next;
    }
    default:
      return state;
  }
}

/* ─── Single row (React.memo) ────────────────────────── */

interface RowProps {
  item: BillingLineItem;
  isSelected: boolean;
  currencyVersion: number;
  formatCurrency: (amount: number, code: CurrencyCode) => string;
  onToggle: (deviceId: string) => void;
}

const InvoiceRow = React.memo(function InvoiceRow({
  item,
  isSelected,
  currencyVersion,
  formatCurrency,
  onToggle,
}: RowProps) {
  return (
    <tr className={`border-b border-gray-200 transition-colors ${isSelected ? 'bg-blue-50/50' : ''}`}>
      <td className="px-4 py-2 text-sm">
        <input
          type="checkbox"
          checked={isSelected}
          onChange={() => onToggle(item.deviceId)}
          className="mr-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
        />
        {item.deviceName}
      </td>
      <td className="px-4 py-2 text-sm font-mono text-right">
        {formatCurrency(item.amount, item.currencyCode)}
      </td>
      <td className="px-4 py-2 text-xs text-gray-500">{item.deviceId}</td>
      <td className="px-4 py-2 text-xs text-gray-400">v{currencyVersion}</td>
    </tr>
  );
});

/* ─── Main Table Component ───────────────────────────── */

export default function InvoiceTable({ initialItems }: InvoiceTableProps) {
  const [items, setItems] = useState<BillingLineItem[]>(initialItems);
  const [selectedIds, dispatch] = useReducer(selectionReducer, new Set<string>());
  
  // Track device list version to detect stale batch operations
  const deviceListVersionRef = useRef(0);
  
  const currency = useCurrencyPref((s) => s.currency);
  const currencyVersion = useCurrencyPref((s) => s.currencyVersion);
  const setCurrency = useCurrencyPref((s) => s.setCurrency);
  const setUserInteracting = useCurrencyPref((s) => s.setUserInteracting);
  const { formatCurrency } = useCachedCurrencyFormatter();
  const tableRef = useRef<HTMLTableElement>(null);

  /* ── Reconciliation ─────────────────────────────── */

  // Selection MUST be reconciled with visible devices on every render
  // to prevent "ghost selections" (devices no longer in the list).
  const visibleIds = useMemo(() => new Set(items.map((i) => i.deviceId)), [items]);
  
  // Reconcile selection state with currently visible items
  React.useEffect(() => {
    dispatch({ type: 'RECONCILE', visibleIds });
  }, [visibleIds]);

  /* ── Billing stream handler ─────────────────────── */

  const handleBillingUpdate = useMemo(
    () => (updates: BillingUpdate[]) => {
      setItems((prev) => {
        const next = [...prev];
        let changed = false;
        for (const u of updates) {
          const idx = next.findIndex((n) => n.deviceId === u.deviceId);
          if (idx !== -1) {
            const item = next[idx]!;
            next[idx] = {
              ...item,
              amount: parseFloat(u.amount),
            };
            changed = true;
          }
        }
        if (changed) {
          deviceListVersionRef.current += 1;
        }
        return next;
      });
    },
    [],
  );

  useBillingStream(handleBillingUpdate);

  /* ── Batch Operations ───────────────────────────── */

  const handleSelectAll = useCallback(() => {
    // Snapshot the current device list and version
    const snapshotVersion = deviceListVersionRef.current;
    const snapshotIds = items.map((i) => i.deviceId);
    
    // In a real concurrent environment, we might check if version changed
    // since the click started, but in sync React, this is our atomic point.
    if (snapshotVersion === deviceListVersionRef.current) {
      dispatch({ type: 'SELECT_ALL', deviceIds: snapshotIds });
    }
  }, [items]);

  const handleClearAll = useCallback(() => {
    dispatch({ type: 'CLEAR_ALL' });
  }, []);

  const handleToggle = useCallback((deviceId: string) => {
    dispatch({ type: 'TOGGLE', deviceId });
  }, []);

  /* ── Mouse interaction lock ─────────────────────── */

  const handleMouseDown = () => setUserInteracting(true);
  const handleMouseUp = () => setUserInteracting(false);
  const handleBlur = () => setUserInteracting(false);

  /* ── Currency switch via startTransition ────────── */

  const handleCurrencyChange = (newCurrency: CurrencyCode) => {
    setUserInteracting(true);
    startTransition(() => {
      setCurrency(newCurrency);
      setUserInteracting(false);
    });
  };

  /* ── Render ─────────────────────────────────────── */

  const allSelected = items.length > 0 && selectedIds.size === items.length;

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div
          className="flex items-center gap-4"
          onMouseDown={handleMouseDown}
          onMouseUp={handleMouseUp}
          onBlur={handleBlur}
        >
          <label className="text-sm font-medium text-gray-700">Display Currency</label>
          <select
            className="rounded-md border border-gray-300 px-3 py-1.5 text-sm"
            value={currency}
            onChange={(e) => handleCurrencyChange(e.target.value as CurrencyCode)}
          >
            <option value="USD">USD ($)</option>
            <option value="EUR">EUR (€)</option>
            <option value="NGN">NGN (₦)</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={allSelected ? handleClearAll : handleSelectAll}
            className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-gray-700 border border-gray-300 hover:bg-gray-50 transition-colors"
          >
            {allSelected ? 'Deselect All' : 'Select All'}
          </button>
          <button
            onClick={handleClearAll}
            disabled={selectedIds.size === 0}
            className="rounded-md bg-white px-3 py-1.5 text-sm font-medium text-red-600 border border-gray-300 hover:bg-red-50 disabled:opacity-50 disabled:hover:bg-white transition-colors"
          >
            Clear Selection
          </button>
        </div>
      </div>

      {/* Invoice table */}
      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table ref={tableRef} className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={allSelected ? handleClearAll : handleSelectAll}
                  className="mr-3 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                />
                Device
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-gray-500">
                Amount
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                ID
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500">
                Version
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {items.map((item) => (
              <InvoiceRow
                key={item.deviceId}
                item={item}
                isSelected={selectedIds.has(item.deviceId)}
                currencyVersion={currencyVersion}
                formatCurrency={formatCurrency}
                onToggle={handleToggle}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-gray-400">
          {items.length} row{items.length !== 1 ? 's' : ''} · Currency version {currencyVersion}
        </p>
        {selectedIds.size > 0 && (
          <p className="text-xs font-medium text-blue-600">
            {selectedIds.size} device{selectedIds.size !== 1 ? 's' : ''} selected
          </p>
        )}
      </div>
    </div>
  );
}
