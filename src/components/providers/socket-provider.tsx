"use client";

import { useEffect } from "react";
import { useSocketStore } from "@/store/socket-store";

export default function SocketProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const connect = useSocketStore((s) => s.connect);
  const disconnect = useSocketStore((s) => s.disconnect);

  useEffect(() => {
    connect();
    return () => {
      disconnect();
    };
  }, [connect, disconnect]);

  return <>{children}</>;
}
