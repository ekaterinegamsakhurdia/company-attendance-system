import { useLoad } from './useLoad';
import { listLeaves } from '../services/api';

/** Requests waiting for a decision (for the badge on the Leaves tab and the approvals list). */
export function usePendingLeaves(enabled = true) {
  return useLoad(() => listLeaves('managed', { status: 'pending' }), [], { enabled });
}
