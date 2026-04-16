import { useEffect, useRef, useState, useCallback } from "react";
import { onWsMessage, sendWs } from "@/lib/ws-bus";

const STUN_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const VIDEO_CONSTRAINTS: MediaTrackConstraints = {
  width: { ideal: 640 },
  height: { ideal: 480 },
  frameRate: { ideal: 30 },
};

function forceH264(sdp: string): string {
  const lines = sdp.split("\r\n");
  let videoPayloads: string[] = [];
  const h264Payloads: string[] = [];

  for (const line of lines) {
    if (line.startsWith("m=video")) {
      videoPayloads = line.split(" ").slice(3);
    }
    if (line.startsWith("a=rtpmap:") && line.toLowerCase().includes("h264")) {
      const match = line.match(/a=rtpmap:(\d+)/);
      if (match) h264Payloads.push(match[1]);
    }
  }

  if (h264Payloads.length === 0) return sdp;

  const others = videoPayloads.filter((p) => !h264Payloads.includes(p));
  const newPayloads = [...h264Payloads, ...others];

  return lines
    .map((line) => {
      if (line.startsWith("m=video")) {
        const parts = line.split(" ");
        return [...parts.slice(0, 3), ...newPayloads].join(" ");
      }
      return line;
    })
    .join("\r\n");
}

async function setVideoBandwidth(pc: RTCPeerConnection) {
  for (const sender of pc.getSenders()) {
    if (sender.track?.kind !== "video") continue;
    try {
      const params = sender.getParameters();
      if (!params.encodings || params.encodings.length === 0) {
        params.encodings = [{}];
      }
      params.encodings[0].maxBitrate = 1_500_000;
      (params.encodings[0] as any).degradationPreference = "maintain-framerate";
      await sender.setParameters(params);
    } catch {}
  }
}

export function useVoice(username: string) {
  const [voiceUsers, setVoiceUsers] = useState<string[]>([]);
  const [inVoice, setInVoice] = useState(false);
  const [cameraEnabled, setCameraEnabled] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());

  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);

  const setRemoteStream = useCallback((remoteUser: string, stream: MediaStream | null) => {
    setRemoteStreams((prev) => {
      const next = new Map(prev);
      if (stream) next.set(remoteUser, stream);
      else next.delete(remoteUser);
      return next;
    });
  }, []);

  const cleanupPeer = useCallback(
    (remoteUser: string) => {
      const pc = peersRef.current.get(remoteUser);
      if (pc) {
        pc.close();
        peersRef.current.delete(remoteUser);
      }
      setRemoteStream(remoteUser, null);
    },
    [setRemoteStream]
  );

  const createPeer = useCallback(
    (remoteUser: string, initiator: boolean): RTCPeerConnection => {
      const existing = peersRef.current.get(remoteUser);
      if (existing) {
        existing.close();
        peersRef.current.delete(remoteUser);
      }

      const pc = new RTCPeerConnection(STUN_CONFIG);
      peersRef.current.set(remoteUser, pc);

      localStreamRef.current?.getTracks().forEach((track) => {
        if (track.kind === "video") {
          track.contentHint = "motion";
        }
        pc.addTrack(track, localStreamRef.current!);
      });

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          sendWs({ type: "voice_signal", to: remoteUser, from: username, data: { candidate: e.candidate } });
        }
      };

      pc.ontrack = (e) => {
        if (e.streams[0]) setRemoteStream(remoteUser, e.streams[0]);
      };

      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          setVideoBandwidth(pc);
        }
      };

      if (initiator) {
        pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true }).then(async (offer) => {
          const mungedSdp = forceH264(offer.sdp ?? "");
          const mungedOffer = { type: offer.type, sdp: mungedSdp };
          await pc.setLocalDescription(mungedOffer as RTCSessionDescriptionInit);
          sendWs({ type: "voice_signal", to: remoteUser, from: username, data: { offer: mungedOffer } });
        });
      }

      return pc;
    },
    [username, setRemoteStream]
  );

  useEffect(() => {
    const unsubs: Array<() => void> = [];

    unsubs.push(
      onWsMessage("voice_users", ({ users }: { users: string[] }) => {
        setVoiceUsers(users);
      })
    );

    unsubs.push(
      onWsMessage("voice_new_peer", ({ username: newUser }: { username: string }) => {
        if (!localStreamRef.current || newUser === username) return;
        createPeer(newUser, true);
      })
    );

    unsubs.push(
      onWsMessage("voice_signal", async ({ from, data }: { from: string; data: any }) => {
        if (from === username || !localStreamRef.current) return;

        let pc = peersRef.current.get(from);

        if (data.offer) {
          if (!pc) pc = createPeer(from, false);
          await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
          const answer = await pc.createAnswer();
          const mungedSdp = forceH264(answer.sdp ?? "");
          const mungedAnswer = { type: answer.type, sdp: mungedSdp };
          await pc.setLocalDescription(mungedAnswer as RTCSessionDescriptionInit);
          sendWs({ type: "voice_signal", to: from, from: username, data: { answer: mungedAnswer } });
        } else if (data.answer) {
          await pc?.setRemoteDescription(new RTCSessionDescription(data.answer));
        } else if (data.candidate) {
          try {
            await pc?.addIceCandidate(new RTCIceCandidate(data.candidate));
          } catch {}
        }
      })
    );

    unsubs.push(
      onWsMessage("voice_peer_left", ({ username: leftUser }: { username: string }) => {
        cleanupPeer(leftUser);
      })
    );

    return () => unsubs.forEach((u) => u());
  }, [username, createPeer, cleanupPeer]);

  const joinVoice = useCallback(
    async (withCamera: boolean) => {
      try {
        const constraints: MediaStreamConstraints = {
          audio: true,
          video: withCamera ? VIDEO_CONSTRAINTS : false,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        localStreamRef.current = stream;
        setLocalStream(stream);
        setCameraEnabled(withCamera);
        sendWs({ type: "voice_join" });
        setInVoice(true);
        setMicError(null);
      } catch {
        setMicError("Could not access microphone. Please allow mic permission and try again.");
      }
    },
    []
  );

  const leaveVoice = useCallback(() => {
    peersRef.current.forEach((_, remoteUser) => cleanupPeer(remoteUser));
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setRemoteStreams(new Map());
    sendWs({ type: "voice_leave" });
    setInVoice(false);
    setCameraEnabled(false);
  }, [cleanupPeer]);

  const toggleCamera = useCallback(async () => {
    if (!localStreamRef.current || !inVoice) return;
    const videoTracks = localStreamRef.current.getVideoTracks();

    if (cameraEnabled) {
      videoTracks.forEach((t) => {
        t.stop();
        localStreamRef.current!.removeTrack(t);
      });
      peersRef.current.forEach((pc) => {
        pc.getSenders()
          .filter((s) => s.track?.kind === "video")
          .forEach((s) => pc.removeTrack(s));
      });
      setLocalStream(new MediaStream(localStreamRef.current.getAudioTracks()));
      setCameraEnabled(false);
    } else {
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
        const videoTrack = videoStream.getVideoTracks()[0];
        videoTrack.contentHint = "motion";
        localStreamRef.current.addTrack(videoTrack);
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
        peersRef.current.forEach((pc) => {
          pc.addTrack(videoTrack, localStreamRef.current!);
        });
        setCameraEnabled(true);
      } catch {
        setMicError("Could not access camera.");
      }
    }
  }, [cameraEnabled, inVoice]);

  return {
    voiceUsers,
    inVoice,
    cameraEnabled,
    micError,
    localStream,
    remoteStreams,
    joinVoice,
    leaveVoice,
    toggleCamera,
  };
}
