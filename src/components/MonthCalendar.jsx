import { useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PillButton } from './ui';
import { MONTH_NAMES, WEEKDAY_SHORT, dateRange, eventsByDay, longDate, monthGrid, parseYmd, shiftMonth } from '../lib/calendar';

export const EVENT_KINDS = {
  holiday: { label: 'Public holiday' },
  leave: { label: 'Approved leave' },
  pending: { label: 'Pending leave' },
  birthday: { label: 'Birthday' },
  anniversary: { label: 'Work anniversary' },
  online: { label: 'Online work day' },
};

const MAX_CHIPS = 3;

/**
 * A month view with a day-detail panel and an agenda list underneath.
 * events: [{ id, kind, start, end?, title, subtitle? }] - `kind` is a key of EVENT_KINDS.
 */
export default function MonthCalendar({ year, month, onMonth, events, today }) {
  const weeks = useMemo(() => monthGrid(year, month), [year, month]);
  const from = weeks[0][0].date;
  const to = weeks[weeks.length - 1][6].date;
  const byDay = useMemo(() => eventsByDay(events, from, to), [events, from, to]);
  const [selected, setSelected] = useState(null);

  const monthStart = `${year}-${String(month).padStart(2, '0')}-01`;
  const monthEnd = weeks.flat().filter((c) => c.inMonth).at(-1).date;
  const agenda = events
    .filter((e) => (e.end ?? e.start) >= monthStart && e.start <= monthEnd)
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  const kindsPresent = Object.keys(EVENT_KINDS).filter((k) => events.some((e) => e.kind === k));
  const selectedEvents = selected ? byDay.get(selected) ?? [] : [];

  const go = (delta) => {
    const next = shiftMonth(year, month, delta);
    setSelected(null);
    onMonth(next.year, next.month);
  };
  const goToday = () => {
    const p = parseYmd(today);
    setSelected(today);
    onMonth(p.y, p.m);
  };

  return (
    <div className="la-cal">
      <div className="la-cal-head">
        <PillButton variant="secondary" size="sm" icon={ChevronLeft} onClick={() => go(-1)} aria-label="Previous month">
          <span className="la-sr">Previous month</span>
        </PillButton>
        <h3 className="la-cal-title" aria-live="polite">
          {MONTH_NAMES[month - 1]} {year}
        </h3>
        <PillButton variant="secondary" size="sm" icon={ChevronRight} onClick={() => go(1)} aria-label="Next month">
          <span className="la-sr">Next month</span>
        </PillButton>
        <PillButton variant="ghost" size="sm" onClick={goToday}>
          Today
        </PillButton>
      </div>

      {kindsPresent.length > 0 && (
        <div className="la-cal-legend" aria-label="Legend">
          {kindsPresent.map((k) => (
            <span key={k} className="la-cal-legend-item">
              <i className={`la-cal-dot ${k}`} aria-hidden="true" /> {EVENT_KINDS[k].label}
            </span>
          ))}
        </div>
      )}

      <div className="la-cal-grid" role="grid" aria-label={`${MONTH_NAMES[month - 1]} ${year}`}>
        {WEEKDAY_SHORT.map((d, i) => (
          <div key={d} className={`la-cal-wd${i >= 5 ? ' weekend' : ''}`} role="columnheader">
            {d}
          </div>
        ))}
        {weeks.flat().map((cell) => {
          const list = byDay.get(cell.date) ?? [];
          const day = parseYmd(cell.date).d;
          const weekend = [5, 6].includes(weeks.flat().indexOf(cell) % 7);
          const hasHoliday = list.some((e) => e.kind === 'holiday');
          return (
            <button
              key={cell.date}
              type="button"
              role="gridcell"
              className={[
                'la-cal-day',
                cell.inMonth ? '' : 'outside',
                weekend ? 'weekend' : '',
                hasHoliday ? 'holiday' : '',
                cell.date === today ? 'today' : '',
                cell.date === selected ? 'selected' : '',
              ].join(' ')}
              aria-label={`${longDate(cell.date)}${list.length ? `, ${list.length} ${list.length === 1 ? 'event' : 'events'}` : ''}`}
              aria-pressed={cell.date === selected}
              onClick={() => setSelected(cell.date === selected ? null : cell.date)}
            >
              <span className="la-cal-num">{day}</span>
              <span className="la-cal-chips">
                {list.slice(0, MAX_CHIPS).map((e) => (
                  <span key={e.id} className={`la-cal-chip ${e.kind}`} title={e.title}>
                    {e.title}
                  </span>
                ))}
                {list.length > MAX_CHIPS && <span className="la-cal-more">+{list.length - MAX_CHIPS} more</span>}
              </span>
              {list.length > 0 && (
                <span className="la-cal-dots" aria-hidden="true">
                  {list.slice(0, 4).map((e) => (
                    <i key={e.id} className={`la-cal-dot ${e.kind}`} />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {selected && (
        <div className="la-cal-detail" role="region" aria-label={`Events on ${longDate(selected)}`}>
          <strong>{longDate(selected)}</strong>
          {selectedEvents.length === 0 ? (
            <p className="la-meta">Nothing on this day.</p>
          ) : (
            <ul className="la-cal-list">
              {selectedEvents.map((e) => (
                <EventLine key={e.id} event={e} />
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="la-cal-agenda">
        <h3 className="la-cal-sub">This month</h3>
        {agenda.length === 0 ? (
          <p className="la-meta">Nothing scheduled in {MONTH_NAMES[month - 1]}.</p>
        ) : (
          <ul className="la-cal-list">
            {agenda.map((e) => (
              <EventLine key={e.id} event={e} withDate />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function EventLine({ event, withDate }) {
  return (
    <li className="la-cal-line">
      <i className={`la-cal-dot ${event.kind}`} aria-hidden="true" />
      <span>
        {withDate && <span className="la-cal-when">{dateRange(event.start, event.end)} · </span>}
        <strong>{event.title}</strong>
        {event.subtitle && <span className="la-meta"> · {event.subtitle}</span>}
        <span className="la-sr"> ({EVENT_KINDS[event.kind]?.label})</span>
      </span>
    </li>
  );
}
