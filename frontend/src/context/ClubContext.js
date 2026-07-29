import { useContext } from 'react';
import { ThemeContext } from '../App';

export function useClub() {
  const club = useContext(ThemeContext);
  return { club };
}
