import { useLayoutEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, LayoutGrid, LogOut, CheckCircle2, AlertCircle, Inbox, Moon, Sun } from 'lucide-react';
import { useTheme } from '../hooks/useTheme';
import Avatar from './Avatar';
import LooperMark from './LooperMark';
import LoopArt from './LoopArt';
import LoopCursor from './LoopCursor';
import OverlayMenu from './OverlayMenu';

export function Eyebrow({ children }) {
  return <div className="la-eyebrow">{children}</div>;
}

/** Small arrow glyph that nudges when its parent link or button is hovered or focused (see .la-arrow in landing.css). */
export function Arrow({ dir = 'right' }) {
  const Icon = dir === 'down' ? ArrowDown : dir === 'up' ? ArrowUp : ArrowRight;
  return (
    <span className={`la-arrow ${dir}`} aria-hidden="true">
      <Icon size={16} />
    </span>
  );
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
              const { label, className = '', node } = typeof h === 'string' ? { label: h } : h;
              return (
                <th key={label} className={`la-th ${className}`} scope="col">
                  {node ?? label}
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
  const [menu, setMenu] = useState(false);
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
    <div className={`la-tabs-wrap has-more${edge.start ? ' fade-start' : ''}${edge.end ? ' fade-end' : ''}`}>
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
      {/* Narrow screens: the strip scrolls, so a button lists every section at once. */}
      <button type="button" className="la-tabs-more" onClick={() => setMenu(true)} aria-haspopup="dialog" aria-label="All sections" title="All sections">
        <LayoutGrid size={17} aria-hidden="true" />
      </button>
      <OverlayMenu
        open={menu}
        onClose={() => setMenu(false)}
        title="Sections"
        items={tabs.map((t) => ({ id: t.id, label: t.label, icon: t.icon, current: value === t.id, onSelect: () => onChange(t.id) }))}
      />
    </div>
  );
}

/**
 * The logo in the top-left corner: a link to the home page. Pressing it reloads the app, which always opens on the
 * attendance page (My attendance for employees, Today for CEOs and developers), so it doubles as "refresh and start over".
 * Ctrl / Cmd / middle click still open it in a new tab.
 */
export function BrandLink() {
  const go = (e) => {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const { pathname, search, hash } = window.location;
    if (pathname === '/' && !search && !hash) window.location.reload();
    else window.location.assign('/');
  };
  return (
    <a className="la-brand" href="/" onClick={go} aria-label="Looper Agency: refresh and go to my attendance" title="My attendance">
      <span className="la-logo" aria-hidden="true">
        <LooperMark size={15} stroke={12} />
      </span>
      <span className="la-brand-name">Looper Agency</span>
    </a>
  );
}

/** Switches between the dark and the light theme (the choice is remembered on this device). */
export function ThemeToggle({ floating = false }) {
  const { theme, toggle } = useTheme();
  const next = theme === 'light' ? 'dark' : 'light';
  const Icon = next === 'light' ? Sun : Moon;
  return (
    <button
      type="button"
      className={`la-theme-toggle${floating ? ' floating' : ''}`}
      onClick={toggle}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      <Icon size={16} aria-hidden="true" />
    </button>
  );
}

/**
 * Page frame. `user` ({ first_name, last_name }), `avatarPath` and `roleLabel` fill the account chip in the top bar
 * (a button that opens "My profile" when `onProfile` is given); `bare` drops the bar for sign-in style pages.
 */
export function Shell({ children, wide, onLogout, user, roleLabel, avatarPath, onProfile, bare }) {
  return (
    <div className={`la-page${bare ? ' bare' : ''}`}>
      {!bare && (
        <header className="la-nav">
          <div className={`la-nav-inner${wide ? ' wide' : ''}`}>
            <BrandLink />
            <div className="la-nav-right">
              <ThemeToggle />
              {user && (
                <div className="la-user">
                  {(() => {
                    const content = (
                      <>
                        <Avatar person={user} path={avatarPath} size="sm" />
                        <span className="la-user-text">
                          <span className="la-user-name">
                            {user.first_name} {user.last_name}
                          </span>
                          {roleLabel && <span className="la-user-role">{roleLabel}</span>}
                        </span>
                      </>
                    );
                    return onProfile ? (
                      <button type="button" className="la-user-btn" onClick={onProfile} aria-label="My profile" title="My profile">
                        {content}
                      </button>
                    ) : (
                      <span className="la-user-btn static">{content}</span>
                    );
                  })()}
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
      {bare && <ThemeToggle floating />}
      <main className={`la-main${wide ? ' wide' : ''}`}>{children}</main>
      <footer className="la-foot">
        <div className="la-foot-in">
          <span className="la-foot-brand">
            <LooperMark size={11} stroke={13} /> Looper Agency <i aria-hidden="true" /> Employee Attendance System
          </span>
          <span className="la-version">Version {typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : 'dev'}</span>
          <button type="button" className="la-foot-top" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}>
            Back to top <Arrow dir="up" />
          </button>
        </div>
      </footer>
    </div>
  );
}

/**
 * Page header. With `title` it is the dashboard header: a small line of facts (`eyebrow` and `subtitle`, for example the
 * role and today's date) above a large headline; `emphasis` is the part of the title set in the elegant italic.
 * Without `title` it is the original brand banner.
 */
export function Hero({ eyebrow, title, emphasis, subtitle }) {
  if (title) {
    const at = emphasis ? title.indexOf(emphasis) : -1;
    return (
      <div className="la-hero compact editorial">
        <div className="la-hero-text">
          {(eyebrow || subtitle) && (
            <p className="la-kicker">
              {eyebrow && <span>{eyebrow}</span>}
              {eyebrow && subtitle && <i aria-hidden="true" />}
              {subtitle && <span>{subtitle}</span>}
            </p>
          )}
          <h1 className="la-h1">
            <span className="la-mask">
              <span>
                {at >= 0 ? (
                  <>
                    {title.slice(0, at)}
                    <em>{emphasis}</em>
                    {title.slice(at + emphasis.length)}
                  </>
                ) : (
                  title
                )}
              </span>
            </span>
          </h1>
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

/**
 * Brand block + card used by the sign-in and password pages. On wide screens a large drawn loop sits beside the card
 * (decoration only); `onBack` adds a "Back to home" link for the sign-in page.
 */
export function AuthLayout({ subtitle, children, onBack }) {
  return (
    <Shell bare>
      <div className="la-auth la-auth-split">
        <aside className="la-auth-art" aria-hidden="true">
          <LoopArt draw run echoes parallax stroke={2.2} />
          <p className="la-auth-art-copy">Clock in. Book time off. <em>Stay in the loop.</em></p>
        </aside>
        <div className="la-auth-main">
          {onBack && (
            <button type="button" className="la-auth-back" onClick={onBack}>
              <span className="la-arrow left" aria-hidden="true"><ArrowLeft size={15} /></span>
              Back to home
            </button>
          )}
          <div className="la-auth-brand">
            <span className="la-logo big" aria-hidden="true">
              <LooperMark size={26} stroke={10} />
            </span>
            <h1 className="la-h1">
              Looper <span>Agency</span>
            </h1>
            {subtitle && <p>{subtitle}</p>}
          </div>
          {children}
        </div>
      </div>
      <LoopCursor />
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
