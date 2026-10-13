import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';

/**
 * A dropdown with checkboxes. `value` is an array of selected option values;
 * an empty array means "everything" (shown as `allLabel`).
 */
export default function MultiSelect({ label, options, value, onChange, allLabel = 'All', searchable }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const root = useRef(null);
  const id = useId();
  const showSearch = searchable ?? options.length > 8;

  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e) => {
      if (root.current && !root.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
  }, [options, query]);

  const summary =
    value.length === 0
      ? allLabel
      : value.length <= 2
        ? value.map((v) => options.find((o) => o.value === v)?.label ?? '').filter(Boolean).join(', ')
        : `${value.length} selected`;

  const toggle = (v) => onChange(value.includes(v) ? value.filter((x) => x !== v) : [...value, v]);

  return (
    <div className="la-ms" ref={root}>
      <span className="la-label" id={`${id}-label`}>{label}</span>
      <button
        type="button"
        className="la-ms-button la-input compact"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-labelledby={`${id}-label`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="la-ms-summary">{summary}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="la-ms-pop" role="group" aria-labelledby={`${id}-label`}>
          {showSearch && (
            <input
              className="la-input compact"
              style={{ width: '100%' }}
              placeholder="Search…"
              aria-label={`Search ${label}`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          )}
          <div className="la-ms-list">
            {shown.length === 0 && <div className="la-meta" style={{ padding: 8 }}>Nothing found.</div>}
            {shown.map((o) => (
              <label key={o.value} className="la-ms-option">
                <input type="checkbox" checked={value.includes(o.value)} onChange={() => toggle(o.value)} />
                <span>{o.label}</span>
              </label>
            ))}
          </div>
          <div className="la-ms-foot">
            <button type="button" className="la-link" onClick={() => onChange([])} disabled={value.length === 0}>
              Clear
            </button>
            <button type="button" className="la-link" onClick={() => setOpen(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
