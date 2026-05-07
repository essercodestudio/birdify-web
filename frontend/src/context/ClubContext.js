import { useContext } from 'react';
import { ThemeContext } from '../App';

/**
 * Hook centralizado para dados do clube atual.
 *
 * isFootgolf: derivado de sport_type (DB) com fallback por nome/domínio,
 * para não exigir migração de schema imediata.
 */
export function useClub() {
  const club = useContext(ThemeContext);

  const isFootgolf = !!(
    club?.sport_type === 'footgolf' ||
    club?.name?.toLowerCase().includes('footgolf') ||
    (typeof window !== 'undefined' &&
      window.location.hostname.toLowerCase().includes('footgolf'))
  );

  return { club, isFootgolf };
}
