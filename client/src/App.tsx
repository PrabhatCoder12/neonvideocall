import React, { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { Video, VideoOff, Mic, MicOff, PhoneOff, Send, LogOut, Shield, Trash2, PhoneCall, SwitchCamera } from 'lucide-react';

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
  role: string;
}

interface RemotePeerStream {
  socketId: string;
  userId: string;
  stream: MediaStream;
}

function AdBox({ scriptContent, width = '250px', height = '300px' }: { scriptContent: string; width?: string; height?: string }) {
  const divRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!divRef.current) return;
    divRef.current.innerHTML = '';
    
    const range = document.createRange();
    range.selectNode(divRef.current);
    const fragment = range.createContextualFragment(scriptContent);
    divRef.current.appendChild(fragment);
  }, [scriptContent]);

  return (
    <div 
      ref={divRef} 
      style={{ width, height, minWidth: width, minHeight: height }}
      className="bg-[#090b16]/70 border border-slate-800/80 backdrop-blur-xl rounded-2xl flex flex-col items-center justify-center overflow-hidden shadow-xl"
    />
  );
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

  // WebRTC / Call States
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>([]);
  const [isInCall, setIsInCall] = useState(false);
  const [remotePeers, setRemotePeers] = useState<RemotePeerStream[]>([]);
  const [incomingCall, setIncomingCall] = useState<{ fromSocketId: string; fromUser: string; offer: RTCSessionDescriptionInit } | null>(null);
  
  const [isAudioMuted, setIsAudioMuted] = useState(false);
  const [isVideoMuted, setIsVideoMuted] = useState(false);
  const [facingMode, setFacingMode] = useState<'user' | 'environment'>('user');

  // Chat State
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState('');

  const socketRef = useRef<Socket | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const localVideoRef = useRef<HTMLVideoElement | null>(null);
  
  const peersRef = useRef<Map<string, RTCPeerConnection>>(new Map());
  const chatBottomRef = useRef<HTMLDivElement | null>(null);

  // User's Ad Scripts (250x300)
  const leftAdScript = `<script>
(function(vzic){
var d = document,
    s = d.createElement('script'),
    l = d.currentScript || d.scripts[d.scripts.length - 1];
s.settings = vzic || {};
s.src = "//conventionalresponse.com/bXXSV.sXddG/lD0/YxWzcA/VeQmC9/uXZyUqlTkePxTXce0rMyjyUV2/MOT/cltpNPz/QuycNRTOYcy_MsQh";
s.async = true;
s.referrerPolicy = 'no-referrer-when-downgrade';
l.parentNode.insertBefore(s, l);
})({})
</script>`;

  const rightAdScript = `<script>
(function(pgnlm){
var d = document,
    s = d.createElement('script'),
    l = d.currentScript || d.scripts[d.scripts.length - 1];
s.settings = pgnlm || {};
s.src = "//conventionalresponse.com/bHXAVRsxd.GUl/0nY/WEcu/yeJm/9-uXZuUslhk/PxTocr0LMzjUUd1MOHDwUGt-NtzSQXypN/TtU/4/ONQD";
s.async = true;
s.referrerPolicy = 'no-referrer-when-downgrade';
l.parentNode.insertBefore(s, l);
})({})
</script>`;

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

    socket.on('call-made', async (data: { offer: RTCSessionDescriptionInit; socket: string; fromUser: string }) => {
      if (isInCall) {
        // Agar pehle se call mein hain, toh automatic accept karke group call expand karo
        await autoAcceptCall(data.socket, data.fromUser, data.offer);
      } else {
        setIncomingCall({ fromSocketId: data.socket, fromUser: data.fromUser, offer: data.offer });
      }
    });

    socket.on('answer-made', async (data: { socket: string; answer: RTCSessionDescriptionInit }) => {
      const pc = peersRef.current.get(data.socket);
      if (pc) {
        try {
          if (pc.signalingState === 'have-local-offer') {
            await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
          }
        } catch (e) {
          console.error("Set remote answer error:", e);
        }
      }
    });

    socket.on('ice-candidate-received', async (data: { socket: string; candidate: RTCIceCandidateInit }) => {
      const pc = peersRef.current.get(data.socket);
      if (pc && data.candidate) {
        try {
          await pc.addIceCandidate(new RTCIceCandidate(data.candidate));
        } catch (e) {
          console.error("ICE error:", e);
        }
      }
    });

    socket.on('call-hung-up', (data: { socket: string }) => {
      removePeer(data.socket);
    });

    socket.on('receive-message', (data: { from: string; text: string }) => {
      setMessages((prev) => [...prev, data]);
    });

    return () => { socket.disconnect(); };
  }, [token, userId, isInCall]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const removePeer = (targetSocketId: string) => {
    const pc = peersRef.current.get(targetSocketId);
    if (pc) {
      pc.close();
      peersRef.current.delete(targetSocketId);
    }
    setRemotePeers((prev) => prev.filter((p) => p.socketId !== targetSocketId));
  };

  const getOrCreatePeerConnection = (targetSocketId: string, targetUserId: string, stream: MediaStream) => {
    if (peersRef.current.has(targetSocketId)) {
      return peersRef.current.get(targetSocketId)!;
    }

    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    peersRef.current.set(targetSocketId, pc);

    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });

    pc.ontrack = (event) => {
      const incomingStream = event.streams[0];
      setRemotePeers((prev) => {
        const exists = prev.find((p) => p.socketId === targetSocketId);
        if (exists) {
          return prev.map((p) => p.socketId === targetSocketId ? { ...p, stream: incomingStream } : p);
        }
        return [...prev, { socketId: targetSocketId, userId: targetUserId, stream: incomingStream }];
      });
    };

    pc.onicecandidate = (event) => {
      if (event.candidate && socketRef.current) {
        socketRef.current.emit('ice-candidate', { to: targetSocketId, candidate: event.candidate });
      }
    };

    return pc;
  };

  const startCall = async (targetUser: OnlineUser) => {
    setIsInCall(true);
    let stream = localStreamRef.current;
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (e) {
        console.error("Media permission error:", e);
        setIsInCall(false);
        return;
      }
    }

    const pc = getOrCreatePeerConnection(targetUser.socketId, targetUser.userId, stream);
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      socketRef.current?.emit('call-user', { to: targetUser.socketId, offer, fromUser: userId });
    } catch (e) {
      console.error("Error creating offer:", e);
    }
  };

  const acceptCall = async () => {
    if (!incomingCall) return;
    setIsInCall(true);
    
    let stream = localStreamRef.current;
    if (!stream) {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode }, audio: true });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (e) {
        console.error("Media permission error:", e);
        return;
      }
    }

    const pc = getOrCreatePeerConnection(incomingCall.fromSocketId, incomingCall.fromUser, stream);
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(incomingCall.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current?.emit('make-answer', { to: incomingCall.fromSocketId, answer });
    } catch (e) {
      console.error("Error accepting call:", e);
    }
    setIncomingCall(null);
  };

  const autoAcceptCall = async (fromSocketId: string, fromUser: string, offer: RTCSessionDescriptionInit) => {
    let stream = localStreamRef.current;
    if (!stream) return;

    const pc = getOrCreatePeerConnection(fromSocketId, fromUser, stream);
    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      socketRef.current?.emit('make-answer', { to: fromSocketId, answer });
    } catch (e) {
      console.error("Error auto-accepting call:", e);
    }
  };

  const endCall = () => {
    peersRef.current.forEach((pc, socketId) => {
      socketRef.current?.emit('hang-up', { to: socketId });
      pc.close();
    });
    peersRef.current.clear();
    setRemotePeers([]);

    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach((track) => track.stop());
      localStreamRef.current = null;
    }
    setIsInCall(false);
    setIncomingCall(null);
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

      peersRef.current.forEach((pc) => {
        const videoTrack = stream.getVideoTracks()[0];
        const senders = pc.getSenders();
        const videoSender = senders.find((s) => s.track && s.track.kind === 'video');
        if (videoSender && videoTrack) videoSender.replaceTrack(videoTrack);
      });
    } catch (e) {
      console.error("Camera switch error:", e);
    }
  };

  const sendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;

    remotePeers.forEach((peer) => {
      socketRef.current?.emit('send-message', { to: peer.socketId, text: chatInput });
    });
    setMessages((prev) => [...prev, { from: userId, text: chatInput }]);
    setChatInput('');
  };

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
    if (showAdminPanel && userRole === 'admin') fetchUsersForAdmin();
  }, [showAdminPanel]);

  const handleDeleteUser = async (targetId: string) => {
    if (!window.confirm(`Delete user "${targetId}"?`)) return;
    try {
      const res = await fetch(`${SOCKET_SERVER_URL}/api/admin/users/${targetId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      if (res.ok) {
        setAdminMsg(`Deleted ${targetId}`);
        fetchUsersForAdmin();
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

  // --- LOGIN SCREEN ---
  if (!token) {
    return (
      <div className="min-h-screen bg-[#05050D] flex items-center justify-between p-4 sm:p-8 relative overflow-hidden text-white font-sans select-none">
        <div className="absolute -top-32 -left-32 w-[600px] h-[600px] bg-pink-600/20 rounded-full blur-[140px] pointer-events-none"></div>
        <div className="absolute -bottom-32 -right-32 w-[600px] h-[600px] bg-cyan-500/20 rounded-full blur-[140px] pointer-events-none"></div>

        <div className="hidden xl:flex flex-col items-center justify-center z-10">
          <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-2">Advertisement</span>
          <AdBox scriptContent={leftAdScript} width="250px" height="300px" />
        </div>

        <div className="relative z-10 w-full max-w-[420px] mx-auto">
          <div className="p-[2px] rounded-[36px] bg-gradient-to-r from-[#f43f5e] via-[#d946ef] to-[#06b6d4]">
            <div className="bg-[#090b16]/95 backdrop-blur-3xl rounded-[34px] p-8 sm:p-10 text-center">
              <h1 className="text-3xl font-black tracking-widest mb-1">
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#ff3b94] via-[#e040fb] to-[#00e5ff]">NEON</span>
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#00e5ff] to-[#00b0ff]">CONNECT</span>
              </h1>
              <p className="text-slate-400 text-sm mb-8">{isSignup ? 'Create account' : 'Sign in'}</p>
              {authError && <div className="mb-6 p-3 bg-red-500/10 text-red-400 text-xs rounded-xl">{authError}</div>}
              <form onSubmit={handleAuth} className="space-y-4">
                <input
                  type="text"
                  placeholder="User ID"
                  value={inputUserId}
                  onChange={(e) => setInputUserId(e.target.value)}
                  className="w-full bg-[#0d1124] border border-slate-800 rounded-2xl py-3.5 px-4 text-sm text-white focus:outline-none focus:border-cyan-400"
                  required
                />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="Password"
                  value={inputPassword}
                  onChange={(e) => setInputPassword(e.target.value)}
                  className="w-full bg-[#0d1124] border border-slate-800 rounded-2xl py-3.5 px-4 text-sm text-white focus:outline-none focus:border-cyan-400"
                  required
                />
                <button type="submit" className="w-full h-13 bg-gradient-to-r from-[#ff2a8d] to-[#00d4ff] text-white font-semibold rounded-2xl">
                  {isSignup ? 'Create Account' : 'Sign In'}
                </button>
              </form>
              <div className="mt-8 text-xs text-slate-400">
                <button type="button" onClick={() => setIsSignup(!isSignup)} className="text-cyan-400 underline">
                  {isSignup ? 'Already have an account? Sign In' : "Don't have an account? Create One"}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="hidden xl:flex flex-col items-center justify-center z-10">
          <span className="text-[10px] uppercase tracking-widest text-slate-500 font-semibold mb-2">Advertisement</span>
          <AdBox scriptContent={rightAdScript} width="250px" height="300px" />
        </div>
      </div>
    );
  }

  // --- MAIN APP SCREEN ---
  return (
    <div className="min-h-screen bg-[#05050D] text-white flex flex-col font-sans">
      <header className="border-b border-slate-800/80 bg-[#090b16]/80 backdrop-blur-xl px-8 py-4 flex justify-between items-center sticky top-0 z-50">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-r from-pink-500 to-cyan-400 flex items-center justify-center font-black text-slate-950">N</div>
          <h1 className="text-xl font-black tracking-wider bg-gradient-to-r from-pink-500 via-purple-400 to-cyan-400 bg-clip-text text-transparent">NEONCONNECT</h1>
        </div>
        <div className="flex items-center space-x-4">
          {userRole === 'admin' && (
            <button onClick={() => setShowAdminPanel(!showAdminPanel)} className="px-4 py-2 bg-amber-500/10 text-amber-400 rounded-xl text-xs font-semibold flex items-center space-x-2">
              <Shield className="w-4 h-4" /><span>Admin Panel</span>
            </button>
          )}
          <div className="bg-[#0d1124] border border-slate-800 px-4 py-2 rounded-xl text-xs">Node: <strong className="text-cyan-400">{userId}</strong></div>
          <button onClick={handleLogout} className="p-2.5 text-slate-400 hover:text-red-400"><LogOut className="w-4 h-4" /></button>
        </div>
      </header>

      {showAdminPanel && userRole === 'admin' ? (
        <div className="p-6 max-w-4xl w-full mx-auto">
          <div className="bg-[#090b16]/90 border border-amber-500/40 rounded-3xl p-6">
            <h2 className="text-lg font-bold text-amber-400 mb-4">Admin Dashboard</h2>
            {adminMsg && <div className="mb-4 p-3 bg-amber-500/10 text-amber-400 text-xs rounded-xl">{adminMsg}</div>}
            <div className="space-y-3 max-h-96 overflow-y-auto">
              {allUsers.map((u) => (
                <div key={u.userId} className="flex justify-between items-center p-4 bg-[#0d1124] rounded-2xl">
                  <span>{u.userId} ({u.role})</span>
                  {u.role !== 'admin' && <button onClick={() => handleDeleteUser(u.userId)} className="text-red-400"><Trash2 className="w-4 h-4" /></button>}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : (
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-4 gap-6 p-6 max-w-[1600px] w-full mx-auto">
          <div className="lg:col-span-3 flex flex-col space-y-4">
            <div className="relative flex-1 bg-[#090b16]/60 border border-slate-800 rounded-3xl overflow-hidden min-h-[500px] p-4 flex flex-col items-center justify-center backdrop-blur-md shadow-2xl">
              {isInCall ? (
                <>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full h-full max-w-5xl items-center justify-center">
                    <div className="relative bg-black rounded-2xl border-2 border-cyan-500/50 overflow-hidden shadow-2xl aspect-[4/3] flex items-center justify-center">
                      <video ref={localVideoRef} autoPlay playsInline muted className="w-full h-full object-cover" />
                      <span className="absolute bottom-2 left-2 bg-black/70 text-[10px] text-cyan-400 px-2 py-0.5 rounded font-mono">You ({userId})</span>
                    </div>

                    {remotePeers.map((peer) => (
                      <RemoteVideoBox key={peer.socketId} peer={peer} />
                    ))}
                  </div>

                  <div className="mt-6 flex items-center space-x-3 bg-[#05050D]/90 backdrop-blur-xl border border-slate-800 px-6 py-3 rounded-full shadow-2xl z-30">
                    <button onClick={toggleAudio} className={`p-3 rounded-full ${isAudioMuted ? 'bg-red-500' : 'bg-slate-800'}`}>
                      {isAudioMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
                    </button>
                    <button onClick={toggleVideo} className={`p-3 rounded-full ${isVideoMuted ? 'bg-red-500' : 'bg-slate-800'}`}>
                      {isVideoMuted ? <VideoOff className="w-5 h-5" /> : <Video className="w-5 h-5" />}
                    </button>
                    <button onClick={switchCamera} className="p-3 bg-slate-800 text-cyan-400 rounded-full"><SwitchCamera className="w-5 h-5" /></button>
                    <button onClick={endCall} className="p-3 bg-red-600 text-white rounded-full"><PhoneOff className="w-5 h-5" /></button>
                  </div>
                </>
              ) : (
                <div className="text-center p-8 max-w-sm">
                  <div className="w-20 h-20 rounded-3xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center mx-auto mb-5">
                    <Video className="w-10 h-10 text-cyan-400" />
                  </div>
                  <h3 className="text-xl font-bold text-slate-200">Ready to Call</h3>
                  <p className="text-slate-500 text-xs mt-2">Select any online user from the right list to start a call.</p>
                </div>
              )}

              {incomingCall && (
                <div className="absolute inset-0 bg-black/85 backdrop-blur-md flex items-center justify-center p-4 z-50">
                  <div className="bg-[#090b16] border border-cyan-500/40 rounded-3xl p-8 text-center max-w-sm w-full">
                    <PhoneCall className="w-8 h-8 text-cyan-400 mx-auto mb-4 animate-bounce" />
                    <h4 className="text-xl font-bold text-white mb-1">Incoming Call</h4>
                    <p className="text-slate-400 text-xs mb-6"><strong className="text-cyan-400">{incomingCall.fromUser}</strong> is calling you...</p>
                    <div className="flex space-x-3">
                      <button onClick={acceptCall} className="flex-1 bg-emerald-500 text-slate-950 font-bold py-3 rounded-xl">Accept</button>
                      <button onClick={() => setIncomingCall(null)} className="flex-1 bg-slate-800 text-slate-300 py-3 rounded-xl">Decline</button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="flex flex-col space-y-6">
            <div className="bg-[#090b16]/60 border border-slate-800 rounded-3xl p-5 flex-1 flex flex-col backdrop-blur-md">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-4 flex justify-between">
                <span>Network Nodes</span>
                <span className="text-cyan-400">{onlineUsers.length}</span>
              </h2>
              <div className="flex-1 overflow-y-auto space-y-2.5">
                {onlineUsers.map((user) => (
                  <div key={user.socketId} className="flex items-center justify-between p-3.5 bg-[#0d1124] border border-slate-800 rounded-2xl">
                    <span className="text-xs font-semibold">{user.userId}</span>
                    <button onClick={() => startCall(user)} className="p-2.5 bg-cyan-500/10 text-cyan-400 rounded-xl hover:bg-cyan-500/20 transition">
                      <Video className="w-4 h-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>

            {isInCall && (
              <div className="bg-[#090b16]/60 border border-slate-800 rounded-3xl p-5 flex flex-col h-72">
                <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Group Chat</h2>
                <div className="flex-1 overflow-y-auto space-y-2.5 mb-3 text-xs">
                  {messages.map((msg, idx) => (
                    <div key={idx} className="p-2.5 rounded-xl bg-slate-800/60 text-slate-300">
                      <span className="block text-[10px] font-bold text-cyan-400">{msg.from}</span>
                      {msg.text}
                    </div>
                  ))}
                  <div ref={chatBottomRef} />
                </div>
                <form onSubmit={sendMessage} className="flex space-x-2">
                  <input
                    type="text"
                    placeholder="Broadcast message..."
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    className="flex-1 bg-[#0d1124] border border-slate-800 rounded-xl px-3 py-2 text-xs text-white"
                  />
                  <button type="submit" className="bg-cyan-500 text-slate-950 p-2 rounded-xl"><Send className="w-4 h-4" /></button>
                </form>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RemoteVideoBox({ peer }: { peer: RemotePeerStream }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current && peer.stream) {
      videoRef.current.srcObject = peer.stream;
    }
  }, [peer.stream]);

  return (
    <div className="relative bg-black rounded-2xl border-2 border-slate-700 overflow-hidden shadow-2xl aspect-[4/3] flex items-center justify-center">
      <video ref={videoRef} autoPlay playsInline className="w-full h-full object-cover" />
      <span className="absolute bottom-2 left-2 bg-black/70 text-[10px] text-emerald-400 px-2 py-0.5 rounded font-mono">{peer.userId}</span>
    </div>
  );
}