import type { Socket } from 'socket.io-client';
import type { PeerAudio, ProximityMediaProvider } from './proximityMedia';

interface Signal { from: string; data: { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit } }

/** Audio directo entre navegadores cuando no hay LiveKit. */
export class P2PMediaProvider implements ProximityMediaProvider {
  readonly kind = 'p2p';
  notice = 'Audio de proximidad en modo directo entre navegadores. Para varias personas a la vez, configura LIVEKIT_URL, LIVEKIT_API_KEY y LIVEKIT_API_SECRET.';
  mic = false;
  cam = false;
  private opening: Promise<void> | null = null;
  private pcs = new Map<string, RTCPeerConnection>();
  private audios = new Map<string, HTMLAudioElement>();
  private local: MediaStream | null = null;

  constructor(private socket: Socket, private selfId: string) {}

  async connect() {
    this.socket.on('webrtc:signal', (msg: Signal) => { void this.onSignal(msg); });
    this.mic = false;
    this.notice = 'El micrófono está apagado. Actívalo cuando quieras hablar con quien tengas cerca.';
  }

  updatePeers(peers: PeerAudio[]) {
    const wanted = new Set(peers.map((peer) => peer.id));
    for (const id of [...this.pcs.keys()]) if (!wanted.has(id)) this.drop(id);
    for (const peer of peers) {
      void this.ensure(peer.id);
      const audio = this.audios.get(peer.id);
      if (audio) audio.volume = Math.max(0, Math.min(1, peer.volume));
    }
  }

  async setMicEnabled(on: boolean) {
    if (!on) {
      this.mic = false;
      this.local?.getAudioTracks().forEach((track) => { track.enabled = false; });
      return;
    }
    if (!this.local) {
      this.opening ??= this.openMic();
      await this.opening;
      this.opening = null;
      return;
    }
    this.mic = true;
    this.local.getAudioTracks().forEach((track) => { track.enabled = true; });
  }

  private async openMic() {
    try {
      this.local = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      this.mic = true;
      this.notice = 'Audio de proximidad en modo directo entre navegadores. Para varias personas a la vez, configura LIVEKIT_URL, LIVEKIT_API_KEY y LIVEKIT_API_SECRET.';
    } catch {
      this.mic = false;
      this.local = null;
      this.notice = 'No se pudo abrir el micrófono. El audio de proximidad está desactivado en este navegador.';
    }
  }

  setCameraEnabled(on: boolean) {
    this.cam = on;
    this.notice = on
      ? 'La cámara en grupo funciona mejor con LiveKit. En modo directo solo se comparte el audio.'
      : 'Audio de proximidad en modo directo entre navegadores. Para varias personas a la vez, configura LiveKit.';
  }

  disconnect() {
    for (const id of [...this.pcs.keys()]) this.drop(id);
    this.local?.getTracks().forEach((track) => track.stop());
    this.local = null;
  }

  private async ensure(peerId: string) {
    if (this.pcs.has(peerId) || !this.local) return;
    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    this.pcs.set(peerId, pc);
    this.local.getTracks().forEach((track) => pc.addTrack(track, this.local!));
    pc.onicecandidate = (event) => {
      if (event.candidate) this.socket.emit('webrtc:signal', { to: peerId, data: { candidate: event.candidate.toJSON() } });
    };
    pc.ontrack = (event) => {
      let audio = this.audios.get(peerId);
      if (!audio) {
        audio = document.createElement('audio');
        audio.autoplay = true;
        this.audios.set(peerId, audio);
      }
      audio.srcObject = event.streams[0];
    };
    if (this.selfId < peerId) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.socket.emit('webrtc:signal', { to: peerId, data: { sdp: pc.localDescription } });
    }
  }

  private async onSignal(msg: Signal) {
    if (!msg?.from || msg.from === this.selfId) return;
    await this.ensure(msg.from);
    const pc = this.pcs.get(msg.from);
    if (!pc || !msg.data) return;
    if (msg.data.sdp) {
      await pc.setRemoteDescription(msg.data.sdp);
      if (msg.data.sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.socket.emit('webrtc:signal', { to: msg.from, data: { sdp: pc.localDescription } });
      }
    } else if (msg.data.candidate) {
      try { await pc.addIceCandidate(msg.data.candidate); } catch { /* candidato tardío */ }
    }
  }

  private drop(id: string) {
    this.pcs.get(id)?.close();
    this.pcs.delete(id);
    this.audios.get(id)?.remove();
    this.audios.delete(id);
  }
}
