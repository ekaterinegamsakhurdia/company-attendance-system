import { useLayoutEffect, useRef, useState } from 'react';
import { Layers, LogOut, CheckCircle2, AlertCircle, Inbox } from 'lucide-react';

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
            <h2 className="la-h2">{title}</h2>
            {eyebrow && <p className="la-card-sub">{eyebrow}</p>}
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

export function Skeleton({ lines = 3 }) {
  return (
    <div className="la-skel-group" aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="la-skel" style={{ width: `${[100, 82, 64, 90][i % 4]}%` }} />
      ))}
    </div>
  );
}

/** Loading text gets a skeleton; anything else is shown as a calm empty state. */
export function Message({ children }) {
  const loading = typeof children === 'string' && /^Loading/i.test(children);
  return (
    <div className={`la-message${loading ? ' loading' : ''}`} role="status">
      {loading ? (
        <>
          <Skeleton />
          <span className="la-message-text">{children}</span>
        </>
      ) : (
        <>
          <span className="la-message-icon" aria-hidden="true">
            <Inbox size={18} />
          </span>
          <span className="la-message-text">{children}</span>
        </>
      )}
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
  const trackRef = useRef(null);
  const [ind, setInd] = useState(null);
  const [edge, setEdge] = useState({ start: false, end: false });

  // The highlight slides to the selected tab; on narrow screens the bar scrolls it into view.
  useLayoutEffect(() => {
    const track = trackRef.current;
    if (!track) return undefined;
    const measureEdges = () =>
      setEdge({ start: track.scrollLeft > 4, end: track.scrollLeft + track.clientWidth < track.scrollWidth - 4 });
    const place = () => {
      const el = track.querySelector('[aria-selected="true"]');
      if (el) setInd({ left: el.offsetLeft, top: el.offsetTop, width: el.offsetWidth, height: el.offsetHeight });
      else setInd(null);
      measureEdges();
    };
    place();
    const el = track.querySelector('[aria-selected="true"]');
    if (el && track.scrollWidth > track.clientWidth) {
      track.scrollTo?.({ left: Math.max(0, el.offsetLeft - (track.clientWidth - el.offsetWidth) / 2), behavior: 'smooth' });
    }
    track.addEventListener('scroll', measureEdges, { passive: true });
    if (typeof ResizeObserver === 'undefined') return () => track.removeEventListener('scroll', measureEdges);
    const ro = new ResizeObserver(place);
    ro.observe(track);
    track.querySelectorAll('.la-tab').forEach((t) => ro.observe(t));
    return () => {
      ro.disconnect();
      track.removeEventListener('scroll', measureEdges);
    };
  }, [value, tabs.length]);

  return (
    <div className={`la-tabs-wrap${edge.start ? ' fade-start' : ''}${edge.end ? ' fade-end' : ''}`}>
      <div className="la-tabs" role="tablist" ref={trackRef}>
        {ind && (
          <span
            className="la-tab-ind"
            aria-hidden="true"
            style={{ transform: `translate(${ind.left}px, ${ind.top}px)`, width: ind.width, height: ind.height }}
          />
        )}
        {tabs.map((t) => {
          const Icon = t.icon;
          return (
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
              {Icon && <Icon size={15} aria-hidden="true" />}
              <span className="la-tab-label">{t.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const initials = (u) => `${(u?.first_name || '?')[0]}${(u?.last_name || '')[0] || ''}`.toUpperCase();

/**
 * Page frame. `user` ({ first_name, last_name }) and `roleLabel` fill the account chip in the top bar;
 * `bare` drops the bar for sign-in style pages.
 */
export function Shell({ children, wide, onLogout, user, roleLabel, bare }) {
  return (
    <div className={`la-page${bare ? ' bare' : ''}`}>
      {!bare && (
        <header className="la-nav">
          <div className={`la-nav-inner${wide ? ' wide' : ''}`}>
            <div className="la-brand">
              <span className="la-logo" aria-hidden="true">
                <Layers size={18} />
              </span>
              <span>Looper Agency</span>
            </div>
            <div className="la-nav-right">
              {user && (
                <div className="la-user" title={`${user.first_name} ${user.last_name}`}>
                  <span className="la-avatar" aria-hidden="true">
                    {initials(user)}
                  </span>
                  <span className="la-user-text">
                    <span className="la-user-name">
                      {user.first_name} {user.last_name}
                    </span>
                    {roleLabel && <span className="la-user-role">{roleLabel}</span>}
                  </span>
                </div>
              )}
              {onLogout && (
                <button type="button" className="la-btn secondary sm la-logout" onClick={onLogout} aria-label="Log Out">
                  <LogOut size={15} aria-hidden="true" />
                  <span className="la-logout-text">Log Out</span>
                </button>
              )}
            </div>
          </div>
        </header>
      )}
      <main className={`la-main${wide ? ' wide' : ''}`}>{children}</main>
      <footer className="la-version">Version {typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : 'dev'}</footer>
    </div>
  );
}

/** Page header. With `title` it is a compact dashboard header, otherwise the original brand banner. */
export function Hero({ eyebrow, title, subtitle }) {
  if (title) {
    return (
      <div className="la-hero compact">
        <div className="la-hero-text">
          {eyebrow && <span className="la-badge">{eyebrow}</span>}
          <h1 className="la-h1">{title}</h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
    );
  }
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

/** Centered brand block + card used by the sign-in and password pages. */
export function AuthLayout({ subtitle, children }) {
  return (
    <Shell bare>
      <div className="la-auth">
        <div className="la-auth-brand">
          <span className="la-logo big" aria-hidden="true">
            <Layers size={26} />
          </span>
          <h1 className="la-h1">
            Looper <span>Agency</span>
          </h1>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {children}
      </div>
    </Shell>
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
