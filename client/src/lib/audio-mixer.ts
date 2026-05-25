type SourceEntry = {
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  dispose: () => void;
};

export class AudioMixer {
  private ctx: AudioContext;
  private destination: MediaStreamAudioDestinationNode;
  private sources: Map<string, SourceEntry> = new Map();
  private _closed = false;

  constructor() {
    this.ctx = new AudioContext();
    this.destination = this.ctx.createMediaStreamDestination();
  }

  addTrack(label: string, track: MediaStreamTrack): void {
    if (this._closed || this.sources.has(label)) return;

    const onTrackEnded = () => this.removeTrack(label);
    track.addEventListener("ended", onTrackEnded, { once: true });

    const source = this.ctx.createMediaStreamSource(new MediaStream([track]));
    const gain = this.ctx.createGain();
    source.connect(gain);
    gain.connect(this.destination);

    this.sources.set(label, {
      source,
      gain,
      dispose: () => {
        track.removeEventListener("ended", onTrackEnded);
        source.disconnect();
        gain.disconnect();
      },
    });

    this.resume();
  }

  removeTrack(label: string): void {
    const entry = this.sources.get(label);
    if (!entry) return;
    entry.dispose();
    this.sources.delete(label);
  }

  get outputStream(): MediaStream {
    return this.destination.stream;
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

  isClosed(): boolean {
    return this._closed;
  }

  private resume(): void {
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
  }

  close(): void {
    if (this._closed) return;
    this._closed = true;
    this.sources.forEach((entry) => entry.dispose());
    this.sources.clear();
    this.ctx.close().catch(() => {});
  }
}
