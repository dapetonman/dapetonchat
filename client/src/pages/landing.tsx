import React, { useState, useEffect, useMemo } from "react";
import { useLocation } from "wouter";

const ABOUT_ME_TEXT = `> BIO.
> NAME: DAPETONMAN
> MISSION: BUILDING THE FUTURE OF DAPETONPUTER.
> CURRENT TRACK: 2ROTTED
> CONTACT: SPINGLEDASH@GMAIL.COM

I make things and listen to music. This website is a work in progress. Welcome to my little corner of the web. I am an avid computer engineer and dabble in world history. If you want to contact me, expect me to take a while to find your email sorry.`;

// --- CUSTOM HOOK: TYPEWRITER ---
function useTypewriter(text: string, speed: number, startTrigger: boolean) {
  const [displayedText, setDisplayedText] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [isDone, setIsDone] = useState(false);

  useEffect(() => {
    if (!startTrigger || isDone) return;
    setIsTyping(true);
    let i = 0;
    const interval = setInterval(() => {
      if (i < text.length) {
        const char = text[i];
        if (char !== undefined) {
          setDisplayedText((prev) => prev + char);
        }
        i++;
      }
      if (i >= text.length) {
        clearInterval(interval);
        setIsTyping(false);
        setIsDone(true);
      }
    }, speed);
    return () => clearInterval(interval);
  }, [text, speed, startTrigger, isDone]);

  return { displayedText, isTyping, isDone };
}

// --- MAIN COMPONENT ---
export default function Dapetonputer() {
  const [, navigate] = useLocation();
  const [screen, setScreen] = useState<"main" | "about" | "music">("main");

  // --- STARFIELD LOGIC ---
  const stars = useMemo(() => {
    return Array.from({ length: 120 }, (_, i) => ({
      id: i,
      x: Math.random() * 100,
      y: Math.random() * 100,
      size: Math.random() * 2 + 1,
      opacity: Math.random() * 0.7 + 0.3,
      duration: Math.random() * 3 + 2,
    }));
  }, []);

  // --- TYPEWRITER SEQUENCING ---
  const welcome = useTypewriter("welcome!", 80, screen === "main");
  const status = useTypewriter("> dapetonputer technologies copyright 2026", 30, welcome.isDone);
  const btn1 = useTypewriter("[ dapetonchat ]", 20, status.isDone);
  const btn2 = useTypewriter("[ about me ]", 20, btn1.isDone);
  const btn3 = useTypewriter("[ 2rotted music ]", 20, btn2.isDone);
  const aboutBody = useTypewriter(ABOUT_ME_TEXT, 8, screen === "about");

  return (
    <div className="app-container">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=VT323&display=swap');

        .app-container {
          background-color: #050505;
          color: #ffffff;
          font-family: 'VT323', monospace;
          margin: 0; padding: 0;
          height: 100vh; width: 100vw;
          position: relative; overflow: hidden;
          display: flex; justify-content: center; align-items: center;
        }

        .star {
          position: absolute;
          background-color: white;
          border-radius: 50%;
          filter: blur(0.5px);
          z-index: 0;
        }

        @keyframes twinkle {
          0%, 100% { opacity: 0.3; transform: scale(1); }
          50% { opacity: 1; transform: scale(1.1); }
        }

        .crt-overlay {
          position: fixed;
          top: 0; left: 0;
          width: 100vw; height: 100vh;
          background: linear-gradient(
            rgba(18, 16, 16, 0) 50%, 
            rgba(0, 0, 0, 0.1) 50%
          ), linear-gradient(
            90deg, 
            rgba(255, 0, 0, 0.03), 
            rgba(0, 255, 0, 0.01), 
            rgba(0, 0, 255, 0.03)
          );
          background-size: 100% 3px, 3px 100%;
          z-index: 100;
          pointer-events: none;
        }

        @keyframes flicker {
          0% { opacity: 0.98; }
          5% { opacity: 0.95; }
          10% { opacity: 0.99; }
          15% { opacity: 0.94; }
          20% { opacity: 0.98; }
          100% { opacity: 1; }
        }

        .screen-effects {
          width: 100%;
          height: 100%;
          display: flex;
          justify-content: center;
          align-items: center;
          animation: flicker 0.15s infinite;
          text-shadow: 0 0 5px rgba(255,255,255,0.3);
          position: relative;
          z-index: 10;
        }

        .corner-text {
          position: absolute; top: 20px; left: 20px;
          font-size: 24px; color: #ffffff;
          z-index: 50;
        }

        .terminal-box {
          border: 2px solid #ffffff;
          padding: 40px;
          width: 80%; max-width: 450px;
          text-align: center;
          box-shadow: 8px 8px 0px white;
          min-height: 400px; max-height: 80vh;
          display: flex; flex-direction: column;
          overflow-y: auto; 
          background: rgba(0, 0, 0, 0.9);
          backdrop-filter: blur(4px);
          position: relative;
        }

        .terminal-box::-webkit-scrollbar { width: 8px; }
        .terminal-box::-webkit-scrollbar-thumb { background: white; }

        h1 { font-family: 'VT323', monospace; font-size: 5rem; margin: 0 0 10px 0; font-weight: normal; text-transform: uppercase; }
        .status-line { font-size: 1.2rem; margin-bottom: 30px; display: block; color: #aaa; min-height: 1.2rem; }

        .btn {
          border: 2px solid white; color: white;
          padding: 10px; font-size: 1.8rem;
          transition: 0.05s; background: transparent;
          font-family: 'VT323', monospace;
          width: 100%; margin-bottom: 10px;
          cursor: pointer; display: block;
        }

        .btn:hover { 
          background-color: white; 
          color: black; 
          box-shadow: 0 0 10px white;
        }

        .cursor {
          display: inline-block; background-color: white;
          width: 12px; height: 24px;
          margin-left: 4px; vertical-align: middle;
          animation: blink 1s steps(2, start) infinite;
        }

        .about-content { text-align: left; font-size: 1.2rem; line-height: 1.2; white-space: pre-wrap; margin-bottom: 20px; }

        @keyframes blink { to { visibility: hidden; } }
      `}</style>

      {/* 1. STARFIELD LAYER */}
      <div style={{ position: "absolute", inset: 0, overflow: "hidden", pointerEvents: "none" }}>
        {stars.map((star) => (
          <div
            key={star.id}
            className="star"
            style={{
              left: `${star.x}%`,
              top: `${star.y}%`,
              width: `${star.size}px`,
              height: `${star.size}px`,
              opacity: star.opacity,
              animation: `twinkle ${star.duration}s infinite ease-in-out`,
            }}
          />
        ))}
      </div>

      {/* 2. CRT OVERLAY LAYER */}
      <div className="crt-overlay" />

      {/* 3. CONTENT LAYER */}
      <div className="screen-effects">
        <div className="corner-text">dapetonputer v0.2 beta</div>

        <div className="terminal-box">
          {screen === "main" && (
            <div>
              <h1>
                {welcome.displayedText}
                {welcome.isTyping && <span className="cursor" />}
              </h1>

              <span className="status-line">
                {status.displayedText}
                {status.isTyping && <span className="cursor" />}
              </span>

              <div className="menu-links">
                {status.isDone && (
                  <button className="btn" onClick={() => navigate("/chat")}>
                    {btn1.displayedText}
                    {btn1.isTyping && <span className="cursor" />}
                  </button>
                )}

                {btn1.isDone && (
                  <button className="btn" onClick={() => setScreen("about")}>
                    {btn2.displayedText}
                    {btn2.isTyping && <span className="cursor" />}
                  </button>
                )}

                {btn2.isDone && (
                  <button className="btn" onClick={() => setScreen("music")}>
                    {btn3.displayedText}
                    {btn3.isTyping && <span className="cursor" />}
                  </button>
                )}
              </div>
            </div>
          )}

          {screen === "about" && (
            <div>
              <div className="about-content">
                {aboutBody.displayedText}
                {aboutBody.isTyping && <span className="cursor" />}
              </div>
              <button className="btn" onClick={() => setScreen("main")}>[ BACK ]</button>
            </div>
          )}

          {screen === "music" && (
            <div style={{ textAlign: "left" }}>
              <div className="about-content">
                {`> STUPID MUSIC: TRUE...`}<br />
                {`> ARTIST: 2ROTTED`}<br /><br />
                <iframe 
                  style={{ borderRadius: "12px", marginBottom: "15px", border: "1px solid white" }} 
                  src="https://open.spotify.com/embed/album/2dJ3N24XXEQCxR52ktYlL7?" 
                  width="100%" height="152" frameBorder="0" 
                  allowFullScreen allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" 
                />
                <iframe 
                  style={{ width: "100%", maxWidth: "660px", overflow: "hidden", borderRadius: "10px", border: "1px solid white" }} 
                  height="450" frameBorder="0"
                  src="https://embed.music.apple.com/us/artist/2rotted/1866429789"
                  sandbox="allow-forms allow-popups allow-same-origin allow-scripts allow-storage-access-by-user-activation allow-top-navigation-by-user-activation"
                />
              </div>
              <button className="btn" onClick={() => setScreen("main")}>[ BACK ]</button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}