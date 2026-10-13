import { CATEGORIES, balanceMap } from '../lib/leaves';

export default function BalanceCards({ rows }) {
  const byCategory = balanceMap(rows);
  return (
    <div className="la-grid three">
      {CATEGORIES.map((c) => {
        const b = byCategory[c.id];
        const pct = b && b.allowance > 0 ? Math.min(100, Math.round(((b.used + b.pending) / b.allowance) * 100)) : 0;
        return (
          <div key={c.id} className="la-tile la-stat" aria-label={`${c.label} balance`}>
            <span className="la-stat-label">{c.label}</span>
            <strong className="la-stat-num">{b ? b.remaining : '-'}</strong>
            <span className="la-stat-label">days left</span>
            <div className="la-bar" aria-hidden="true">
              <i style={{ width: `${pct}%` }} />
            </div>
            {b && (
              <span className="la-balance-sub">
                {b.used} used{b.pending > 0 ? ` · ${b.pending} pending` : ''} · {b.allowance} a year
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
