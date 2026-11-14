import crypto from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { createServer as createViteServer } from 'vite';
import { WebSocketServer, WebSocket } from 'ws';
import type {
  ClientMessage,
  Participant,
  PlaybackState,
  Role,
  RoomSnapshot,
  ServerMessage,
  Track,
} from './src/types/room.ts';

const PORT = Number(process.env.PORT || 3000);
const ENV_HOST_PASSWORD = (process.env.HOST_PASSWORD || '').trim();

interface ConnectedClient {
  ws: WebSocket;
  participant: Participant;
}

interface ServerRoom {
  roomId: string;
  hostKey: string;
  hostPassword: string | null;
  queue: Track[];
  playback: PlaybackState;
  clients: Map<string, ConnectedClient>;
}

function generateToken(bytes = 12): string {
  return crypto.randomBytes(bytes).toString('base64url');
}

const sharedRoom: ServerRoom = {
  roomId: 'main',
  hostKey: generateToken(18),
  hostPassword: ENV_HOST_PASSWORD || null,
  queue: [],
  playback: {
    currentTrack: null,
    isPlaying: false,
    positionSeconds: 0,
    updatedAt: Date.now(),
  },
  clients: new Map(),
};

function getEffectivePosition(playback: PlaybackState, now = Date.now()): number {
  if (!playback.currentTrack) return 0;
  if (!playback.isPlaying) return playback.positionSeconds;
  const elapsed = Math.max(0, (now - playback.updatedAt) / 1000);
  return playback.positionSeconds + elapsed;
}

function sendJson(ws: WebSocket, payload: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function broadcastState(room: ServerRoom) {
  const payload: ServerMessage = {
    type: 'room:state',
    queue: room.queue,
    playback: room.playback,
    serverTime: Date.now(),
  };
  for (const client of room.clients.values()) {
    sendJson(client.ws, payload);
  }
}

function broadcastParticipants(room: ServerRoom) {
  const participants = Array.from(room.clients.values()).map((c) => c.participant);
  const payload: ServerMessage = {
    type: 'room:participants',
    participants,
  };
  for (const client of room.clients.values()) {
    sendJson(client.ws, payload);
  }
}

/**
 * Advance to the next song in the persistent playlist without removing played songs.
 * When wrapOnEnd is false (e.g. automatic track end), stops cleanly after the final song.
 */
function advanceToNextTrack(room: ServerRoom, wrapOnEnd = false) {
  const now = Date.now();
  if (room.queue.length === 0) {
    room.playback = {
      currentTrack: null,
      isPlaying: false,
      positionSeconds: 0,
      updatedAt: now,
    };
    return;
  }

  const currentId = room.playback.currentTrack?.id;
  const currentIdx = currentId ? room.queue.findIndex((t) => t.id === currentId) : -1;

  let nextTrack: Track | null = null;
  if (currentIdx === -1) {
    nextTrack = room.queue[0];
  } else if (currentIdx + 1 < room.queue.length) {
    nextTrack = room.queue[currentIdx + 1];
  } else if (wrapOnEnd) {
    nextTrack = room.queue[0];
  }

  if (nextTrack) {
    room.playback = {
      currentTrack: nextTrack,
      isPlaying: true,
      positionSeconds: 0,
      updatedAt: now,
    };
  } else {
    room.playback = {
      currentTrack: room.playback.currentTrack,
      isPlaying: false,
      positionSeconds: 0,
      updatedAt: now,
    };
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // Prevent search engines from indexing any route
  app.use((_req, res, next) => {
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    next();
  });

  // Shared room status for entry screen
  app.get('/api/room/status', (_req, res) => {
    res.json({
      participantCount: sharedRoom.clients.size,
      hasHostPassword: Boolean(sharedRoom.hostPassword),
    });
  });

  // Verify or initialize host password to receive hostKey
  app.post('/api/room/host-auth', (req, res) => {
    const rawPassword = typeof req.body?.password === 'string' ? req.body.password.trim() : '';
    if (!rawPassword) {
      res.status(400).json({ error: '請輸入房主密碼' });
      return;
    }

    if (!sharedRoom.hostPassword) {
      sharedRoom.hostPassword = rawPassword;
      res.json({ hostKey: sharedRoom.hostKey });
      return;
    }

    if (rawPassword !== sharedRoom.hostPassword) {
      res.status(401).json({ error: '房主密碼不正確，請重新輸入或以朋友身份加入。' });
      return;
    }

    res.json({ hostKey: sharedRoom.hostKey });
  });

  // Fetch YouTube video title & channel via oEmbed safely on server
  app.get('/api/youtube-meta', async (req, res) => {
    const videoId = typeof req.query.videoId === 'string' ? req.query.videoId.trim() : '';
    if (!/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
      res.status(400).json({ error: 'Invalid YouTube video ID' });
      return;
    }

    const fallback = {
      videoId,
      title: `YouTube 影片 (${videoId})`,
      author: 'YouTube',
      thumbnailUrl: `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
    };

    try {
      const target = `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`,
      )}&format=json`;
      const response = await fetch(target, { signal: AbortSignal.timeout(4500) });
      if (!response.ok) {
        res.json(fallback);
        return;
      }
      const data = (await response.json()) as {
        title?: string;
        author_name?: string;
        thumbnail_url?: string;
      };
      res.json({
        videoId,
        title: data.title || fallback.title,
        author: data.author_name || fallback.author,
        thumbnailUrl: data.thumbnail_url || fallback.thumbnailUrl,
      });
    } catch {
      res.json(fallback);
    }
  });

  const server = http.createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const hostKey = url.searchParams.get('hostKey') || '';
    const rawName = (url.searchParams.get('name') || '').trim().slice(0, 24);

    const room = sharedRoom;
    const role: Role = hostKey && hostKey === room.hostKey ? 'host' : 'friend';

    const participantId = generateToken(6);
    const friendIndex =
      Array.from(room.clients.values()).filter((c) => c.participant.role === 'friend').length + 1;
    const participant: Participant = {
      id: participantId,
      name: rawName || (role === 'host' ? '房主' : `朋友 ${friendIndex}`),
      role,
      joinedAt: Date.now(),
    };

    room.clients.set(participantId, { ws, participant });

    const snapshot: RoomSnapshot = {
      roomId: room.roomId,
      role,
      participantId,
      participants: Array.from(room.clients.values()).map((c) => c.participant),
      queue: room.queue,
      playback: room.playback,
      serverTime: Date.now(),
    };

    sendJson(ws, { type: 'room:init', snapshot });
    broadcastParticipants(room);

    ws.on('message', (raw) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString()) as ClientMessage;
      } catch {
        return;
      }

      const clientEntry = room.clients.get(participantId);
      if (!clientEntry) return;
      const isHost = clientEntry.participant.role === 'host';
      const now = Date.now();

      switch (msg.type) {
        case 'sync:request': {
          sendJson(ws, {
            type: 'room:state',
            queue: room.queue,
            playback: room.playback,
            serverTime: now,
          });
          break;
        }

        case 'participant:rename': {
          const cleanName = msg.name.trim().slice(0, 24);
          if (cleanName) {
            const oldName = clientEntry.participant.name;
            clientEntry.participant.name = cleanName;
            for (const t of room.queue) {
              if (t.addedBy === oldName) {
                t.addedBy = cleanName;
              }
            }
            if (room.playback.currentTrack && room.playback.currentTrack.addedBy === oldName) {
              room.playback.currentTrack.addedBy = cleanName;
            }
            broadcastParticipants(room);
            broadcastState(room);
          }
          break;
        }

        case 'track:add': {
          const videoId = msg.track?.videoId?.trim();
          if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) {
            sendJson(ws, { type: 'error', code: 'INVALID_URL', message: '無效的 YouTube 影片連結' });
            return;
          }

          const exists = room.queue.some((t) => t.id === msg.track.id);
          if (exists) return;

          const newTrack: Track = {
            id: msg.track.id || generateToken(6),
            videoId,
            title: (msg.track.title || `YouTube 影片 (${videoId})`).slice(0, 140),
            author: (msg.track.author || 'YouTube').slice(0, 80),
            thumbnailUrl: msg.track.thumbnailUrl || `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
            addedBy: clientEntry.participant.name,
            addedByRole: clientEntry.participant.role,
            addedAt: now,
          };

          if (msg.playImmediately && !isHost) {
            sendJson(ws, {
              type: 'error',
              code: 'FORBIDDEN',
              message: '只有房主可以立即切換歌曲，你的歌曲請加入播放清單。',
            });
            return;
          }

          room.queue.push(newTrack);

          if (msg.playImmediately || (!room.playback.currentTrack && isHost)) {
            room.playback = {
              currentTrack: newTrack,
              isPlaying: true,
              positionSeconds: 0,
              updatedAt: now,
            };
          }

          broadcastState(room);
          break;
        }

        case 'track:switch': {
          if (!isHost) {
            sendJson(ws, { type: 'error', code: 'FORBIDDEN', message: '只有房主可以切換目前播放的歌曲。' });
            return;
          }
          const selected = room.queue.find((t) => t.id === msg.trackId);
          if (!selected) return;
          room.playback = {
            currentTrack: selected,
            isPlaying: true,
            positionSeconds: 0,
            updatedAt: now,
          };
          broadcastState(room);
          break;
        }

        case 'track:remove': {
          if (!isHost) {
            sendJson(ws, { type: 'error', code: 'FORBIDDEN', message: '只有房主可以從播放清單移除歌曲。' });
            return;
          }
          const removeIdx = room.queue.findIndex((t) => t.id === msg.trackId);
          if (removeIdx === -1) return;
          const wasCurrent = room.playback.currentTrack?.id === msg.trackId;
          room.queue.splice(removeIdx, 1);

          if (wasCurrent) {
            const replacement = room.queue[removeIdx] ?? room.queue[0] ?? null;
            room.playback = {
              currentTrack: replacement,
              isPlaying: Boolean(replacement && room.playback.isPlaying),
              positionSeconds: 0,
              updatedAt: now,
            };
          }

          broadcastState(room);
          break;
        }

        case 'queue:clear': {
          if (!isHost) {
            sendJson(ws, { type: 'error', code: 'FORBIDDEN', message: '只有房主可以清空播放清單。' });
            return;
          }
          room.queue = [];
          room.playback = {
            currentTrack: null,
            isPlaying: false,
            positionSeconds: 0,
            updatedAt: now,
          };
          broadcastState(room);
          break;
        }

        case 'playback:play': {
          if (!isHost) {
            sendJson(ws, { type: 'error', code: 'FORBIDDEN', message: '只有房主可以控制播放與暫停。' });
            return;
          }
          if (!room.playback.currentTrack && room.queue.length > 0) {
            advanceToNextTrack(room, true);
          } else if (room.playback.currentTrack) {
            room.playback = {
              currentTrack: room.playback.currentTrack,
              isPlaying: true,
              positionSeconds:
                typeof msg.positionSeconds === 'number'
                  ? Math.max(0, msg.positionSeconds)
                  : getEffectivePosition(room.playback, now),
              updatedAt: now,
            };
          }
          broadcastState(room);
          break;
        }

        case 'playback:pause': {
          if (!isHost) {
            sendJson(ws, { type: 'error', code: 'FORBIDDEN', message: '只有房主可以控制播放與暫停。' });
            return;
          }
          if (!room.playback.currentTrack) return;
          room.playback = {
            currentTrack: room.playback.currentTrack,
            isPlaying: false,
            positionSeconds:
              typeof msg.positionSeconds === 'number'
                ? Math.max(0, msg.positionSeconds)
                : getEffectivePosition(room.playback, now),
            updatedAt: now,
          };
          broadcastState(room);
          break;
        }

        case 'playback:seek': {
          if (!isHost) {
            sendJson(ws, { type: 'error', code: 'FORBIDDEN', message: '只有房主可以調整播放進度。' });
            return;
          }
          if (!room.playback.currentTrack) return;
          room.playback = {
            currentTrack: room.playback.currentTrack,
            isPlaying: room.playback.isPlaying,
            positionSeconds: Math.max(0, msg.positionSeconds),
            updatedAt: now,
          };
          broadcastState(room);
          break;
        }

        case 'playback:next': {
          if (!isHost) {
            sendJson(ws, { type: 'error', code: 'FORBIDDEN', message: '只有房主可以切換下一首歌曲。' });
            return;
          }
          advanceToNextTrack(room, true);
          broadcastState(room);
          break;
        }

        case 'playback:prev': {
          if (!isHost) {
            sendJson(ws, { type: 'error', code: 'FORBIDDEN', message: '只有房主可以切換上一首歌曲。' });
            return;
          }
          if (room.queue.length === 0) return;
          const currentId = room.playback.currentTrack?.id;
          const currentIdx = currentId ? room.queue.findIndex((t) => t.id === currentId) : -1;
          const prevTrack =
            currentIdx > 0
              ? room.queue[currentIdx - 1]
              : currentIdx === 0
                ? room.queue[0]
                : room.queue[0];

          room.playback = {
            currentTrack: prevTrack,
            isPlaying: true,
            positionSeconds: 0,
            updatedAt: now,
          };
          broadcastState(room);
          break;
        }

        case 'playback:ended': {
          if (!isHost) return;
          if (room.playback.currentTrack?.id === msg.trackId) {
            advanceToNextTrack(room, false);
            broadcastState(room);
          }
          break;
        }
      }
    });

    ws.on('close', () => {
      room.clients.delete(participantId);
      broadcastParticipants(room);
    });
  });

  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Private listen room server running at http://0.0.0.0:${PORT}`);
  });
}

startServer();
