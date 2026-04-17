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

const SCREEN_CONSTRAINTS: DisplayMediaStreamOptions = {
  video: { width: 1366, height: 768, frameRate: 10 } as MediaTrackConstraints,
  audio: false,
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
  const [screenSharing, setScreenSharing] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [remoteStreams, setRemoteStreams] = useState<Map<string, MediaStream>>(new Map());
  const [filePeers, setFilePeers] = useState<Map<string, RTCDataChannel>>(new Map());

  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const cameraVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const senderMapRef = useRef<Map<string, { audio?: RTCRtpSender; video?: RTCRtpSender; screen?: RTCRtpSender }>>(new Map());

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
      senderMapRef.current.delete(remoteUser);
      setRemoteStream(remoteUser, null);
    },
    [setRemoteStream]
  );

  const syncPeerTracks = useCallback((remoteUser: string) => {
    const pc = peersRef.current.get(remoteUser);
    if (!pc) return;
    const senders = senderMapRef.current.get(remoteUser) ?? {};
    const audioTrack = localStreamRef.current?.getAudioTracks()[0] ?? null;
    const cameraTrack = cameraTrackRef.current ?? null;
    const screenTrack = screenStreamRef.current?.getVideoTracks()[0] ?? null;

    if (audioTrack && !senders.audio) {
      senders.audio = pc.addTrack(audioTrack, localStreamRef.current!);
    }

    if (cameraTrack && cameraTrack.enabled && !senders.video) {
      senders.video = pc.addTrack(cameraTrack, localStreamRef.current!);
    }

    if (!cameraTrack?.enabled && senders.video) {
      pc.removeTrack(senders.video);
      delete senders.video;
    }

    if (screenTrack && !senders.screen) {
      senders.screen = pc.addTrack(screenTrack, screenStreamRef.current!);
    }

    if (!screenTrack && senders.screen) {
      pc.removeTrack(senders.screen);
      delete senders.screen;
    }

    senderMapRef.current.set(remoteUser, senders);
  }, []);

  const createPeer = useCallback(
    (remoteUser: string, initiator: boolean): RTCPeerConnection => {
      const existing = peersRef.current.get(remoteUser);
      if (existing) {
        existing.close();
        peersRef.current.delete(remoteUser);
      }

      const pc = new RTCPeerConnection(STUN_CONFIG);
      peersRef.current.set(remoteUser, pc);
      senderMapRef.current.set(remoteUser, {});
      syncPeerTracks(remoteUser);

      const fileChannel = pc.createDataChannel("file");
      fileChannel.onopen = () => {
        setFilePeers((prev) => {
          const next = new Map(prev);
          next.set(remoteUser, fileChannel);
          return next;
        });
      };
      fileChannel.onclose = () => {
        setFilePeers((prev) => {
          const next = new Map(prev);
          next.delete(remoteUser);
          return next;
        });
      };

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          sendWs({ type: "voice_signal", to: remoteUser, from: username, data: { candidate: e.candidate } });
        }
      };

      pc.ontrack = (e) => {
        if (e.streams[0]) setRemoteStream(remoteUser, e.streams[0]);
      };

      pc.ondatachannel = (event) => {
        const channel = event.channel;
        if (channel.label !== "file") return;
        channel.onopen = () => {
          setFilePeers((prev) => {
            const next = new Map(prev);
            next.set(remoteUser, channel);
            return next;
          });
        };
        channel.onclose = () => {
          setFilePeers((prev) => {
            const next = new Map(prev);
            next.delete(remoteUser);
            return next;
          });
        };
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
    [username, setRemoteStream, syncPeerTracks]
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
    async (withCamera: boolean, withScreen: boolean = false) => {
      try {
        const constraints: MediaStreamConstraints = {
          audio: true,
          video: withCamera ? VIDEO_CONSTRAINTS : false,
        };
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        localStreamRef.current = stream;
        setLocalStream(stream);
        setCameraEnabled(withCamera);
        if (withCamera) {
          stream.getVideoTracks().forEach((track) => {
            track.contentHint = "motion";
            cameraTrackRef.current = track;
            cameraVideoTrackRef.current = track;
          });
        }
        sendWs({ type: "voice_join" });
        setInVoice(true);
        setMicError(null);

        if (withScreen) {
          try {
            const screenStream = await navigator.mediaDevices.getDisplayMedia(SCREEN_CONSTRAINTS);
            const screenTrack = screenStream.getVideoTracks()[0];
            screenStreamRef.current = screenStream;
            setScreenSharing(true);
            screenTrack.contentHint = "motion";
            screenTrack.onended = () => {
              screenStreamRef.current?.getTracks().forEach((t) => t.stop());
              screenStreamRef.current = null;
              setScreenSharing(false);
              peersRef.current.forEach((_, remoteUser) => syncPeerTracks(remoteUser));
              setLocalStream(new MediaStream([
                ...(localStreamRef.current?.getAudioTracks() ?? []),
              ]));
            };
            setLocalStream(new MediaStream([
              ...(stream.getAudioTracks()),
              screenTrack,
            ]));
          } catch {
            // screen share cancelled — still joined voice
          }
        }
      } catch {
        setMicError("Could not access microphone. Please allow mic permission and try again.");
      }
    },
    [syncPeerTracks]
  );

  const leaveVoice = useCallback(() => {
    peersRef.current.forEach((_, remoteUser) => cleanupPeer(remoteUser));
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    screenStreamRef.current = null;
    cameraTrackRef.current = null;
    cameraVideoTrackRef.current = null;
    setLocalStream(null);
    setRemoteStreams(new Map());
    setFilePeers(new Map());
    sendWs({ type: "voice_leave" });
    setInVoice(false);
    setCameraEnabled(false);
    setScreenSharing(false);
  }, [cleanupPeer]);

  const toggleCamera = useCallback(async () => {
    if (!localStreamRef.current || !inVoice) return;

    if (cameraEnabled) {
      cameraVideoTrackRef.current?.stop();
      cameraVideoTrackRef.current = null;
      cameraTrackRef.current = null;
      peersRef.current.forEach((_, remoteUser) => syncPeerTracks(remoteUser));
      setLocalStream(new MediaStream([
        ...localStreamRef.current.getAudioTracks(),
        ...(screenStreamRef.current?.getVideoTracks() ?? []),
      ]));
      setCameraEnabled(false);
    } else {
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
        const videoTrack = videoStream.getVideoTracks()[0];
        videoTrack.contentHint = "motion";
        cameraVideoTrackRef.current = videoTrack;
        cameraTrackRef.current = videoTrack;
        localStreamRef.current.addTrack(videoTrack);
        peersRef.current.forEach((_, remoteUser) => syncPeerTracks(remoteUser));
        setLocalStream(new MediaStream(localStreamRef.current.getTracks()));
        setCameraEnabled(true);
      } catch {
        setMicError("Could not access camera.");
      }
    }
  }, [cameraEnabled, inVoice, syncPeerTracks]);

  const shareScreen = useCallback(async () => {
    if (!inVoice) return;
    try {
      const screenStream = await navigator.mediaDevices.getDisplayMedia(SCREEN_CONSTRAINTS);
      const screenTrack = screenStream.getVideoTracks()[0];
      screenStreamRef.current = screenStream;
      setScreenSharing(true);
      if (cameraEnabled) {
        cameraVideoTrackRef.current?.stop();
        cameraVideoTrackRef.current = null;
        cameraTrackRef.current = null;
        setCameraEnabled(false);
      }
      screenTrack.contentHint = "motion";
      screenTrack.onended = () => {
        screenStreamRef.current?.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
        setScreenSharing(false);
        peersRef.current.forEach((_, remoteUser) => syncPeerTracks(remoteUser));
        setLocalStream(new MediaStream([
          ...(localStreamRef.current?.getAudioTracks() ?? []),
        ]));
      };
      peersRef.current.forEach((_, remoteUser) => syncPeerTracks(remoteUser));
      setLocalStream(new MediaStream([
        ...(localStreamRef.current?.getAudioTracks() ?? []),
        screenTrack,
      ]));
    } catch {
      // user cancelled or permission denied
    }
  }, [cameraEnabled, inVoice, syncPeerTracks]);

  const stopScreenShare = useCallback(() => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setScreenSharing(false);
    peersRef.current.forEach((_, remoteUser) => syncPeerTracks(remoteUser));
    setLocalStream(new MediaStream([
      ...(localStreamRef.current?.getAudioTracks() ?? []),
      ...(cameraTrackRef.current ? [cameraTrackRef.current] : []),
    ]));
  }, [syncPeerTracks]);

  return {
    voiceUsers,
    inVoice,
    cameraEnabled,
    screenSharing,
    micError,
    localStream,
    remoteStreams,
    filePeers,
    joinVoice,
    leaveVoice,
    toggleCamera,
    shareScreen,
    stopScreenShare,
  };
}
