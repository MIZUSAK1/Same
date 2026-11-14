import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  ClientMessage,
  Participant,
  PlaybackState,
  Role,
  RoomSnapshot,
  ServerMessage,
  Track,
} from '../types/room';

export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'error';
export type RoomPhase = 'checking' | 'entry' | 'joined' | 'error';

const HOST_KEYS_STORAGE = 'private_listen_room_host_keys_v1';
const USER_NAME_STORAGE = 'private_listen_room_display_name_v1';
const SESSION_ENTERED_ROOM = 'private_listen_room_entered_room_v1';

function loadHostKey(roomId: string): string {
  try {
    const raw = localStorage.getItem(HOST_KEYS_STORAGE);
    if (!raw) return '';
    const map = JSON.parse(raw) as Record<string, string>;
    return map[roomId] || '';
  } catch {
    return '';
  }
}

function saveHostKey(roomId: string, hostKey: string) {
  try {
    const raw = localStorage.getItem(HOST_KEYS_STORAGE);
    const map = raw ? (JSON.parse(raw) as Record<string, string>) : {};
    map[roomId] = hostKey;
    localStorage.setItem(HOST_KEYS_STORAGE, JSON.stringify(map));
  } catch {
    // Ignore storage errors in restricted environments
  }
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

function getSessionEnteredRoom(): string {
  try {
    return sessionStorage.getItem(SESSION_ENTERED_ROOM) || '';
  } catch {
    return '';
  }
}

function setSessionEnteredRoom(roomId: string) {
  try {
    sessionStorage.setItem(SESSION_ENTERED_ROOM, roomId);
  } catch {
    // Ignore storage errors
  }
}

export interface RoomPreviewStatus {
  exists: boolean;
  participantCount: number;
}

export function useListenRoom() {
  const [phase, setPhase] = useState<RoomPhase>('checking');
  const [pendingRoomId, setPendingRoomId] = useState<string | null>(null);
  const [roomPreview, setRoomPreview] = useState<RoomPreviewStatus | null>(null);
  const [isEntering, setIsEntering] = useState(false);

  const [roomId, setRoomId] = useState<string | null>(null);
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
  const activeRoomRef = useRef<{ roomId: string; hostKey: string; name: string } | null>(null);
  const disposedRef = useRef(false);

  const clearError = useCallback(() => {
    setErrorMessage(null);
  }, []);

  const createAndEnterRoom = useCallback(async () => {
    const res = await fetch('/api/rooms', { method: 'POST' });
    if (!res.ok) {
      throw new Error('無法建立私密房間');
    }
    const data = (await res.json()) as {
      roomId: string;
      hostKey: string;
    };
    saveHostKey(data.roomId, data.hostKey);
    const nextUrl = `${window.location.pathname}?room=${encodeURIComponent(data.roomId)}`;
    window.history.replaceState(null, '', nextUrl);
    return { roomId: data.roomId, hostKey: data.hostKey };
  }, []);

  const connectSocket = useCallback((targetRoomId: string, targetHostKey: string, displayName: string) => {
    if (disposedRef.current) return;
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    setConnectionStatus('connecting');
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const params = new URLSearchParams({
      roomId: targetRoomId,
      name: displayName,
      ...(targetHostKey ? { hostKey: targetHostKey } : {}),
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
        setServerTimeOffset(msg.snapshot.serverTime - Date.now());
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
        if (msg.code === 'ROOM_NOT_FOUND' || msg.code === 'ROOM_FULL') {
          setConnectionStatus('error');
          setPhase('error');
        }
      }
    };

    ws.onclose = () => {
      if (disposedRef.current) return;
      wsRef.current = null;
      setConnectionStatus((prev) => (prev === 'error' ? 'error' : 'reconnecting'));
      if (reconnectTimerRef.current) window.clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = window.setTimeout(() => {
        const current = activeRoomRef.current;
        if (current && !disposedRef.current) {
          connectSocket(current.roomId, current.hostKey, current.name);
        }
      }, 2000);
    };
  }, []);

  useEffect(() => {
    disposedRef.current = false;

    async function bootstrap() {
      const search = new URLSearchParams(window.location.search);
      const urlRoomId = search.get('room')?.trim() || '';
      const savedName = loadSavedDisplayName().trim();
      const sessionRoom = getSessionEnteredRoom();

      try {
        if (urlRoomId) {
          const statusRes = await fetch(`/api/rooms/${encodeURIComponent(urlRoomId)}/status`);
          const storedHostKey = loadHostKey(urlRoomId);

          if (statusRes.ok) {
            const status = (await statusRes.json()) as RoomPreviewStatus;
            setPendingRoomId(urlRoomId);
            setRoomPreview(status);

            // Auto-rejoin only if user already entered this room in the current tab session
            if (sessionRoom === urlRoomId && savedName) {
              activeRoomRef.current = { roomId: urlRoomId, hostKey: storedHostKey, name: savedName };
              setRoomId(urlRoomId);
              setPhase('joined');
              connectSocket(urlRoomId, storedHostKey, savedName);
              return;
            }

            setPhase('entry');
            return;
          }

          if (storedHostKey) {
            // Host's previous room expired after server restart: prompt to create fresh room
            window.history.replaceState(null, '', window.location.pathname);
            setPendingRoomId(null);
            setRoomPreview(null);
            setPhase('entry');
            return;
          }

          setErrorMessage('找不到這個私密點歌室，可能房間已關閉或連結有誤。');
          setConnectionStatus('error');
          setPhase('error');
          return;
        }

        // No room query param: Host entry to create a new private room
        setPendingRoomId(null);
        setRoomPreview(null);
        setPhase('entry');
      } catch {
        setErrorMessage('連線至伺服器時發生問題，請重新整理頁面再試一次。');
        setConnectionStatus('error');
        setPhase('error');
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

  const enterRoom = useCallback(
    async (nickname: string) => {
      const cleanName = nickname.trim().slice(0, 24);
      if (!cleanName || isEntering) return;

      setIsEntering(true);
      setErrorMessage(null);
      saveDisplayName(cleanName);

      try {
        if (pendingRoomId) {
          const hostKey = loadHostKey(pendingRoomId);
          setSessionEnteredRoom(pendingRoomId);
          activeRoomRef.current = { roomId: pendingRoomId, hostKey, name: cleanName };
          setRoomId(pendingRoomId);
          setPhase('joined');
          connectSocket(pendingRoomId, hostKey, cleanName);
        } else {
          const fresh = await createAndEnterRoom();
          setSessionEnteredRoom(fresh.roomId);
          activeRoomRef.current = { roomId: fresh.roomId, hostKey: fresh.hostKey, name: cleanName };
          setRoomId(fresh.roomId);
          setPhase('joined');
          connectSocket(fresh.roomId, fresh.hostKey, cleanName);
        }
      } catch {
        setErrorMessage('進入房間失敗，請稍後再試一次。');
        setPhase('entry');
      } finally {
        setIsEntering(false);
      }
    },
    [connectSocket, createAndEnterRoom, isEntering, pendingRoomId],
  );

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
      track: { id: string; videoId: string; title: string; author: string; thumbnailUrl: string },
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
      if (activeRoomRef.current) {
        activeRoomRef.current.name = trimmed;
      }
      sendMessage({ type: 'participant:rename', name: trimmed });
    },
    [sendMessage],
  );

  const requestSync = useCallback(() => sendMessage({ type: 'sync:request' }), [sendMessage]);

  const handleCreateOwnRoom = useCallback(async () => {
    window.history.replaceState(null, '', window.location.pathname);
    setPendingRoomId(null);
    setRoomPreview(null);
    setErrorMessage(null);
    setPhase('entry');
  }, []);

  return {
    phase,
    pendingRoomId,
    roomPreview,
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
    enterRoom,
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
    createOwnRoom: handleCreateOwnRoom,
  };
}
