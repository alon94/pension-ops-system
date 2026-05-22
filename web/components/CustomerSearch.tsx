'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api, Customer } from '../lib/api';

export function CustomerSearch() {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(async () => {
      if (q.trim().length === 0) { setResults([]); return; }
      setLoading(true);
      try { setResults(await api.customers(q, 10)); }
      finally { setLoading(false); }
    }, 250);
    return () => clearTimeout(t);
  }, [q]);

  return (
    <div className="card p-4 space-y-3">
      <div className="relative">
        <span className="absolute top-1/2 right-3 -translate-y-1/2 text-ink-400">
          <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
        </span>
        <input
          type="text" value={q} onChange={(e) => setQ(e.target.value)}
          placeholder="חיפוש: שם, ת.ז., או חלק מהם…"
          className="input pr-9"
          aria-label="חיפוש לקוח"
        />
      </div>
      {loading && <div className="text-xs muted">טוען…</div>}
      {q && !loading && results.length === 0 && (
        <div className="text-sm muted text-center py-3">לא נמצאו תוצאות</div>
      )}
      {results.length > 0 && (
        <ul className="divide-y divide-ink-100 -mx-1">
          {results.map((c) => (
            <li key={c.customerId}>
              <Link
                href={`/customers/${c.customerId}`}
                className="block py-2.5 px-2 hover:bg-ink-50 rounded-md text-sm transition-colors"
              >
                <div className="font-medium text-ink-900">{c.firstName} {c.lastName}</div>
                <div className="text-xs muted mt-0.5">ת.ז. {c.israelId}{c.city ? ` · ${c.city}` : ''}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
