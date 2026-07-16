import { createContext, useContext, useState, type ReactNode } from 'react';

interface ConnectionStateContextValue {
  isOnline: boolean;
  setIsOnline: (online: boolean) => void;
}

const ConnectionStateContext = createContext<ConnectionStateContextValue>({
  isOnline: true,
  setIsOnline: () => {},
});

export function ConnectionStateProvider({ children }: { children: ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);

  return (
    <ConnectionStateContext.Provider value={{ isOnline, setIsOnline }}>
      {children}
    </ConnectionStateContext.Provider>
  );
}

export function useConnectionState() {
  return useContext(ConnectionStateContext);
}
