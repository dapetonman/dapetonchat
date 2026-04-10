import { useEffect, useRef, useState, useCallback } from "react";
import { onWsMessage, sendWs } from "@/lib/ws-bus";

const STUN_CONFIG: RTCConfiguration = {
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

export function useVoice(username: string) {
  const [voiceUsers, setVoiceUsers] = useState<string[]>([]);
  const [inVoice, setInVoice] = useState(false);
  const [micError, setMicError] = useState<string | null>(null);

  const localStreamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());

  const cleanupAudio = (remoteUser: string) => {
    document.querySelector(`[data-voice-peer="${remoteUser}"]`)?.remove();
  };

  const cleanupPeer = useCallback((remoteUser: string) => {
    const pc = peersRef.current.get(remoteUser);
    if (pc) {
      pc.close();
      peersRef.current.delete(remoteUser);
    }
    cleanupAudio(remoteUser);
  }, []);

  const createPeer = useCallback(
    (remoteUser: string, initiator: boolean): RTCPeerConnection => {
      const pc = new RTCPeerConnection(STUN_CONFIG);
      peersRef.current.set(remoteUser, pc);

      localStreamRef.current?.getTracks().forEach((track) => {
        pc.addTrack(track, localStreamRef.current!);
      });

      pc.onicecandidate = (e) => {
        if (e.candidate) {
          sendWs({
            type: "voice_signal",
            to: remoteUser,
            from: username,
            data: { candidate: e.candidate },
          });
        }
      };

      pc.ontrack = (e) => {
        cleanupAudio(remoteUser);
        const audio = document.createElement("audio");
        audio.srcObject = e.streams[0];
        audio.autoplay = true;
        audio.setAttribute("data-voice-peer", remoteUser);
        document.body.appendChild(audio);
      };

      if (initiator) {
        pc.createOffer().then((offer) => {
          pc.setLocalDescription(offer);
          sendWs({
            type: "voice_signal",
            to: remoteUser,
            from: username,
            data: { offer },
          });
        });
      }

      return pc;
    },
    [username]
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
      onWsMessage(
        "voice_signal",
        async ({ from, data }: { from: string; data: any }) => {
          if (from === username) return;
          if (!localStreamRef.current) return;

          let pc = peersRef.current.get(from);

          if (data.offer) {
            if (!pc) pc = createPeer(from, false);
            await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            sendWs({
              type: "voice_signal",
              to: from,
              from: username,
              data: { answer },
            });
          } else if (data.answer) {
            await pc?.setRemoteDescription(new RTCSessionDescription(data.answer));
          } else if (data.candidate) {
            await pc?.addIceCandidate(new RTCIceCandidate(data.candidate));
          }
        }
      )
    );

    unsubs.push(
      onWsMessage("voice_peer_left", ({ username: leftUser }: { username: string }) => {
        cleanupPeer(leftUser);
      })
    );

    return () => unsubs.forEach((u) => u());
  }, [username, createPeer, cleanupPeer]);

  const joinVoice = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      localStreamRef.current = stream;
      sendWs({ type: "voice_join" });
      setInVoice(true);
      setMicError(null);
    } catch {
      setMicError("Could not access microphone. Please allow mic permission and try again.");
    }
  }, []);

  const leaveVoice = useCallback(() => {
    peersRef.current.forEach((_, remoteUser) => cleanupPeer(remoteUser));
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    sendWs({ type: "voice_leave" });
    setInVoice(false);
  }, [cleanupPeer]);

  return { voiceUsers, inVoice, joinVoice, leaveVoice, micError };
}
