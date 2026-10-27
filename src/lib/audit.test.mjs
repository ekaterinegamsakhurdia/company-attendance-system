import test from 'node:test';
import assert from 'node:assert/strict';
import { AUDIT_FILTERS, IMPORTANT_ACTIONS, isImportantAction } from './audit.js';

test('important actions are adds, removals and structural changes', () => {
  for (const a of ['employee.create', 'employee.invite', 'employee.delete', 'departments.delete', 'allowed_networks.insert', 'attendance.delete']) assert.ok(isImportantAction(a), a);
  for (const a of ['leave.request', 'leave.approve', 'attendance.auto_clock_out', 'webauthn.remove', 'employee.profile', 'leave.allowance', 'holidays.seed']) assert.ok(!isImportantAction(a), a);
  assert.equal(new Set(IMPORTANT_ACTIONS).size, IMPORTANT_ACTIONS.length);
});

test('filters', () => {
  const f = (id) => AUDIT_FILTERS.find((x) => x.id === id).test;
  const log = (action, actor = 'u') => ({ action, actor_user_id: actor });
  assert.ok(f('important')(log('employee.delete'), { actorIsDeveloper: false }));
  assert.ok(!f('important')(log('employee.delete'), { actorIsDeveloper: true }), 'developer entries are never in the CEO view');
  assert.ok(f('developer')(log('employee.update'), { actorIsDeveloper: true }));
  assert.ok(f('system')(log('attendance.auto_clock_out', null), {}));
  assert.ok(f('leaves')(log('leave.approve'), {}));
});
