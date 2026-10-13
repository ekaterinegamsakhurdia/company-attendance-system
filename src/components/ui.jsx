import { Layers, LogOut, CheckCircle2, AlertCircle } from 'lucide-react';

export function Eyebrow({ children }) {
  return <div className="la-eyebrow">{children}</div>;
}

export function IconTile({ icon: Icon }) {
  return (
    <span className="la-icon-tile" aria-hidden="true">
      <Icon size={20} />
    </span>
  );
}

export function PillButton({ variant = 'primary', size, block, icon: Icon, children, className = '', ...rest }) {
  return (
    <button
      type="button"
      className={`la-btn ${variant}${size ? ` ${size}` : ''}${block ? ' block' : ''} ${className}`}
      {...rest}
    >
      {Icon && <Icon size={16} aria-hidden="true" />}
      {children}
    </button>
  );
}

export function SectionCard({ icon, eyebrow, title, action, children }) {
  return (
    <section className="la-card">
      <div className={`la-card-head${action ? ' split' : ''}`}>
        <div className="la-card-head-left">
          {icon && <IconTile icon={icon} />}
          <div>
            {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
            <h2 className="la-h2">{title}</h2>
          </div>
        </div>
        {action}
      </div>
      <div className="la-body">{children}</div>
    </section>
  );
}

export function FeatureTile({ icon: Icon, children }) {
  return (
    <div className="la-tile">
      <span className="la-tile-icon" aria-hidden="true">
        <Icon size={16} />
      </span>
      <div className="la-tile-text">{children}</div>
    </div>
  );
}

export function StatTile({ value, label }) {
  return (
    <div className="la-tile la-stat">
      <strong className="la-stat-num">{value}</strong>
      <span className="la-stat-label">{label}</span>
    </div>
  );
}

export function Alert({ children, success, error }) {
  const Icon = success ? CheckCircle2 : AlertCircle;
  return (
    <div className={`la-alert${success ? ' success' : ''}${error ? ' error' : ''}`} role={success ? 'status' : 'alert'}>
      <Icon size={16} aria-hidden="true" />
      <span>{children}</span>
    </div>
  );
}

export function Pill({ tone, children }) {
  return <span className={`la-pill${tone ? ` ${tone}` : ''}`}>{children}</span>;
}

export function Message({ children }) {
  return (
    <div className="la-message" role="status">
      {children}
    </div>
  );
}

/** headers: array of strings or { label, className } */
export function DataTable({ headers, minWidth, children }) {
  return (
    <div className="la-table-wrap">
      <table className="la-table" style={minWidth ? { minWidth } : undefined}>
        <thead>
          <tr>
            {headers.map((h) => {
              const { label, className = '' } = typeof h === 'string' ? { label: h } : h;
              return (
                <th key={label} className={`la-th ${className}`} scope="col">
                  {label}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Field({ label, id, hint, children }) {
  return (
    <div>
      <label className="la-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {hint && <p className="la-hint">{hint}</p>}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="la-tabs" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.id}
          type="button"
          role="tab"
          id={`tab-${t.id}`}
          aria-selected={value === t.id}
          aria-controls={`panel-${t.id}`}
          className="la-tab"
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

export function Shell({ children, wide, onLogout }) {
  return (
    <div className="la-page">
      <header className="la-nav">
        <div className={`la-nav-inner${wide ? ' wide' : ''}`}>
          <div className="la-brand">
            <IconTile icon={Layers} />
            <span>Looper Agency</span>
          </div>
          {onLogout && (
            <PillButton size="sm" icon={LogOut} onClick={onLogout}>
              Log Out
            </PillButton>
          )}
        </div>
      </header>
      <main className={`la-main${wide ? ' wide' : ''}`}>{children}</main>
      <footer className="la-version">Version {typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : 'dev'}</footer>
    </div>
  );
}

export function Hero({ eyebrow, subtitle }) {
  return (
    <div className="la-hero">
      {eyebrow && <span className="la-badge">{eyebrow}</span>}
      <h1 className="la-h1">
        Looper <span>Agency</span>
      </h1>
      {subtitle && <p>{subtitle}</p>}
    </div>
  );
}

/** Tab text with an optional "N waiting" badge. */
export function TabLabel({ text, count = 0 }) {
  return (
    <>
      {text}
      {count > 0 && (
        <span className="la-badge-count" aria-label={`${count} waiting`}>
          {count}
        </span>
      )}
    </>
  );
}
