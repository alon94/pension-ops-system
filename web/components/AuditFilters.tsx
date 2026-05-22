'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

interface Initial { actor?: string; action?: string; entity?: string; since?: string }

export function AuditFilters({ initial }: { initial: Initial }) {
  const router = useRouter();
  const [actor, setActor] = useState(initial.actor ?? '');
  const [action, setAction] = useState(initial.action ?? '');
  const [entity, setEntity] = useState(initial.entity ?? '');
  const [since, setSince] = useState(initial.since ?? '');

  function go(e: React.FormEvent) {
    e.preventDefault();
    const q = new URLSearchParams();
    if (actor) q.set('actor', actor);
    if (action) q.set('action', action);
    if (entity) q.set('entity', entity);
    if (since) q.set('since', since);
    router.push(`/audit${q.toString() ? '?' + q : ''}`);
  }

  function clear() {
    setActor(''); setAction(''); setEntity(''); setSince('');
    router.push('/audit');
  }

  return (
    <form onSubmit={go} className="card p-5 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
      <Field label="Actor" value={actor} onChange={setActor} placeholder="customer / agent / A11" />
      <Field label="Action" value={action} onChange={setAction} placeholder="AUTH_CREATE / AGENT_RUN" />
      <Field label="Entity" value={entity} onChange={setEntity} placeholder="authorization / agent_task" />
      <Field label="מאז (ISO)" value={since} onChange={setSince} placeholder="2026-05-01" />
      <div className="flex items-end gap-2">
        <button type="submit" className="btn-primary">חיפוש</button>
        <button type="button" onClick={clear} className="btn-secondary">נקה</button>
      </div>
    </form>
  );
}

function Field({ label, value, onChange, placeholder }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <label className="block">
      <span className="label-text">{label}</span>
      <input
        type="text" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder}
        className="input"
      />
    </label>
  );
}
