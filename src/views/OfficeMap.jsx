import { useEffect, useMemo } from 'react';
import { Building2, Home, Wifi } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { useLoad } from '../hooks/useLoad';
import Avatar from '../components/Avatar';
import { Alert, SectionCard, Skeleton } from '../components/ui';
import { fetchOfficeToday } from '../services/api';
import { buildOffice, driftOf, statusText } from '../lib/office';
import { formatDate, todayInTz } from '../lib/time';

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

function Room({ room }) {
  const empty = Math.max(0, room.seats - room.people.length);
  return (
    <section className={`la-room ${room.area}`} aria-label={`${room.title}: ${room.people.length} of ${room.seats} in`}>
      <header className="la-room-head">
        <h3>{room.title}</h3>
        {room.seats > 0 && <span>{room.people.length} of {room.seats} in</span>}
      </header>
      <div className="la-room-floor">
        {room.people.map((p) => <Bubble key={p.id} person={p} />)}
        {Array.from({ length: Math.min(empty, 12) }, (_, i) => <span key={`s${i}`} className="la-seat" aria-hidden="true" />)}
      </div>
      {room.people.length === 0 && <p className="la-room-empty">Nobody in yet</p>}
    </section>
  );
}

/** "Office today": a floor plan with a floating profile bubble for everybody who is clocked in right now. */
export default function OfficeMap() {
  const { timezone } = useAuth();
  const office = useLoad(fetchOfficeToday);
  const { reload } = office;

  // Bubbles appear and disappear by themselves: refresh every few seconds and when the tab comes back.
  useEffect(() => {
    const timer = setInterval(() => document.visibilityState === 'visible' && reload(), REFRESH_MS);
    const onVisible = () => document.visibilityState === 'visible' && reload();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [reload]);

  const { rooms, summary } = useMemo(() => buildOffice(office.data ?? []), [office.data]);

  return (
    <SectionCard
      icon={Building2}
      eyebrow={formatDate(todayInTz(timezone))}
      title="Office today"
      action={<span className="la-live"><i aria-hidden="true" />Live</span>}
    >
      {office.error && <Alert error>{office.error}</Alert>}
      {!office.data && office.loading ? (
        <Skeleton lines={4} />
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

          <div className="la-plan" aria-label="Office floor plan">
            <div className="la-floor">{rooms.map((r) => <Room key={r.key} room={r} />)}</div>
          </div>
          <p className="la-meta la-office-note"><Wifi size={12} aria-hidden="true" /> Hover over (or tap) a bubble to see who it is. People appear when they clock in and leave when they clock out.</p>
        </>
      )}
    </SectionCard>
  );
}
