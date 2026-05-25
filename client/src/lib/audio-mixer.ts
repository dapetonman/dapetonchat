export class AudioMixer {
  private ctx: AudioContext;
  private destination: MediaStreamAudioDestinationNode;
  private sources: Map<string, { source: MediaStreamAudioSourceNode; gain: GainNode }> = new Map();

  constructor() {
    this.ctx = new AudioContext();
    this.destination = this.ctx.createMediaStreamDestination();
  }

  addTrack(label: string, track: MediaStreamTrack): void {
    if (this.sources.has(label)) return;
    const source = this.ctx.createMediaStreamSource(new MediaStream([track]));
    const gain = this.ctx.createGain();
    source.connect(gain);
    gain.connect(this.destination);
    this.sources.set(label, { source, gain });
    this.resume();
  }

  removeTrack(label: string): void {
    const entry = this.sources.get(label);
    if (!entry) return;
    entry.source.disconnect();
    entry.gain.disconnect();
    this.sources.delete(label);
  }

  getMixedStream(): MediaStream {
    return this.destination.stream;
  }

  hasTrack(label: string): boolean {
    return this.sources.has(label);
  }

  getTrackLabels(): string[] {
    return Array.from(this.sources.keys());
  }

  private resume(): void {
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  close(): void {
    this.sources.forEach((entry) => {
      entry.source.disconnect();
      entry.gain.disconnect();
    });
    this.sources.clear();
    this.ctx.close().catch(() => {});
  }
}
