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

const RECONNECT_TIMEOUT_MS = 10_000;

const SCREEN_QUALITY_PRESETS: Record<string, MediaTrackConstraints> = {
  "480p": { width: { ideal: 854 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
  "720p": { width: { ideal: 1280 }, height: { ideal: 720 }, frameRate: { ideal: 30 } },
  "1080p": { width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 } },
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

function isPolite(a: string, b: string): boolean {
  return a.localeCompare(b) < 0;
}

function cleanupPeerConnection(pc: RTCPeerConnection): void {
  pc.onicecandidate = null;
  pc.ontrack = null;
  pc.onconnectionstatechange = null;
  pc.oniceconnectionstatechange = null;
  pc.onnegotiationneeded = null;
  pc.ondatachannel = null;
  pc.onsignalingstatechange = null;
  if (pc.connectionState !== "closed") {
    pc.close();
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
  const [desktopAudioEnabled, setDesktopAudioEnabled] = useState(false);
  const [screenQuality, setScreenQualityState] = useState("720p");

  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const localStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const cameraTrackRef = useRef<MediaStreamTrack | null>(null);
  const cameraVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  const senderMapRef = useRef<Map<string, { audio?: RTCRtpSender; video?: RTCRtpSender; screen?: RTCRtpSender }>>(new Map());
  const candidateQueueRef = useRef<Map<string, RTCIceCandidateInit[]>>(new Map());
  const reconnectTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const makingOfferRef = useRef<Map<string, boolean>>(new Map());
  const syncPeerTracksRef = useRef<((remoteUser: string) => void) | null>(null);
  const desktopAudioEnabledRef = useRef(false);
  const screenQualityRef = useRef("720p");

  const setRemoteStream = useCallback((remoteUser: string, stream: MediaStream | null) => {
    setRemoteStreams((prev) => {
      const next = new Map(prev);
      if (stream) next.set(remoteUser, stream);
      else next.delete(remoteUser);
      return next;
    });
  }, []);

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

    if (screenTrack && !senders.screen) {
      senders.screen = pc.addTrack(screenTrack, screenStreamRef.current!);
    }

    if (!screenTrack && senders.screen) {
      pc.removeTrack(senders.screen);
      delete senders.screen;
    }

    senderMapRef.current.set(remoteUser, senders);
  }, []);

  syncPeerTracksRef.current = syncPeerTracks;

  const attemptIceRestart = useCallback((remoteUser: string) => {
    const pc = peersRef.current.get(remoteUser);
    if (!pc || pc.connectionState === "closed" || pc.signalingState !== "stable") return;
    pc.createOffer({ iceRestart: true, offerToReceiveAudio: true, offerToReceiveVideo: true })
      .then(async (offer) => {
        if (pc.signalingState !== "stable") return;
        const mungedSdp = forceH264(offer.sdp ?? "");
        const mungedOffer = { type: offer.type, sdp: mungedSdp };
        await pc.setLocalDescription(mungedOffer as RTCSessionDescriptionInit);
        sendWs({ type: "voice_signal", to: remoteUser, from: username, data: { offer: mungedOffer } });
      })
      .catch(() => {});
  }, [username]);

  const restoreMicAudio = useCallback(() => {
    const micTrack = localStreamRef.current?.getAudioTracks()[0];
    if (!micTrack) return;
    peersRef.current.forEach((pc) => {
      const audioSender = pc.getSenders().find((s) => s.track?.kind === "audio");
      if (audioSender && audioSender.track !== micTrack) {
        audioSender.replaceTrack(micTrack).catch(() => {});
      }
    });
  }, []);

  const cleanupPeer = useCallback(
    (remoteUser: string) => {
      const timer = reconnectTimersRef.current.get(remoteUser);
      if (timer) {
        clearTimeout(timer);
        reconnectTimersRef.current.delete(remoteUser);
      }
      candidateQueueRef.current.delete(remoteUser);
      makingOfferRef.current.delete(remoteUser);
      const pc = peersRef.current.get(remoteUser);
      if (pc) {
        cleanupPeerConnection(pc);
        peersRef.current.delete(remoteUser);
      }
      senderMapRef.current.delete(remoteUser);
      setRemoteStream(remoteUser, null);
    },
    [setRemoteStream]
  );

  const createPeer = useCallback(
    (remoteUser: string, initiator: boolean): RTCPeerConnection => {
      const existing = peersRef.current.get(remoteUser);
      if (existing) {
        cleanupPeerConnection(existing);
        peersRef.current.delete(remoteUser);
      }

      const pc = new RTCPeerConnection(STUN_CONFIG);
      const polite = isPolite(username, remoteUser);

      peersRef.current.set(remoteUser, pc);
      senderMapRef.current.set(remoteUser, {});
      candidateQueueRef.current.set(remoteUser, []);
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

      pc.onnegotiationneeded = async () => {
        makingOfferRef.current.set(remoteUser, true);
        try {
          if (pc.signalingState !== "stable") return;
          const offer = await pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true });
          if (pc.signalingState !== "stable") return;
          const mungedSdp = forceH264(offer.sdp ?? "");
          const mungedOffer = { type: offer.type, sdp: mungedSdp };
          await pc.setLocalDescription(mungedOffer as RTCSessionDescriptionInit);
          sendWs({ type: "voice_signal", to: remoteUser, from: username, data: { offer: mungedOffer } });
        } catch {} finally {
          makingOfferRef.current.delete(remoteUser);
        }
      };

      pc.onsignalingstatechange = () => {
        if (pc.signalingState === "stable") {
          const queue = candidateQueueRef.current.get(remoteUser);
          if (queue) {
            while (queue.length > 0) {
              const c = queue.shift()!;
              pc.addIceCandidate(new RTCIceCandidate(c)).catch(() => {});
            }
          }
        }
      };

      pc.oniceconnectionstatechange = () => {
        if (pc.iceConnectionState === "failed") {
          attemptIceRestart(remoteUser);
        }
      };

      pc.onconnectionstatechange = () => {
        const state = pc.connectionState;
        switch (state) {
          case "connected": {
            const timer = reconnectTimersRef.current.get(remoteUser);
            if (timer) {
              clearTimeout(timer);
              reconnectTimersRef.current.delete(remoteUser);
            }
            setVideoBandwidth(pc);
            break;
          }
          case "disconnected": {
            if (!reconnectTimersRef.current.has(remoteUser)) {
              reconnectTimersRef.current.set(
                remoteUser,
                setTimeout(() => {
                  reconnectTimersRef.current.delete(remoteUser);
                  if (pc.connectionState === "disconnected" || pc.connectionState === "failed") {
                    attemptIceRestart(remoteUser);
                  }
                }, RECONNECT_TIMEOUT_MS)
              );
            }
            break;
          }
          case "failed": {
            attemptIceRestart(remoteUser);
            break;
          }
          case "closed": {
            const timer = reconnectTimersRef.current.get(remoteUser);
            if (timer) {
              clearTimeout(timer);
              reconnectTimersRef.current.delete(remoteUser);
            }
            break;
          }
        }
      };

      if (initiator) {
        pc.createOffer({ offerToReceiveAudio: true, offerToReceiveVideo: true }).then(async (offer) => {
          const mungedSdp = forceH264(offer.sdp ?? "");
          const mungedOffer = { type: offer.type, sdp: mungedSdp };
          await pc.setLocalDescription(mungedOffer as RTCSessionDescriptionInit);
          sendWs({ type: "voice_signal", to: remoteUser, from: username, data: { offer: mungedOffer } });
        }).catch(() => {});
      }

      return pc;
    },
    [username, setRemoteStream, syncPeerTracks, attemptIceRestart]
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
        const polite = isPolite(username, from);

        if (data.offer) {
          if (!pc) {
            pc = createPeer(from, false);
          }

          if (pc.signalingState === "stable") {
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            const mungedSdp = forceH264(answer.sdp ?? "");
            const mungedAnswer = { type: answer.type, sdp: mungedSdp };
            await pc.setLocalDescription(mungedAnswer as RTCSessionDescriptionInit);
            sendWs({ type: "voice_signal", to: from, from: username, data: { answer: mungedAnswer } });
          } else if (pc.signalingState === "have-local-offer") {
            if (polite) {
              await pc.setLocalDescription({ type: "rollback" });
              await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
              const answer = await pc.createAnswer();
              const mungedSdp = forceH264(answer.sdp ?? "");
              const mungedAnswer = { type: answer.type, sdp: mungedSdp };
              await pc.setLocalDescription(mungedAnswer as RTCSessionDescriptionInit);
              sendWs({ type: "voice_signal", to: from, from: username, data: { answer: mungedAnswer } });
            }
          }
        } else if (data.answer) {
          if (pc && pc.signalingState === "have-local-offer") {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          }
        } else if (data.candidate) {
          if (!pc) return;
          if (pc.remoteDescription && pc.remoteDescription.type) {
            pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => {});
          } else {
            const queue = candidateQueueRef.current.get(from);
            if (queue) queue.push(data.candidate);
          }
        }
      })
    );

    unsubs.push(
      onWsMessage("voice_peer_left", ({ username: leftUser }: { username: string }) => {
        cleanupPeer(leftUser);
      })
    );

    unsubs.push(
      onWsMessage("voice-renegotiate", ({ username: targetUser }: { username: string }) => {
        if (targetUser === username || !localStreamRef.current) return;
        syncPeerTracksRef.current?.(targetUser);
      })
    );

    return () => unsubs.forEach((u) => u());
  }, [username, createPeer, cleanupPeer]);

  const joinVoice = useCallback(
    async (withCamera: boolean, withScreen: boolean = false) => {
      let stream: MediaStream;
      let cameraActuallyEnabled = withCamera;

      if (withCamera) {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: VIDEO_CONSTRAINTS });
        } catch (err: any) {
          const isDenied = err?.name === "NotAllowedError" || err?.name === "PermissionDeniedError" || err?.name === "NotFoundError";
          if (isDenied) {
            try {
              stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
              cameraActuallyEnabled = false;
              setMicError("camera-denied");
            } catch {
              setMicError("Could not access microphone. Please allow mic permission and try again.");
              return;
            }
          } else {
            setMicError("Could not access microphone. Please allow mic permission and try again.");
            return;
          }
        }
      } else {
        try {
          stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        } catch {
          setMicError("Could not access microphone. Please allow mic permission and try again.");
          return;
        }
      }

      localStreamRef.current = stream;
      setLocalStream(stream);
      setCameraEnabled(cameraActuallyEnabled);
      if (cameraActuallyEnabled) {
        stream.getVideoTracks().forEach((track) => {
          track.contentHint = "motion";
          cameraTrackRef.current = track;
          cameraVideoTrackRef.current = track;
        });
      }
      sendWs({ type: "voice_join" });
      setInVoice(true);
      if (micError !== "camera-denied") setMicError(null);

      if (withScreen) {
        try {
          const screenStream = await navigator.mediaDevices.getDisplayMedia(SCREEN_CONSTRAINTS);
          const screenTrack = screenStream.getVideoTracks()[0];
          screenStreamRef.current = screenStream;
          setScreenSharing(true);
          screenTrack.contentHint = "motion";
          screenTrack.onended = () => {
            const videoTracks = localStreamRef.current?.getVideoTracks() ?? [];
            videoTracks.forEach((t) => localStreamRef.current?.removeTrack(t));
            screenStreamRef.current?.getTracks().forEach((t) => t.stop());
            screenStreamRef.current = null;
            setScreenSharing(false);
            peersRef.current.forEach((_, remoteUser) => syncPeerTracks(remoteUser));
            setLocalStream(localStreamRef.current);
          };
          localStreamRef.current.addTrack(screenTrack);
          setLocalStream(localStreamRef.current);
          peersRef.current.forEach((_, remoteUser) => syncPeerTracks(remoteUser));
        } catch {
        }
      }
    },
    [syncPeerTracks, micError]
  );

  const leaveVoice = useCallback(() => {
    reconnectTimersRef.current.forEach((timer) => clearTimeout(timer));
    reconnectTimersRef.current.clear();
    candidateQueueRef.current.clear();
    makingOfferRef.current.clear();
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
    setDesktopAudioEnabled(false);
    desktopAudioEnabledRef.current = false;
    setScreenQualityState("720p");
    screenQualityRef.current = "720p";
  }, [cleanupPeer]);

  const toggleCamera = useCallback(async () => {
    if (!localStreamRef.current || !inVoice) return;

    if (cameraEnabled) {
      cameraTrackRef.current = null;
      const oldTrack = cameraVideoTrackRef.current;
      cameraVideoTrackRef.current = null;

      peersRef.current.forEach((pc, remoteUser) => {
        const senders = senderMapRef.current.get(remoteUser);
        if (senders?.video) {
          senders.video.replaceTrack(null).catch(() => {});
        }
      });

      if (oldTrack) {
        localStreamRef.current.removeTrack(oldTrack);
        oldTrack.stop();
      }
      setCameraEnabled(false);
    } else {
      try {
        const videoStream = await navigator.mediaDevices.getUserMedia({ video: VIDEO_CONSTRAINTS });
        const videoTrack = videoStream.getVideoTracks()[0];
        videoTrack.contentHint = "motion";
        cameraVideoTrackRef.current = videoTrack;
        cameraTrackRef.current = videoTrack;

        localStreamRef.current.addTrack(videoTrack);

        peersRef.current.forEach((pc, remoteUser) => {
          const senders = senderMapRef.current.get(remoteUser);
          if (senders?.video) {
            senders.video.replaceTrack(videoTrack).catch(() => {});
          } else {
            const sender = pc.addTrack(videoTrack, localStreamRef.current!);
            if (senders) senders.video = sender;
          }
        });

        setCameraEnabled(true);
      } catch {
        setMicError("Could not access camera.");
      }
    }
  }, [cameraEnabled, inVoice]);

  const shareScreen = useCallback(async () => {
    if (!inVoice) return;
    try {
      const constraints: DisplayMediaStreamOptions = {
        video: SCREEN_QUALITY_PRESETS[screenQualityRef.current] ?? SCREEN_CONSTRAINTS.video,
        audio: true,
      };
      const screenStream = await navigator.mediaDevices.getDisplayMedia(constraints);
      const screenTrack = screenStream.getVideoTracks()[0];
      const desktopAudioTrack = screenStream.getAudioTracks()[0] ?? null;

      screenStreamRef.current = screenStream;
      setScreenSharing(true);
      const hasAudio = !!desktopAudioTrack;
      setDesktopAudioEnabled(hasAudio);
      desktopAudioEnabledRef.current = hasAudio;

      if (cameraEnabled) {
        cameraVideoTrackRef.current?.stop();
        cameraVideoTrackRef.current = null;
        cameraTrackRef.current = null;
        setCameraEnabled(false);
      }
      screenTrack.contentHint = "motion";
      screenTrack.onended = () => {
        const videoTracks = localStreamRef.current?.getVideoTracks() ?? [];
        videoTracks.forEach((t) => localStreamRef.current?.removeTrack(t));
        screenStreamRef.current?.getTracks().forEach((t) => t.stop());
        screenStreamRef.current = null;
        setScreenSharing(false);
        setDesktopAudioEnabled(false);
        desktopAudioEnabledRef.current = false;
        restoreMicAudio();
        peersRef.current.forEach((_, remoteUser) => syncPeerTracks(remoteUser));
        setLocalStream(localStreamRef.current);
      };

      if (desktopAudioTrack) {
        desktopAudioTrack.contentHint = "music";
      }

      peersRef.current.forEach((_, remoteUser) => syncPeerTracks(remoteUser));

      if (desktopAudioTrack) {
        peersRef.current.forEach((pc) => {
          const audioSender = pc.getSenders().find((s) => s.track?.kind === "audio");
          if (audioSender) {
            audioSender.replaceTrack(desktopAudioTrack).catch(() => {});
          }
        });
      }

      localStreamRef.current!.addTrack(screenTrack);
      setLocalStream(localStreamRef.current);
    } catch {
    }
  }, [cameraEnabled, inVoice, syncPeerTracks, restoreMicAudio]);

  const stopScreenShare = useCallback(() => {
    const videoTracks = localStreamRef.current?.getVideoTracks() ?? [];
    videoTracks.forEach((t) => localStreamRef.current?.removeTrack(t));
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setScreenSharing(false);
    setDesktopAudioEnabled(false);
    desktopAudioEnabledRef.current = false;
    restoreMicAudio();
    if (cameraTrackRef.current) {
      localStreamRef.current?.addTrack(cameraTrackRef.current);
    }
    setLocalStream(localStreamRef.current);
    peersRef.current.forEach((_, remoteUser) => syncPeerTracks(remoteUser));
  }, [syncPeerTracks, restoreMicAudio]);

  const setScreenQuality = useCallback(async (quality: string) => {
    screenQualityRef.current = quality;
    setScreenQualityState(quality);
    const track = screenStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    const constraints = SCREEN_QUALITY_PRESETS[quality];
    if (!constraints) return;
    try {
      await track.applyConstraints(constraints);
    } catch {
    }
  }, []);

  const toggleDesktopAudio = useCallback(() => {
    const newState = !desktopAudioEnabledRef.current;
    desktopAudioEnabledRef.current = newState;
    setDesktopAudioEnabled(newState);

    const desktopAudioTrack = screenStreamRef.current?.getAudioTracks()[0];
    const micTrack = localStreamRef.current?.getAudioTracks()[0];

    peersRef.current.forEach((pc) => {
      const audioSender = pc.getSenders().find((s) => s.track?.kind === "audio");
      if (!audioSender) return;
      if (newState && desktopAudioTrack) {
        audioSender.replaceTrack(desktopAudioTrack).catch(() => {});
      } else if (!newState && micTrack) {
        audioSender.replaceTrack(micTrack).catch(() => {});
      }
    });
  }, []);

  const renegotiate = useCallback(() => {
    sendWs({ type: "voice-renegotiate", username });
    peersRef.current.forEach((_, remoteUser) => syncPeerTracks(remoteUser));
  }, [username]);

  return {
    voiceUsers,
    inVoice,
    cameraEnabled,
    screenSharing,
    micError,
    localStream,
    remoteStreams,
    desktopAudioEnabled,
    screenQuality,
    joinVoice,
    leaveVoice,
    toggleCamera,
    shareScreen,
    stopScreenShare,
    setScreenQuality,
    toggleDesktopAudio,
    renegotiate,
  };
}
