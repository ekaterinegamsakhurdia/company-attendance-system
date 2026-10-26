import { useState } from 'react';
import { Cake, CalendarClock, PartyPopper, Pencil } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useLoad } from '../../hooks/useLoad';
import PersonLink from '../../components/PersonLink';
import { useProfileCard } from '../../hooks/useProfileCard';
import { Alert, DataTable, Field, Message, PillButton, SectionCard } from '../../components/ui';
import { listProfiles } from '../../services/api';
import { missingDates, profileMap, serviceText, upcomingCelebrations } from '../../lib/celebrations';
import { longDate, shortDate } from '../../lib/calendar';
import { todayInTz } from '../../lib/time';

const WINDOWS = [
  { days: 30, label: 'Next 30 days' },
  { days: 90, label: 'Next 3 months' },
  { days: 366, label: 'Next 12 months' },
];

const inText = (n) => (n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : `in ${n} days`);

/** Upcoming birthdays and work anniversaries, plus who is still missing a date. */
export default function CelebrationsTab({ directory }) {
  const { employee: me, timezone } = useAuth();
  const card = useProfileCard();
  const today = todayInTz(timezone);
  const profiles = useLoad(listProfiles, [card?.version]);
  const [windowDays, setWindowDays] = useState(90);

  const employees = directory.employees;
  const deptName = (id) => directory.departments.find((d) => d.id === id)?.name ?? '-';
  const data = profiles.data ?? [];
  const byId = profileMap(data);

  const birthdays = upcomingCelebrations({ employees, profiles: data, kind: 'birthday', today, withinDays: windowDays });
  const anniversaries = upcomingCelebrations({ employees, profiles: data, kind: 'anniversary', today, withinDays: windowDays });
  const missing = missingDates({ employees, profiles: data });

  // A CEO may not edit another CEO's or the developer's details (the database enforces it too).
  const canEdit = (e) => me.role === 'developer' || e.role === 'employee' || e.id === me.id;

  return (
    <>
      <SectionCard icon={CalendarClock} title="Birthdays & Anniversaries">
        <div className="la-toolbar">
          <Field label="Show" id="cel-window">
            <select id="cel-window" className="la-input compact" value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))}>
              {WINDOWS.map((w) => (
                <option key={w.days} value={w.days}>{w.label}</option>
              ))}
            </select>
          </Field>
        </div>
        {profiles.error && <Alert error>{profiles.error}</Alert>}
      </SectionCard>

      <SectionCard icon={Cake} title="Birthdays">
        {profiles.loading && !profiles.data ? (
          <Message>Loading…</Message>
        ) : birthdays.length === 0 ? (
          <Message>No birthdays in this period.</Message>
        ) : (
          <DataTable headers={['Name', 'Department', 'Date', 'When', 'Turning']} minWidth={620}>
            {birthdays.map((b) => (
              <tr key={b.employee.id}>
                <td className="la-td"><PersonLink id={b.employee.id}>{b.name}</PersonLink></td>
                <td className="la-td">{deptName(b.employee.department_id)}</td>
                <td className="la-td">{shortDate(b.date)}</td>
                <td className="la-td">{inText(b.daysUntil)}</td>
                <td className="la-td">{b.years}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      <SectionCard icon={PartyPopper} title="Work anniversaries">
        {profiles.loading && !profiles.data ? (
          <Message>Loading…</Message>
        ) : anniversaries.length === 0 ? (
          <Message>No work anniversaries in this period.</Message>
        ) : (
          <DataTable headers={['Name', 'Department', 'Date', 'When', 'Years', 'Started']} minWidth={700}>
            {anniversaries.map((a) => (
              <tr key={a.employee.id}>
                <td className="la-td"><PersonLink id={a.employee.id}>{a.name}</PersonLink></td>
                <td className="la-td">{deptName(a.employee.department_id)}</td>
                <td className="la-td">{shortDate(a.date)}</td>
                <td className="la-td">{inText(a.daysUntil)}</td>
                <td className="la-td">{a.years}</td>
                <td className="la-td">{longDate(byId.get(a.employee.id).hire_date)}</td>
              </tr>
            ))}
          </DataTable>
        )}
      </SectionCard>

      {missing.length > 0 && (
        <SectionCard icon={Pencil} title="Missing dates">
          <p className="la-meta">These people will appear in the calendar and the analytics once their dates are entered.</p>
          <DataTable headers={['Name', 'Department', 'Birth date', 'Start date', '']} minWidth={640}>
            {missing.map(({ employee: e, birth, hire }) => (
              <tr key={e.id}>
                <td className="la-td"><PersonLink id={e.id}>{e.first_name} {e.last_name}</PersonLink></td>
                <td className="la-td">{deptName(e.department_id)}</td>
                <td className="la-td">{birth ? 'missing' : longDate(byId.get(e.id).birth_date)}</td>
                <td className="la-td">
                  {hire ? 'missing' : `${longDate(byId.get(e.id).hire_date)} (${serviceText(byId.get(e.id).hire_date, today)})`}
                </td>
                <td className="la-td">
                  {canEdit(e) ? (
                    <PillButton variant="secondary" size="sm" icon={Pencil} onClick={() => card.open(e.id, { edit: true })}>
                      Add dates
                    </PillButton>
                  ) : (
                    <span className="la-protected">Protected</span>
                  )}
                </td>
              </tr>
            ))}
          </DataTable>
        </SectionCard>
      )}

    </>
  );
}
