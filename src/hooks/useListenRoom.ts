import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientMessage,
  Participant,
  PlaybackState,
  Role,
  RoomSnapshot,
  RoomStatusResponse,
  ServerMessage,
  Track,
} from '../types/room';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'error';
export type RoomPhase = 'checking' | 'entry' | 'joined' | 'error';

const USER_NAME_STORAGE = 'private_listen_room_display_name_v1';
const SESSION_AUTH_STORAGE = 'private_listen_room_session_v2';

interface SessionAuth {
  name: string;
  hostKey: string;
}

export function loadSavedDisplayName(): string {
  try {
    return localStorage.getItem(USER_NAME_STORAGE) || '';
  } catch {
    return '';
  }
}

export function saveDisplayName(name: string) {
  try {
    localStorage.setItem(USER_NAME_STORAGE, name);
  } catch {
    // Ignore storage errors
  }
}

function loadSessionAuth(): SessionAuth | null {
  try {
    const raw = sessionStorage.getItem(SESSION_AUTH_STORAGE);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<SessionAuth>;
    if (typeof parsed.name === 'string' && parsed.name.trim()) {
      return { name: parsed.name, hostKey: typeof parsed.hostKey === 'string' ? parsed.hostKey : '' };
    }
    return null;
  } catch {
    return null;
  }
}

function saveSessionAuth(session: SessionAuth) {
  try {
    sessionStorage.setItem(SESSION_AUTH_STORAGE, JSON.stringify(session));
  } catch {
    // Ignore storage errors
  }
}

function clearSessionAuth() {
  try {
    sessionStorage.removeItem(SESSION_AUTH_STORAGE);
  } catch {
    // Ignore storage errors
  }
}

export function useListenRoom() {
  const [phase, setPhase] = useState<RoomPhase>('checking');
  const [roomStatus, setRoomStatus] = useState<RoomStatusResponse | null>(null);
  const [isEntering, setIsEntering] = useState(false);

  const [roomId, setRoomId] = useState<string>('main');
  const [role, setRole] = useState<Role>('friend');
  const [participantId, setParticipantId] = useState<string>('');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [queue, setQueue] = useState<Track[]>([]);
  const [playback, setPlayback] = useState<PlaybackState>({
    currentTrack: null,
    isPlaying: false,
    positionSeconds: 0,
    updatedAt: Date.now(),
  });
  const [serverTimeOffset, setServerTimeOffset] = useState<number>(0);
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const activeSessionRef = useRef<SessionAuth | null>(null);
  const disposedRef = useRef(false);

  const clearError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  const connectSocket = useCallback((displayName: string, hostKey: string) => {
    if (disposedRef.current) return;
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnectionStatus('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams({
      name: displayName,
      ...(hostKey ? { hostKey } : {}),
    });

    const ws = new WebSocket(`${protocol}//${window.location.host}/ws?${params.toString()}`);
    wsRef.current = ws;

    ws.onopen = () => {
      if (disposedRef.current) return;
      setConnectionStatus('connected');
    };

    ws.onmessage = (event) => {
      if (disposedRef.current) return;
      let msg: ServerMessage;
      try {
        msg = JSON.parse(event.data as string) as ServerMessage;
      } catch {
        return;
      }

      if (msg.type === 'room:init') {
        const snap: RoomSnapshot = msg.snapshot;
        setRoomId(snap.roomId);
        setRole(snap.role);
        setParticipantId(snap.participantId);
        setParticipants(snap.participants);
        setQueue(snap.queue);
        setPlayback(snap.playback);
        setServerTimeOffset(snap.serverTime - Date.now());
        setErrorMessage(null);
        setConnectionStatus('connected');
        setPhase('joined');
      } else if (msg.type === 'room:state') {
        setQueue(msg.queue);
        setPlayback(msg.playback);
        setServerTimeOffset(msg.serverTime - Date.now());
      } else if (msg.type === 'room:participants') {
        setParticipants(msg.participants);
      } else if (msg.type === 'error') {
        setErrorMessage(msg.message);
      }
    };

    ws.onclose = () => {
      if (disposedRef.current) return;
      wsRef.current = null;
      setConnectionStatus((prev) => (prev === 'error' ? 'error' : 'reconnecting'));
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = window.setTimeout(() => {
        const current = activeSessionRef.current;
        if (current && !disposedRef.current) {
          connectSocket(current.name, current.hostKey);
        }
      }, 2000);
    };
  }, []);

  useEffect(() => {
    disposedRef.current = false;

    async function bootstrap() {
      // Normalize any legacy ?room=... query string quietly
      if (window.location.search) {
        window.history.replaceState(null, '', window.location.pathname);
      }

      try {
        const statusRes = await fetch('/api/room/status');
        if (statusRes.ok) {
          const status = (await statusRes.json()) as RoomStatusResponse;
          setRoomStatus(status);
        }

        const session = loadSessionAuth();
        if (session) {
          activeSessionRef.current = session;
          setPhase('joined');
          connectSocket(session.name, session.hostKey);
          return;
        }

        setPhase('entry');
      } catch {
        setErrorMessage('連線至伺服器時發生問題，請重新整理頁面再試一次。');
        setPhase('entry');
      }
    }

    bootstrap();

    return () => {
      disposedRef.current = true;
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      if (wsRef.current) {
        wsRef.current.onclose = null;
        wsRef.current.close();
      }
    };
  }, [connectSocket]);

  const enterAsFriend = useCallback(
    async (nickname: string) => {
      const cleanName = nickname.trim().slice(0, 24);
      if (!cleanName || isEntering) return;

      setIsEntering(true);
      setErrorMessage(null);
      saveDisplayName(cleanName);

      const session: SessionAuth = { name: cleanName, hostKey: '' };
      saveSessionAuth(session);
      activeSessionRef.current = session;
      setPhase('joined');
      connectSocket(cleanName, '');
      setIsEntering(false);
    },
    [connectSocket, isEntering],
  );

  const enterAsHost = useCallback(
    async (nickname: string, password: string) => {
      const cleanName = nickname.trim().slice(0, 24);
      const cleanPassword = password.trim();
      if (!cleanName || !cleanPassword || isEntering) return;

      setIsEntering(true);
      setErrorMessage(null);

      try {
        const res = await fetch('/api/room/host-auth', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: cleanPassword }),
        });

        const data = (await res.json()) as { hostKey?: string; error?: string };
        if (!res.ok || !data.hostKey) {
          setErrorMessage(data.error || '房主密碼驗證失敗');
          // Refresh roomStatus so UI reflects if host password is already set
          try {
            const st = await fetch('/api/room/status');
            if (st.ok) setRoomStatus((await st.json()) as RoomStatusResponse);
          } catch {
            // Ignore
          }
          return;
        }

        saveDisplayName(cleanName);
        const session: SessionAuth = { name: cleanName, hostKey: data.hostKey };
        saveSessionAuth(session);
        activeSessionRef.current = session;
        setPhase('joined');
        connectSocket(cleanName, data.hostKey);
      } catch {
        setErrorMessage('無法連線至伺服器驗證房主身份，請稍後再試。');
      } finally {
        setIsEntering(false);
      }
    },
    [connectSocket, isEntering],
  );

  const returnToEntry = useCallback(async () => {
    clearSessionAuth();
    activeSessionRef.current = null;
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }
    try {
      const st = await fetch('/api/room/status');
      if (st.ok) setRoomStatus((await st.json()) as RoomStatusResponse);
    } catch {
      // Ignore
    }
    setPhase('entry');
  }, []);

  const sendMessage = useCallback((message: ClientMessage) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      setErrorMessage('目前尚未連線至同步伺服器，請稍候再試。');
      return;
    }
    ws.send(JSON.stringify(message));
  }, []);

  const addTrack = useCallback(
    (
      track: {
        id: string;
        provider: import('../types/room').MediaProvider;
        sourceUrl: string;
        mediaId: string;
        title: string;
        author: string;
        thumbnailUrl: string;
      },
      playImmediately = false,
    ) => {
      sendMessage({ type: 'track:add', track, playImmediately });
    },
    [sendMessage],
  );

  const switchTrack = useCallback(
    (trackId: string) => sendMessage({ type: 'track:switch', trackId }),
    [sendMessage],
  );

  const removeTrack = useCallback(
    (trackId: string) => sendMessage({ type: 'track:remove', trackId }),
    [sendMessage],
  );

  const clearQueue = useCallback(() => sendMessage({ type: 'queue:clear' }), [sendMessage]);

  const play = useCallback(
    (positionSeconds?: number) => sendMessage({ type: 'playback:play', positionSeconds }),
    [sendMessage],
  );

  const pause = useCallback(
    (positionSeconds?: number) => sendMessage({ type: 'playback:pause', positionSeconds }),
    [sendMessage],
  );

  const seek = useCallback(
    (positionSeconds: number) => sendMessage({ type: 'playback:seek', positionSeconds }),
    [sendMessage],
  );

  const next = useCallback(() => sendMessage({ type: 'playback:next' }), [sendMessage]);
  const prev = useCallback(() => sendMessage({ type: 'playback:prev' }), [sendMessage]);

  const notifyEnded = useCallback(
    (trackId: string) => sendMessage({ type: 'playback:ended', trackId }),
    [sendMessage],
  );

  const renameSelf = useCallback(
    (name: string) => {
      const trimmed = name.trim().slice(0, 24);
      if (!trimmed) return;
      saveDisplayName(trimmed);
      if (activeSessionRef.current) {
        activeSessionRef.current.name = trimmed;
        saveSessionAuth(activeSessionRef.current);
      }
      sendMessage({ type: 'participant:rename', name: trimmed });
    },
    [sendMessage],
  );

  const requestSync = useCallback(() => sendMessage({ type: 'sync:request' }), [sendMessage]);

  return {
    phase,
    roomStatus,
    isEntering,
    roomId,
    role,
    participantId,
    participants,
    queue,
    playback,
    serverTimeOffset,
    connectionStatus,
    errorMessage,
    clearError,
    enterAsFriend,
    enterAsHost,
    returnToEntry,
    addTrack,
    switchTrack,
    removeTrack,
    clearQueue,
    play,
    pause,
    seek,
    next,
    prev,
    notifyEnded,
    renameSelf,
    requestSync,
  };
}
