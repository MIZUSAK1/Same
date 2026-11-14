export type Role = 'host' | 'friend';

export type MediaProvider =
  | 'youtube'
  | 'soundcloud'
  | 'bilibili'
  | 'twitch'
  | 'spotify'
  | 'apple_music'
  | 'kkbox';

export interface Track {
  id: string;
  provider: MediaProvider;
  sourceUrl: string;
  mediaId: string;
  title: string;
  author: string;
  thumbnailUrl: string;
  addedBy: string;
  addedByRole: Role;
  addedAt: number;
}

export interface Participant {
  id: string;
  name: string;
  role: Role;
  joinedAt: number;
}

export interface PlaybackState {
  currentTrack: Track | null;
  isPlaying: boolean;
  positionSeconds: number;
  updatedAt: number;
}

export interface RoomSnapshot {
  roomId: string;
  role: Role;
  participantId: string;
  participants: Participant[];
  queue: Track[];
  playback: PlaybackState;
  serverTime: number;
}

export interface RoomStatusResponse {
  participantCount: number;
  hasHostPassword: boolean;
}

export type ClientMessage =
  | {
      type: 'track:add';
      track: {
        id: string;
        provider: MediaProvider;
        sourceUrl: string;
        mediaId: string;
        title: string;
        author: string;
        thumbnailUrl: string;
      };
      playImmediately?: boolean;
    }
  | { type: 'track:switch'; trackId: string }
  | { type: 'track:remove'; trackId: string }
  | { type: 'queue:clear' }
  | { type: 'playback:play'; positionSeconds?: number }
  | { type: 'playback:pause'; positionSeconds?: number }
  | { type: 'playback:seek'; positionSeconds: number }
  | { type: 'playback:next' }
  | { type: 'playback:prev' }
  | { type: 'playback:ended'; trackId: string }
  | { type: 'participant:rename'; name: string }
  | { type: 'sync:request' };

export type ServerMessage =
  | { type: 'room:init'; snapshot: RoomSnapshot }
  | { type: 'room:state'; queue: Track[]; playback: PlaybackState; serverTime: number }
  | { type: 'room:participants'; participants: Participant[] }
  | { type: 'error'; code: string; message: string };
