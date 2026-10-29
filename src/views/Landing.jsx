import { useEffect, useRef, useState } from 'react';
import { CalendarCheck, Clock, Menu as MenuIcon, Users } from 'lucide-react';
import { Arrow, BrandLink, ThemeToggle } from '../components/ui';
import LoopArt from '../components/LoopArt';
import LoopCursor from '../components/LoopCursor';
import LooperMark from '../components/LooperMark';
import OverlayMenu from '../components/OverlayMenu';
import { useReveal } from '../hooks/useReveal';
import { hasFinePointer } from '../lib/motion';
import { navigate } from '../lib/route';

// What the page says. Everything here describes things the app really does.
const TICKER = [
  'Clock in', 'Clock out', 'At the company or online', 'Vacation', 'Unpaid leave', 'Day off',
  'Team calendar', 'Public holidays', 'Birthdays', 'Anniversaries', 'Timesheets', 'Reports',
];

const FIGURES = [
  { n: '3', label: 'kinds of leave', note: 'Vacation, unpaid leave and days off, each with its own balance.' },
  { n: '2', label: 'ways to work', note: 'At the company or online. You choose when you clock in.' },
  { n: '1', label: 'shared calendar', note: 'Everyone’s leave, the public holidays, birthdays and anniversaries.' },
];

const STEPS = [
  {
    tag: 'Morning',
    title: 'Clock in',
    summary: 'One press starts your day. It is the first thing you see after logging in.',
    points: ['Choose the company or online, then press Clock In', 'Your worked time runs live while you are in', 'Overtime is counted for you'],
  },
  {
    tag: 'Planning',
    title: 'Book time off',
    summary: 'Ask for vacation, unpaid leave or a day off in a minute.',
    points: ['Your balances are shown before you ask', 'Name a replacement when your team needs one', 'The request goes to your department head or a CEO'],
  },
  {
    tag: 'Managers',
    title: 'Decide and report',
    summary: 'Heads and CEOs answer requests and keep the numbers in one place.',
    points: ['A To approve tab shows how many are waiting', 'A team calendar and grid with holidays', 'Timesheets and reports you can export'],
  },
];

const ROLES = [
  {
    icon: Clock,
    title: 'For every employee',
    lead: 'Everything you need is on one screen.',
    points: ['Clock in and out, at the company or online', 'Book vacation, unpaid leave and days off', 'See the team calendar, birthdays and holidays', 'Switch between a dark and a light look'],
  },
  {
    icon: Users,
    title: 'For heads and CEOs',
    lead: 'Know who is in, who is away and what is waiting.',
    points: ['Approve or decline leave with a comment', 'A live office map of who is in today', 'Reports, timesheets and analytics', 'Employees, departments and settings in one place'],
  },
];

const NAV = [
  { id: 'features', label: 'What it does', href: '#features' },
  { id: 'day', label: 'A day with Looper', href: '#day' },
  { id: 'roles', label: 'Who it is for', href: '#roles' },
];

/** A card that follows the mouse with a soft glow (mouse only; touch screens just get the static card). */
function Tactile({ className, style, children, ...rest }) {
  const onMove = (e) => {
    if (e.pointerType === 'touch' || !hasFinePointer()) return;
    const r = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--mx', `${e.clientX - r.left}px`);
    e.currentTarget.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  return (
    <article className={className} style={style} onPointerMove={onMove} {...rest}>
      {children}
    </article>
  );
}

export default function Landing() {
  const root = useRef(null);
  const [menu, setMenu] = useState(false);
  useReveal(root);

  // The landing page has its own title; the sign-in page and the app set theirs through the same <title>.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const toLogin = (e) => {
    e?.preventDefault?.();
    navigate('login');
  };

  const menuItems = [
    ...NAV,
    { id: 'login', label: 'Log in', href: '/#login', onSelect: toLogin },
  ];

  return (
    <div className="la-page la-lp" ref={root}>
      <a className="la-skip" href="#main">Skip to content</a>
      <header className="la-nav">
        <div className="la-nav-inner wide">
          <BrandLink />
          <nav className="la-nav-links" aria-label="Page sections">
            {NAV.map((n) => (
              <a key={n.id} href={n.href} className="la-nav-link">{n.label}</a>
            ))}
          </nav>
          <div className="la-nav-right">
            <ThemeToggle />
            <a className="la-btn primary sm la-nav-login" href="/#login" onClick={toLogin}>
              Log in <Arrow />
            </a>
            <button type="button" className="la-menu-btn" onClick={() => setMenu(true)} aria-haspopup="dialog" aria-expanded={menu}>
              <MenuIcon size={16} aria-hidden="true" />
              <span>Menu</span>
            </button>
          </div>
        </div>
      </header>

      <main id="main" className="la-lp-main">
        {/* ---------- Hero ---------- */}
        <section className="la-hero-l" aria-labelledby="home-title">
          <div className="la-hero-art" aria-hidden="true">
            <LoopArt draw run echoes parallax stroke={2.2} />
          </div>
          <div className="la-wrap la-hero-copy">
            <p className="la-kicker">
              Employee attendance <i /> Office or online <i /> One shared calendar
            </p>
            <h1 id="home-title" className="la-display">
              <span className="la-mask"><span style={{ '--i': 0 }}>Attendance that keeps</span></span>
              <span className="la-mask"><span style={{ '--i': 1 }}>everyone <em>in the loop.</em></span></span>
            </h1>
            <p className="la-lede">
              Looper Agency’s attendance system. Clock in from the company or from home, book time off, and see who is in, who is away and who has a birthday.
            </p>
            <div className="la-cta-row">
              <a className="la-btn primary la-btn-lg" href="/#login" onClick={toLogin}>
                Log in <Arrow />
              </a>
              <a className="la-textlink" href="#day">
                See how a day runs <Arrow dir="down" />
              </a>
            </div>
            <p className="la-fine">For the Looper Agency team. Your administrator creates your account.</p>
          </div>
        </section>

        {/* ---------- Ticker ---------- */}
        <section className="la-ticker" id="features" aria-label="What the system covers">
          <div className="la-ticker-track">
            {[0, 1].map((copy) => (
              <ul className="la-ticker-group" key={copy} aria-hidden={copy === 1 ? 'true' : undefined}>
                {TICKER.map((t) => (
                  <li key={t}>
                    <span>{t}</span>
                    <LooperMark size={11} stroke={13} />
                  </li>
                ))}
              </ul>
            ))}
          </div>
        </section>

        {/* ---------- Figures ---------- */}
        <section className="la-wrap la-figs" aria-label="At a glance">
          {FIGURES.map((f, i) => (
            <div className="la-fig" key={f.label} data-reveal style={{ '--i': i }}>
              <b className="la-fig-n">{f.n}</b>
              <span className="la-fig-label">{f.label}</span>
              <p>{f.note}</p>
            </div>
          ))}
        </section>

        {/* ---------- A day with Looper ---------- */}
        <section className="la-sec" id="day" aria-labelledby="day-title">
          <div className="la-wrap">
            <div className="la-sec-head split" data-reveal>
              <div>
                <p className="la-kicker">A day with Looper</p>
                <h2 id="day-title" className="la-h2">From the first click to the <b>last report</b>.</h2>
              </div>
              <div className="la-thread" aria-hidden="true">
                <LoopArt scrub stroke={1.6} />
              </div>
            </div>
          </div>
          <div className="la-wrap">
            <ol className="la-steps">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <Tactile className="la-step" data-reveal style={{ '--i': i }}>
                    <div className="la-step-top">
                      <span className="la-step-no" aria-hidden="true">0{i + 1}<small>/0{STEPS.length}</small></span>
                      <span className="la-tag">{s.tag}</span>
                    </div>
                    <h3>{s.title}</h3>
                    <p className="la-step-sum">{s.summary}</p>
                    <ul>
                      {s.points.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </Tactile>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ---------- Who it is for ---------- */}
        <section className="la-sec" id="roles" aria-labelledby="roles-title">
          <div className="la-wrap">
            <div className="la-sec-head" data-reveal>
              <p className="la-kicker">Who it is for</p>
              <h2 id="roles-title" className="la-h2">One system, <b>two views</b>.</h2>
            </div>
            <div className="la-two">
              {ROLES.map((r, i) => {
                const Icon = r.icon;
                return (
                  <Tactile className="la-role" key={r.title} data-reveal style={{ '--i': i }}>
                    <span className="la-role-icon" aria-hidden="true"><Icon size={20} /></span>
                    <h3>{r.title}</h3>
                    <p className="la-role-lead">{r.lead}</p>
                    <ul>
                      {r.points.map((p) => (
                        <li key={p}>{p}</li>
                      ))}
                    </ul>
                  </Tactile>
                );
              })}
            </div>
          </div>
        </section>

        {/* ---------- Closing call ---------- */}
        <section className="la-end" aria-labelledby="end-title">
          <div className="la-end-art" aria-hidden="true">
            <LoopArt run stroke={1.6} />
          </div>
          <div className="la-wrap la-end-copy" data-reveal>
            <p className="la-kicker"><CalendarCheck size={14} aria-hidden="true" /> Ready when you are</p>
            <h2 id="end-title" className="la-display la-display-sm">Start the day. <em>Keep it going.</em></h2>
            <div className="la-cta-row">
              <a className="la-btn primary la-btn-lg" href="/#login" onClick={toLogin}>
                Log in <Arrow />
              </a>
              <a className="la-textlink" href="#main" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: 'smooth' }); }}>
                Back to top <Arrow dir="up" />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="la-lp-foot">
        <div className="la-wrap la-lp-foot-in">
          <div className="la-foot-brand">
            <span className="la-logo" aria-hidden="true"><LooperMark size={15} stroke={12} /></span>
            <div>
              <strong>Looper Agency</strong>
              <p>Employee Attendance System</p>
            </div>
          </div>
          <nav className="la-foot-links" aria-label="Footer">
            {NAV.map((n) => (
              <a key={n.id} href={n.href}>{n.label}</a>
            ))}
            <a href="/#login" onClick={toLogin}>Log in</a>
          </nav>
          <p className="la-foot-note">
            Version {typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : 'dev'}
          </p>
        </div>
      </footer>

      <OverlayMenu open={menu} onClose={() => setMenu(false)} items={menuItems} title="Menu" footer={<span>Looper Agency · Employee Attendance System</span>} />
      <LoopCursor />
    </div>
  );
}
