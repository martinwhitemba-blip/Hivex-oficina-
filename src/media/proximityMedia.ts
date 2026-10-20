/**
 * Audio/vídeo por proximidad.
 *
 * El juego calcula cada frame quién está "cerca" y con qué volumen
 * (1 = pegado, 0 = en el borde del radio) y llama a `updatePeers`.
 * Aquí es donde se enchufa WebRTC: con LiveKit, por ejemplo, cada peer
 * es un participante de la sala y `volume` se aplica a su pista de audio
 * (o se suscribe/desuscribe al entrar/salir del radio).
 */
export interface PeerAudio { id: string; name: string; volume: number }

export interface ProximityMediaProvider {
  readonly kind: string;
  connect(selfId: string): Promise<void>;
  updatePeers(peers: PeerAudio[]): void;
  setMicEnabled(on: boolean): void;
  setCameraEnabled(on: boolean): void;
  disconnect(): void;
}

/** Proveedor simulado: no transmite nada, solo guarda el estado para la UI. */
export class SimulatedMediaProvider implements ProximityMediaProvider {
  readonly kind = 'simulado';
  peers: PeerAudio[] = [];
  mic = true;
  cam = false;
  private lastKey = '';
  async connect(_selfId: string) { /* sin WebRTC */ }
  updatePeers(peers: PeerAudio[]) {
    this.peers = peers;
    const key = peers.map((p) => p.id).sort().join(',');
    if (key !== this.lastKey) {
      this.lastKey = key;
      if (peers.length) console.info('[media simulado] conversación con:', peers.map((p) => p.name).join(', '));
    }
  }
  setMicEnabled(on: boolean) { this.mic = on; }
  setCameraEnabled(on: boolean) { this.cam = on; }
  disconnect() { this.peers = []; }
}

/*
 * Esqueleto con LiveKit (npm i livekit-client):
 *
 * import { Room, RemoteAudioTrack } from 'livekit-client';
 * export class LiveKitMediaProvider implements ProximityMediaProvider {
 *   readonly kind = 'livekit';
 *   private room = new Room({ adaptiveStream: true });
 *   async connect(selfId) {
 *     const token = await fetch('/api/livekit-token?identity=' + selfId).then(r => r.text());
 *     await this.room.connect(LIVEKIT_URL, token);
 *   }
 *   updatePeers(peers) {
 *     const near = new Map(peers.map(p => [p.id, p.volume]));
 *     for (const p of this.room.remoteParticipants.values()) {
 *       const v = near.get(p.identity) ?? 0;
 *       p.audioTrackPublications.forEach(pub => {
 *         pub.setSubscribed(v > 0);
 *         (pub.track as RemoteAudioTrack | undefined)?.setVolume(v);
 *       });
 *     }
 *   }
 *   setMicEnabled(on) { this.room.localParticipant.setMicrophoneEnabled(on); }
 *   setCameraEnabled(on) { this.room.localParticipant.setCameraEnabled(on); }
 *   disconnect() { this.room.disconnect(); }
 * }
 */
