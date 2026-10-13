import { createContext, useContext } from 'react';

/** { open(employeeId) } - provided on the CEO and developer dashboards only. */
export const ProfileCardContext = createContext(null);
export const useProfileCard = () => useContext(ProfileCardContext);
