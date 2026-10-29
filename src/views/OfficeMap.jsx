import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Building2, Home, Pencil, Wifi } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import Avatar from '../components/Avatar';
import { Alert, SectionCard, Skeleton } from '../components/ui';
import { fetchOfficeRooms, fetchOfficeToday } from '../services/api';
import { buildOffice, driftOf, fallbackLayout, fitFloor, statusText } from '../lib/office';
import { fromRows } from '../lib/floorplan';
import { formatDate, todayInTz } from '../lib/time';

// The editor (drag, resize, forms) is only for developers, so it is fetched only when somebody opens it.
const FloorEditor = lazy(() => import('./FloorEditor'));

const REFRESH_MS = 15000;

/** One person floating in their room. The tooltip shows on hover, keyboard focus and tap. */
function Bubble({ person }) {
  const d = driftOf(person.id);
  const name = `${person.first_name} ${person.last_name}`;
  const status = statusText(person);
  return (
    <button
      type="button"
      className={`la-bub ${person.mode}`}
      style={{ '--dx': `${d.dx}px`, '--dy': `${d.dy}px`, '--dur': `${d.duration}s`, '--delay': `${d.delay}s` }}
      aria-label={`${name}: ${status}${person.overtime ? ', working overtime' : ''}`}
    >
      <span className="la-bub-float">
        <Avatar person={person} path={person.avatar_path} size="md" />
        {person.mode === 'online' && (
          <span className="la-bub-badge" aria-hidden="true"><Home size={11} /></span>
        )}
      </span>
      <span className="la-bub-tip" role="tooltip">
        <strong>{name}</strong>
        <span className={`la-bub-status ${person.mode}`}>{status}</span>
        {person.overtime && <span className="la-bub-status ot">Working overtime</span>}
      </span>
    </button>
  );
}

function Room({ room, cols }) {
  const empty = Math.max(0, room.seats - room.people.length);
  const style = { '--gx': room.x, '--gy': room.y, '--gw': room.w, '--gh': room.h };
  return (
    <section
      className="la-room"
      style={style}
      data-wide={room.w * 3 >= cols * 2 ? '' : undefined}
      data-plain={room.sits ? undefined : ''}
      aria-label={room.sits ? `${room.title}: ${room.people.length} of ${room.seats} in` : room.title}
    >
      <header className="la-room-head">
        <h3>{room.title}</h3>
        {room.seats > 0 && <span>{room.people.length} of {room.seats} in</span>}
      </header>
      <div className="la-room-floor">
        {room.people.map((p) => <Bubble key={p.id} person={p} />)}
        {Array.from({ length: Math.min(empty, 12) }, (_, i) => <span key={`s${i}`} className="la-seat" aria-hidden="true" />)}
      </div>
      {room.sits && room.people.length === 0 && <p className="la-room-empty">Nobody in yet</p>}
    </section>
  );
}

/** "Office today": a floor plan with a floating profile bubble for everybody who is clocked in right now. */
export default function OfficeMap() {
  const { timezone, employee } = useAuth();
  const isDeveloper = employee?.role === 'developer';
  const [editing, setEditing] = useState(false);
  const office = useLoad(fetchOfficeToday);
  const plan = useLoad(fetchOfficeRooms);
  const { reload } = office;
  const reloadPlan = plan.reload;

  // Bubbles appear and disappear by themselves: refresh every few seconds and when the tab comes back.
  useEffect(() => {
    const timer = setInterval(() => document.visibilityState === 'visible' && reload(), REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      reload();
      reloadPlan();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload, reloadPlan]);

  // The saved plan. If it cannot be read (the database update for floor plans is not installed yet) the built-in plan is drawn.
  const planMissing = Boolean(plan.error) && !plan.data;
  const layout = useMemo(() => (plan.data ? fromRows(plan.data) : planMissing ? fallbackLayout(office.data ?? []) : null), [plan.data, planMissing, office.data]);
  const { rooms, summary } = useMemo(() => buildOffice(office.data ?? [], layout ?? []), [office.data, layout]);
  const floor = useMemo(() => fitFloor(rooms), [rooms]);
  const ready = Boolean(office.data) && Boolean(layout);

  return (
    <SectionCard
      icon={Building2}
      eyebrow={formatDate(todayInTz(timezone))}
      title="Office today"
      action={
        <div className="la-office-actions">
          {isDeveloper && !planMissing && !editing && (
            <button type="button" className="la-btn secondary sm" onClick={() => setEditing(true)} disabled={!layout}>
              <Pencil size={14} aria-hidden="true" /> Edit floor plan
            </button>
          )}
          <span className="la-live"><i aria-hidden="true" />Live</span>
        </div>
      }
    >
      {office.error && <Alert error>{office.error}</Alert>}
      {isDeveloper && planMissing && (
        <Alert>The floor plan editor needs the latest database update (migration 15, <code>20261102120000_office_rooms.sql</code>). Until then the original six rooms are shown.</Alert>
      )}
      {!ready && (office.loading || plan.loading) ? (
        <Skeleton lines={4} />
      ) : editing && layout ? (
        <Suspense fallback={<Skeleton lines={4} />}>
          <FloorEditor
            saved={layout}
            onCancel={() => setEditing(false)}
            onSaved={() => {
              setEditing(false);
              reloadPlan();
            }}
          />
        </Suspense>
      ) : (
        <>
          <div className="la-office-summary" role="status" aria-live="polite">
            <span><strong>{summary.office}</strong> in the office</span>
            <span><strong>{summary.online}</strong> online</span>
            <span><strong>{summary.away}</strong> not clocked in</span>
          </div>
          <div className="la-office-legend" aria-hidden="true">
            <span><i className="dot office" /> In the office</span>
            <span><i className="dot online" /> Online, from home (faded)</span>
            <span><i className="dot seat" /> Empty seat</span>
          </div>

          <div className="la-plan" role="group" aria-label="Office floor plan">
            {rooms.length === 0 ? (
              <p className="la-room-empty">{isDeveloper ? 'The floor plan has no rooms. Use Edit floor plan to add one.' : 'The floor plan has no rooms yet.'}</p>
            ) : (
              <div className="la-floor" style={{ '--cols': floor.cols }}>{floor.rooms.map((r) => <Room key={r.key} room={r} cols={floor.cols} />)}</div>
            )}
          </div>
          <p className="la-meta la-office-note"><Wifi size={12} aria-hidden="true" /> Hover over (or tap) a bubble to see who it is. People appear when they clock in and leave when they clock out.</p>
        </>
      )}
    </SectionCard>
  );
}
