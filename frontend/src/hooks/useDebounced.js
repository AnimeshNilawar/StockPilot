/** Debounces a fast-changing value so a search box does not fire a request per keystroke. */
import { useEffect, useState } from 'react';

export function useDebounced(value, delay = 350) {
  const [debounced, setDebounced] = useState(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);

  return debounced;
}
