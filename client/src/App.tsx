import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Video, VideoOff, Mic, MicOff, PhoneOff, Send, LogOut, User, Lock, PhoneCall, Shield, Trash2, RefreshCw, Eye, EyeOff, UserPlus, SwitchCamera } from 'lucide-react';

const SOCKET_SERVER_URL = 'https://neonconnect-backend.onrender.com';

interface OnlineUser {
  socketId: string;
  userId: string;
}

interface Message {
  from: string;
  text: string;
}

interface UserAccount {
  userId: string;
  password?: string;
  role: string;
}

// Reusable component to safely load ad scripts dynamically without breaking React
function AdScriptBox({ src, className = "" }: { src: string; className?: string }) {
  const scriptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!scriptRef.current) return;
    scriptRef.current.innerHTML = '';
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.referrerPolicy = 'no-referrer-when-downgrade';
    scriptRef.current.appendChild(script);
  }, [src]);

  return <div ref={scriptRef} className={`flex items-center justify-center overflow-hidden ${className}`} />;
}

export default function App() {
  const [token, setToken] = useState<string | null>(localStorage.getItem('token'));
  const [userId, setUserId] = useState<string>(localStorage.getItem('userId') || '');
  const [userRole, setUserRole] = useState<string>(localStorage.getItem('userRole') || 'user');

  // Auth States
  const [isSignup, setIsSignup] = useState(false);
  const [inputUserId, setInputUserId] = useState('');
  const [inputPassword, setInputPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [authError, setAuthError] = useState('');

  // Admin Dashboard State
  const [showAdminPanel, setShowAdminPanel] = useState(false);
  const [allUsers, setAllUsers] = useState<UserAccount[]>([]);
  const [adminMsg, setAdminMsg] = useState('');

  // WebRTC / Call State
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [activeCall, setActiveCall] = useState<{ socketId: string; userId: string } | null>(null);
  const [incomingCall, setIncomingCall] = useState<{ fromSocketId: string; fromUser: string; offer: RTCSessionDescriptionInit } | null>(null);
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  // Video Aspect Ratio & Absolute Draggable Box States
  const [isPortrait, setIsPortrait] = useState(true); // true = 9:16, false = 16:9
  const [localPos, setLocalPos] = useState({ x: 20, y: 20 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // Initialize local video position near bottom-right on load
  useEffect(() => {
    if (typeof window !== 'undefined') {
      setLocalPos({
        x: Math.max(20, window.innerWidth - 200),
        y: Math.max(20, window.innerHeight - 280)
      });
    }
  }, []);

  // Chat State
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');

  const socketRef = useRef<Socket | null>(null);
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  const remoteVideoRef = useRef<HTMLVideoElement | null>(null);
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!token) return;

    const socket = io(SOCKET_SERVER_URL, { auth: { token } });
    socketRef.current = socket;

    socket.on('online-users', (usersList: [string, string][]) => {
      const formatted = usersList
        .filter(([id, name]) => name !== userId)
        .map(([id, name]) => ({ socketId: id, userId: name }));
      setOnlineUsers(formatted);
    });

    socket.on('call-made', (data: { offer: RTCSessionDescriptionInit; socket: string; fromUser: string }) => {
      setIncomingCall({ fromSocketId: data.socket, fromUser: data.fromUser, offer: data.offer });
    });

    socket.on('answer-made', async (data: { socket: string; answer: RTCSessionDescriptionInit }) => {
      if (peerConnectionRef.current) {
        await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.answer));
      }
    });

    socket.on('ice-candidate-received', async (data: { socket: string; candidate: RTCIceCandidateInit }) => {
      if (peerConnectionRef.current && data.candidate) {
        try {
          await peerConnectionRef.current.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.error("ICE error:", e);
        }
      }
    });

    socket.on('call-hung-up', () => {
      closeCallClean(false);
    });

    socket.on('receive-message', (data: { from: string; text: string }) => {
      setMessages((prev) => [...prev, data]);
    });

    return () => { socket.disconnect(); };
  }, [token, userId]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Bulletproof Dragging Handlers
  const handleDragStart = (e: React.MouseEvent | React.TouchEvent) => {
    if ('cancelable' in e && e.cancelable) e.preventDefault();
    isDraggingRef.current = true;
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
    dragStartRef.current = { x: clientX, y: clientY };
  };

  useEffect(() => {
    const handleDragMove = (e: MouseEvent | TouchEvent) => {
      if (!isDraggingRef.current) return;
      if (e.cancelable) e.preventDefault();

      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
      const dx = clientX - dragStartRef.current.x;
      const dy = clientY - dragStartRef.current.y;
      dragStartRef.current = { x: clientX, y: clientY };

      setLocalPos((prev) => {
        const boxWidth = 176;
        const boxHeight = 240;
        const newX = prev.x + dx;
        const newY = prev.y + dy;

        return {
          x: Math.min(Math.max(10, newX), window.innerWidth - boxWidth - 10),
          y: Math.min(Math.max(10, newY), window.innerHeight - boxHeight - 10)
        };
      });
    };

    const handleDragEnd = () => {
      isDraggingRef.current = false;
    };

    window.addEventListener('mousemove', handleDragMove);
    window.addEventListener('mouseup', handleDragEnd);
    window.addEventListener('touchmove', handleDragMove, { passive: false });
    window.addEventListener('touchend', handleDragEnd);

    return () => {
      window.removeEventListener('mousemove', handleDragMove);
      window.removeEventListener('mouseup', handleDragEnd);
      window.removeEventListener('touchmove', handleDragMove);
      window.removeEventListener('touchend', handleDragEnd);
    };
  }, []);

  const fetchUsersForAdmin = async () => {
    if (!token) return;
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/admin/users`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) setAllUsers(data);
    } catch (err) {
      console.error("Admin fetch error:", err);
    }
  };

  useEffect(() => {
    if (showAdminPanel && userRole === 'admin') {
      fetchUsersForAdmin();
    }
  }, [showAdminPanel]);

  const handleDeleteUser = async (targetId: string) => {
    if (!window.confirm(`Delete user "${targetId}"?`)) return;
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/admin/users/${targetId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (res.ok) {
        setAdminMsg(`Deleted ${targetId}`);
        fetchUsersForAdmin();
      } else {
        setAdminMsg(data.error || 'Failed to delete');
      }
    } catch (err) {
      setAdminMsg('Error deleting user');
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError('');
    const endpoint = isSignup ? '/api/signup' : '/api/login';

    try {
      const res = await fetch(`${SOCKET_SERVER_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: inputUserId, password: inputPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Authentication failed');

      localStorage.setItem('token', data.token);
      localStorage.setItem('userId', data.userId);
      localStorage.setItem('userRole', data.role);
      setToken(data.token);
      setUserId(data.userId);
      setUserRole(data.role);
    } catch (err: any) {
      setAuthError(err.message);
    }
  };

  const handleLogout = () => {
    localStorage.clear();
    setToken(null);
    setUserId('');
    setUserRole('user');
    setShowAdminPanel(false);
    endCall();
  };

  const setupMediaAndPeer = async (targetSocketId: string, overrideFacingMode = 'user') => {
    const stream = await navigator.mediaDevices.getUserMedia({ 
      video: { facingMode: overrideFacingMode }, 
      audio: true 
    });
    localStreamRef.current = stream;
    if (localVideoRef.current) localVideoRef.current.srcObject = stream;

    const pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] });
    stream.getTracks().forEach((track) => pc.addTrack(track, stream));

    pc.ontrack = (event) => {
      if (remoteVideoRef.current && event.streams[0]) {
        remoteVideoRef.current.srcObject = event.streams[0];
      }
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', { to: targetSocketId, candidate: event.candidate });
      }
    };

    peerConnectionRef.current = pc;
    return pc;
  };

  const startCall = async (targetUser: OnlineUser) => {
    setActiveCall(targetUser);
    const pc = await setupMediaAndPeer(targetUser.socketId, facingMode);
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socketRef.current?.emit('call-user', { to: targetUser.socketId, offer });
  };

  const acceptCall = async () => {
    if (!incomingCall) return;
    setActiveCall({ socketId: incomingCall.fromSocketId, userId: incomingCall.fromUser });

    const pc = await setupMediaAndPeer(incomingCall.fromSocketId, facingMode);
    await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    socketRef.current?.emit('make-answer', { to: incomingCall.fromSocketId, answer });
    setIncomingCall(null);
  };

  const closeCallClean = (notifyPeer = true) => {
    if (activeCall && notifyPeer && socketRef.current) {
      socketRef.current.emit('hang-up', { to: activeCall.socketId });
    }
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    setActiveCall(null);
    setIncomingCall(null);
  };

  const endCall = () => {
    closeCallClean(true);
  };

  const toggleAudio = () => {
    if (localStreamRef.current) {
      const audioTrack = localStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsAudioMuted(!audioTrack.enabled);
      }
    }
  };

  const toggleVideo = () => {
    if (localStreamRef.current) {
      const videoTrack = localStreamRef.current.getVideoTracks()[0];
      if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        setIsVideoMuted(!videoTrack.enabled);
      }
    }
  };

  const switchCamera = async () => {
    const nextMode = facingMode === 'user' ? 'environment' : 'user';
    setFacingMode(nextMode);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: nextMode }, audio: true });
      localStreamRef.current = stream;
      if (localVideoRef.current) localVideoRef.current.srcObject = stream;

      if (peerConnectionRef.current) {
        const videoTrack = stream.getVideoTracks()[0];
        const senders = peerConnectionRef.current.getSenders();
        const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
        if (videoSender && videoTrack) {
          videoSender.replaceTrack(videoTrack);
        }
      }
    } catch (e) {
      console.error("Camera switch error:", e);
    }
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim() || !activeCall) return;

    socketRef.current?.emit('send-message', { to: activeCall.socketId, text: chatInput });
    setMessages((prev) => [...prev, { from: userId, text: chatInput }]);
    setChatInput('');
  };

  // ---------------------------------------------------------------------------
  // LOGIN / SIGNUP VIEW
  // ---------------------------------------------------------------------------
  if (!token) {
    return (
      <div className="min-h-screen bg-[#05050D] flex items-center justify-center p-4 relative overflow-hidden text-white font-sans select-none">
        <div className="absolute -top-32 -left-32 w-[600px] h-[600px] bg-pink-600/20 rounded-full blur-[140px] pointer-events-none"></div>
        <div className="absolute -bottom-32 -right-32 w-[600px] h-[600px] bg-cyan-500/20 rounded-full blur-[140px] pointer-events-none"></div>

        <div className="relative z-10 w-full max-w-[1280px] flex flex-col lg:flex-row items-center justify-center gap-8">
          
          <div className="hidden lg:flex flex-col items-center justify-center w-[300px] min-h-[420px] bg-[#090b16]/70 border border-slate-800 rounded-[30px] p-4 backdrop-blur-xl shadow-[0_0_30px_rgba(0,0,0,0.5)]">
            <span className="text-[10px] tracking-widest text-slate-500 uppercase mb-3">Advertisement</span>
            <AdScriptBox src="//conventionalresponse.com/b.XoVZsfdJGYlT0ZYdWHcB/-eNmP9FuWZnU/lzkOPwTXcK0eMQj/Uk2KMjTycLtFNxz-Qfy/N/TQYuyWM_QE" />
          </div>

          <div className="w-full max-w-[420px]">
            <div className="p-[2px] rounded-[36px] bg-gradient-to-r from-[#f43f5e] via-[#d946ef] to-[#06b6d4] shadow-[0_0_50px_rgba(236,72,153,0.35),0_0_50px_rgba(6,182,212,0.35)]">
              <div className="bg-[#090b16]/95 backdrop-blur-3xl rounded-[34px] p-8 sm:p-10 text-center">
                <div className="inline-flex items-center justify-center w-20 h-20 mb-4 rounded-3xl bg-transparent relative">
                  <span className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-pink-500 via-purple-400 to-cyan-400 font-sans">
                    N
                  </span>
                </div>

                <h1 className="text-3xl font-black tracking-widest mb-1">
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#ff3b94] via-[#e040fb] to-[#00e5ff]">NEON</span>
                  <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00e5ff] to-[#00b0ff]">CONNECT</span>
                </h1>
                <p className="text-slate-400 text-sm mb-8 font-light tracking-wide">
                  {isSignup ? 'Create account to access network' : 'Sign in to access network'}
                </p>

                {authError && (
                  <div className="mb-6 p-3 bg-red-500/10 border border-red-500/30 text-red-400 text-xs rounded-xl text-center">
                    {authError}
                  </div>
                )}

                <form onSubmit={handleAuth} className="space-y-4">
                  <div className="relative group">
                    <User className="absolute left-4 top-4 text-slate-500 group-focus-within:text-pink-400 w-5 h-5 transition-colors" />
                    <input
                      type="text"
                      placeholder="User ID"
                      value={inputUserId}
                      onChange={(e) => setInputUserId(e.target.value)}
                      className="w-full bg-[#0d1124]/80 border border-slate-800/80 rounded-2xl py-3.5 pl-12 pr-4 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                      required
                    />
                  </div>

                  <div className="relative group">
                    <Lock className="absolute left-4 top-4 text-slate-500 group-focus-within:text-cyan-400 w-5 h-5 transition-colors" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      placeholder="Password"
                      value={inputPassword}
                      onChange={(e) => setInputPassword(e.target.value)}
                      className="w-full bg-[#0d1124]/80 border border-slate-800/80 rounded-2xl py-3.5 pl-12 pr-12 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-cyan-400"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-4 top-4 text-slate-500 hover:text-slate-300 transition-colors"
                    >
                      {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                    </button>
                  </div>

                  <div className="pt-2">
                    <button
                      type="submit"
                      className="w-full h-13 bg-gradient-to-r from-[#ff2a8d] via-[#9a34eb] to-[#00d4ff] hover:opacity-95 text-white font-semibold text-base rounded-2xl shadow-[0_0_30px_rgba(255,42,141,0.5),0_0_30px_rgba(0,212,255,0.4)] transition-all duration-300 flex items-center justify-center space-x-2 border border-white/20"
                    >
                      {isSignup ? <UserPlus className="w-5 h-5" /> : null}
                      <span>{isSignup ? 'Create Account' : 'Sign In'}</span>
                    </button>
                  </div>
                </form>

                <div className="mt-8 text-xs text-slate-400">
                  <span>{isSignup ? 'Already have an account? ' : "Don't have an account? "}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setIsSignup(!isSignup);
                      setAuthError('');
                    }}
                    className="text-cyan-400 hover:text-cyan-300 font-semibold transition underline underline-offset-4"
                  >
                    {isSignup ? 'Sign In' : 'Create One'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="hidden lg:flex flex-col items-center justify-center w-[300px] min-h-[420px] bg-[#090b16]/70 border border-slate-800 rounded-[30px] p-4 backdrop-blur-xl shadow-[0_0_30px_rgba(0,0,0,0.5)]">
            <span className="text-[10px] tracking-widest text-slate-500 uppercase mb-3">Advertisement</span>
            <AdScriptBox src="//conventionalresponse.com/b/X_VOsod.Gdli0dYdWXcI/Belm/9/udZaUKlzkTPPTBce0mMxjTUh1aOSDdUqtzN/zGQoy/NHTOUL4GONQ-" />
          </div>

        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // MAIN APP BOARD
  // ---------------------------------------------------------------------------
  return (
    <div className="min-h-screen bg-[#05050D] text-white flex flex-col font-sans">
      <header className="border-b border-slate-800/80 bg-[#090b16]/80 backdrop-blur-xl px-8 py-4 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-r from-pink-500 to-cyan-400 flex items-center justify-center font-black text-slate-950 text-base shadow-[0_0_20px_rgba(236,72,153,0.5)]">
            N
          </div>
          <h1 className="text-xl font-black tracking-wider bg-gradient-to-r from-pink-500 via-purple-400 to-cyan-400 bg-clip-text text-transparent">
            NEONCONNECT
          </h1>
        </div>

        <div className="flex items-center space-x-4">
          {userRole === 'admin' && (
            <button
              onClick={() => setShowAdminPanel(!showAdminPanel)}
              className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center space-x-2 transition ${
                showAdminPanel ? 'bg-amber-500 text-slate-950 shadow-[0_0_20px_rgba(245,158,11,0.5)]' : 'bg-amber-500/10 border border-amber-500/30 text-amber-400 hover:bg-amber-500/20'
              }`}
            >
              <Shield className="w-4 h-4" />
              <span>Admin Panel</span>
            </button>
          )}

          <div className="bg-[#0d1124] border border-slate-800 px-4 py-2 rounded-xl flex items-center space-x-2.5">
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping"></span>
            <span className="text-xs text-slate-300 font-medium">Node: <strong className="text-cyan-400">{userId}</strong></span>
          </div>

          <button
            onClick={handleLogout}
            className="p-2.5 hover:bg-slate-800/60 rounded-xl text-slate-400 hover:text-red-400 transition-colors"
            title="Logout"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </header>

      {showAdminPanel && userRole === 'admin' ? (
        <div className="p-6 max-w-4xl w-full mx-auto">
          <div className="bg-[#090b16]/90 border border-amber-500/40 rounded-3xl p-6 backdrop-blur-xl shadow-[0_0_50px_rgba(245,158,11,0.15)]">
            <div className="flex justify-between items-center mb-6 pb-4 border-b border-slate-800">
              <div>
                <h2 className="text-lg font-bold text-amber-400 flex items-center space-x-2">
                  <Shield className="w-5 h-5" />
                  <span>Admin User Management & Passwords</span>
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">View user credentials, manage accounts, and remove inappropriate usernames.</p>
              </div>
              <button
                onClick={fetchUsersForAdmin}
                className="p-2.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-xs flex items-center space-x-1.5 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Refresh</span>
              </button>
            </div>

            {adminMsg && (
              <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 text-amber-400 text-xs rounded-xl">
                {adminMsg}
              </div>
            )}

            <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
              {allUsers.map((u) => (
                <div key={u.userId} className="flex items-center justify-between p-4 bg-[#0d1124]/60 border border-slate-800 rounded-2xl">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-xl bg-slate-800 flex items-center justify-center text-xs font-bold text-cyan-400">
                      {u.userId.substring(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <span className="text-sm font-semibold text-slate-200 block">ID: {u.userId}</span>
                      <span className="text-xs text-cyan-400 font-mono block">Password: {u.password || 'N/A'}</span>
                      <span className={`text-[10px] uppercase font-bold px-2 py-0.5 rounded-full mt-1 inline-block ${u.role === 'admin' ? 'bg-amber-500/20 text-amber-400' : 'bg-slate-800 text-slate-400'}`}>
                        {u.role}
                      </span>
                    </div>
                  </div>

                  {u.role !== 'admin' && (
                    <button
                      onClick={() => handleDeleteUser(u.userId)}
                      className="px-3.5 py-2 bg-red-500/10 hover:bg-red-500/20 border border-red-500/30 text-red-400 rounded-xl text-xs font-semibold flex items-center space-x-1.5 transition"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete Account</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 p-6 max-w-[1600px] w-full mx-auto">
          <div className="lg:col-span-3 flex flex-col space-y-4">
            
            {/* Main Video Call Screen Box */}
            <div className="relative flex-1 bg-[#090b16]/60 border border-slate-800 rounded-3xl overflow-hidden min-h-[500px] flex items-center justify-center backdrop-blur-md shadow-2xl">
              {activeCall ? (
                <>
                  {/* Aspect Ratio Toggle Button on Top Right of Video Screen */}
                  <button
                    onClick={() => setIsPortrait(!isPortrait)}
                    className="absolute top-4 right-4 z-30 bg-black/70 hover:bg-black/90 text-cyan-400 border border-cyan-500/30 px-3 py-1.5 rounded-xl text-xs font-mono font-bold backdrop-blur-md shadow-lg transition"
                  >
                    Ratio: {isPortrait ? '9:16' : '16:9'}
                  </button>

                  {/* Remote / Main Video Container (Samne wale ki video) */}
                  <div className={`transition-all duration-300 relative overflow-hidden rounded-3xl border border-slate-800 shadow-2xl bg-black ${
                    isPortrait ? 'w-full max-w-[380px] aspect-[9/16]' : 'w-full max-w-[900px] aspect-[16/9]'
                  }`}>
                    <video ref={remoteVideoRef} autoPlay playsInline className="w-full h-full object-cover" />

                    <div className="absolute top-4 left-4 bg-[#05050D]/80 backdrop-blur-md px-3 py-1.5 rounded-xl border border-slate-800 flex items-center space-x-2">
                      <span className="w-2 h-2 rounded-full bg-cyan-400 animate-pulse"></span>
                      <span className="text-xs text-slate-300 font-medium">{activeCall.userId}</span>
                    </div>
                  </div>

                  {/* ALWAYS VISIBLE & Bound-Restricted Draggable Local Video Box (Tumhari apni video) */}
                  <div
                    onMouseDown={handleDragStart}
                    onTouchStart={handleDragStart}
                    style={{ left: `${localPos.x}px`, top: `${localPos.y}px` }}
                    className="fixed z-40 w-36 h-48 sm:w-44 sm:h-60 bg-black/90 rounded-2xl border-2 border-cyan-500/50 overflow-hidden shadow-2xl cursor-grab active:cursor-grabbing select-none"
                    title="Drag to move"
                  >
                    <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover pointer-events-none" />
                    <span className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-sm text-[9px] text-cyan-400 px-2 py-0.5 rounded font-mono">You (Drag)</span>
                  </div>

                  {/* Call Controls Bar */}
                  <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 z-30 flex items-center space-x-3 bg-[#05050D]/90 backdrop-blur-xl border border-slate-800 px-5 py-2.5 rounded-full shadow-[0_0_30px_rgba(0,0,0,0.8)]">
                    <button
                      onClick={toggleAudio}
                      className={`p-3 rounded-full transition-all duration-200 ${isAudioMuted ? 'bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
                      title="Mute Audio"
                    >
                      {isAudioMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    </button>
                    <button
                      onClick={toggleVideo}
                      className={`p-3 rounded-full transition-all duration-200 ${isVideoMuted ? 'bg-red-500 text-white shadow-[0_0_15px_rgba(239,68,68,0.4)]' : 'bg-slate-800 text-slate-200 hover:bg-slate-700'}`}
                      title="Mute Video"
                    >
                      {isVideoMuted ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                    </button>

                    <button
                      onClick={switchCamera}
                      className="p-3 bg-slate-800 hover:bg-slate-700 text-cyan-400 rounded-full transition-all duration-200 border border-slate-700 hover:border-cyan-500/40"
                      title="Switch Camera"
                    >
                      <SwitchCamera className="w-5 h-5" />
                    </button>

                    <button
                      onClick={endCall}
                      className="p-3 bg-red-600 hover:bg-red-500 text-white rounded-full transition-all duration-200 shadow-[0_0_20px_rgba(220,38,38,0.4)] transform hover:scale-105"
                      title="End Call"
                    >
                      <PhoneOff className="w-5 h-5" />
                    </button>
                  </div>
                </>
              ) : (
                <div className="text-center p-8 max-w-sm">
                  <div className="w-20 h-20 rounded-3xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mx-auto mb-5 shadow-[0_0_30px_rgba(6,182,212,0.2)]">
                    <Video className="w-10 h-10 text-cyan-400" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-200">Ready to Connect</h3>
                  <p className="text-slate-500 text-xs mt-2 leading-relaxed">Select an active node from the network list on the right to start an encrypted video call.</p>
                </div>
              )}

              {incomingCall && (
                <div className="absolute inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 z-50">
                  <div className="bg-[#090b16] border border-cyan-500/40 rounded-3xl p-8 text-center shadow-[0_0_60px_rgba(6,182,212,0.25)] max-w-sm w-full relative overflow-hidden">
                    <div className="w-16 h-16 bg-cyan-500/10 border border-cyan-400/30 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
                      <PhoneCall className="w-8 h-8 text-cyan-400" />
                    </div>
                    <h4 className="text-xl font-bold text-white mb-1">Incoming Signal</h4>
                    <p className="text-slate-400 text-xs mb-6">User <strong className="text-cyan-400">{incomingCall.fromUser}</strong> requests a stream link...</p>
                    <div className="flex space-x-3">
                      <button
                        onClick={acceptCall}
                        className="flex-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold py-3 rounded-xl transition shadow-[0_0_20px_rgba(16,185,129,0.3)]"
                      >
                        Accept
                      </button>
                      <button
                        onClick={() => setIncomingCall(null)}
                        className="flex-1 bg-slate-800 hover:bg-slate-700 text-slate-300 font-bold py-3 rounded-xl transition border border-slate-700"
                      >
                        Decline
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col space-y-6">
            <div className="bg-[#090b16]/60 border border-slate-800 rounded-3xl p-5 flex-1 flex flex-col backdrop-blur-md">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex items-center justify-between">
                <span>Active Nodes</span>
                <span className="bg-slate-800 px-2 py-0.5 rounded-full text-[10px] text-cyan-400 font-mono">{onlineUsers.length}</span>
              </h2>
              <div className="flex-1 overflow-y-auto space-y-2.5 pr-1 max-h-56 lg:max-h-none">
                {onlineUsers.length === 0 ? (
                  <div className="text-slate-500 text-xs py-8 text-center border border-dashed border-slate-800 rounded-2xl">
                    No peer nodes online
                  </div>
                ) : (
                  onlineUsers.map((user) => (
                    <div
                      key={user.socketId}
                      className="flex items-center justify-between p-3.5 bg-[#0d1124]/50 border border-slate-800 rounded-2xl hover:border-cyan-500/40 transition-all group"
                    >
                      <div className="flex items-center space-x-3">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-slate-800 to-slate-700 flex items-center justify-center text-xs font-bold text-cyan-400 border border-slate-700">
                          {user.userId.substring(0, 2).toUpperCase()}
                        </div>
                        <div>
                          <span className="text-xs font-semibold text-slate-200 block">{user.userId}</span>
                          <span className="text-[10px] text-emerald-400 flex items-center space-x-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 inline-block"></span>
                            <span>Ready</span>
                          </span>
                        </div>
                      </div>
                      <button
                        onClick={() => startCall(user)}
                        disabled={!!activeCall}
                        className="p-2.5 bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 rounded-xl transition disabled:opacity-30 border border-cyan-500/20 group-hover:border-cyan-500/40"
                      >
                        <Video className="w-4 h-4" />
                      </button>
                    </div>
                  ))
                )}
              </div>
            </div>

            {activeCall && (
              <div className="flex flex-col space-y-4">
                <div className="bg-[#090b16]/60 border border-slate-800 rounded-3xl p-5 flex flex-col h-72 backdrop-blur-md">
                  <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Stream Chat</h2>
                  <div className="flex-1 overflow-y-auto space-y-2.5 mb-3 text-xs pr-1">
                    {messages.map((msg, idx) => (
                      <div
                        key={idx}
                        className={`p-3 rounded-2xl max-w-[85%] ${
                          msg.from === userId
                            ? 'bg-gradient-to-r from-pink-600/30 to-cyan-600/30 border border-pink-500/30 ml-auto text-pink-100'
                            : 'bg-slate-800/60 border border-slate-700/50 text-slate-300'
                        }`}
                      >
                        <span className="block text-[10px] font-bold text-slate-400 mb-1">{msg.from}</span>
                        {msg.text}
                      </div>
                    ))}
                    <div ref={chatBottomRef} />
                  </div>
                  <form onSubmit={sendMessage} className="flex space-x-2">
                    <input
                      type="text"
                      placeholder="Send message..."
                      value={chatInput}
                      onChange={(e) => setChatInput(e.target.value)}
                      className="flex-1 bg-[#0d1124] border border-slate-800 rounded-xl px-3.5 py-2.5 text-xs text-white focus:outline-none focus:border-cyan-400"
                    />
                    <button
                      type="submit"
                      className="bg-cyan-500 hover:bg-cyan-400 text-slate-950 p-2.5 rounded-xl transition font-bold"
                    >
                      <Send className="w-4 h-4" />
                    </button>
                  </form>
                </div>

                {/* Fixed visible Ad Box below stream chat */}
                <div className="bg-[#090b16]/80 border border-slate-800 rounded-3xl p-4 backdrop-blur-md min-h-[100px] flex flex-col items-center justify-center">
                  <div className="text-[10px] text-slate-500 uppercase tracking-widest mb-2 font-mono">Sponsored Ad</div>
                  <div className="w-full flex items-center justify-center overflow-hidden">
                    <AdScriptBox src="//conventionalresponse.com/b.XJVYssd-GDl/0/YoW/cS/Ne-mw9suKZPUilrkbPKT/cj0tMujoU" className="w-full min-h-[60px]" />
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}