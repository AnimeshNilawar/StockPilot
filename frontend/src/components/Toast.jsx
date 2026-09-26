/** Tiny toast bus: a provider publishes, `<ToastViewport />` renders. */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

const ToastContext = createContext(null);

let nextId = 0;

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());

  const dismiss = useCallback((id) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const push = useCallback(
    (toast) => {
      const id = nextId++;
      const entry = { id, tone: 'success', ...toast };
      setToasts((current) => [...current, entry]);
      const timer = setTimeout(() => dismiss(id), entry.duration ?? 5000);
      timers.current.set(id, timer);
      return id;
    },
    [dismiss],
  );

  const value = useMemo(
    () => ({
      toasts,
      push,
      dismiss,
      success: (message, options) => push({ tone: 'success', message, ...options }),
      error: (message, options) => push({ tone: 'error', message, duration: 8000, ...options }),
      info: (message, options) => push({ tone: 'info', message, ...options }),
    }),
    [toasts, push, dismiss],
  );

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  return <ToastContext.Provider value={value}>{children}</ToastContext.Provider>;
}

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside <ToastProvider>');
  return context;
}
