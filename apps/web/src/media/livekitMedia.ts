import type { PeerAudio, ProximityMediaProvider } from './proximityMedia';

export class LiveKitMediaProvider implements ProximityMediaProvider {
  readonly kind = 'livekit';
  readonly notice = 'Audio y vídeo de proximidad con LiveKit.';
  mic = true;
  cam = false;
  private room: { disconnect: () => void; localParticipant: { setMicrophoneEnabled: (on: boolean) => Promise<void>; setCameraEnabled: (on: boolean) => Promise<void> }; remoteParticipants: Map<string, { audioTrackPublications: Map<string, { setSubscribed: (on: boolean) => void; track?: { setVolume?: (v: number) => void } }> }> } | null = null;

  constructor(private tokenUrl = '/api/medios/token') {}

  async connect(selfId: string) {
    const { Room } = await import('livekit-client');
    const creds = await fetch(this.tokenUrl, { method: 'POST', headers: { 'X-HIVEX-Token': localStorage.getItem('hivex_token') || '' } }).then((res) => res.json());
    const room = new Room();
    await room.connect(creds.url, creds.token);
    await room.localParticipant.setMicrophoneEnabled(true);
    this.room = room as unknown as NonNullable<LiveKitMediaProvider['room']>;
    void selfId;
  }

  updatePeers(peers: PeerAudio[]) {
    const near = new Map(peers.map((peer) => [peer.id, peer.volume]));
    if (!this.room) return;
    for (const [id, participant] of this.room.remoteParticipants) {
      const volume = near.get(id) ?? 0;
      participant.audioTrackPublications.forEach((pub) => {
        pub.setSubscribed(volume > 0);
        pub.track?.setVolume?.(volume);
      });
    }
  }

  setMicEnabled(on: boolean) {
    this.mic = on;
    void this.room?.localParticipant.setMicrophoneEnabled(on);
  }

  setCameraEnabled(on: boolean) {
    this.cam = on;
    void this.room?.localParticipant.setCameraEnabled(on);
  }

  disconnect() {
    this.room?.disconnect();
    this.room = null;
  }
}
