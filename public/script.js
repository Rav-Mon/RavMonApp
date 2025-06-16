let username = null;
const socket = io('/', { transports: ['websocket'], reconnectionAttempts: 5 });
let peer = null;
let currentCall = null;
let callTimerInterval = null;
let stream = null;
let isCalling = false;
let offerTimeout = null;
let callState = 'idle';

const loginScreen = document.getElementById('login-screen');
const chatScreen = document.getElementById('chat-screen');
const messagesDiv = document.getElementById('messages');
const messageInput = document.getElementById('message-input');
const fileInput = document.getElementById('file-input');
const localVideo = document.getElementById('local-video');
const remoteVideo = document.getElementById('remote-video');
const callScreen = document.getElementById('call-screen');
const incomingCallDiv = document.getElementById('incoming-call');
const callTypeSpan = document.getElementById('call-type');
const callerSpan = document.getElementById('caller');
const callTimer = document.getElementById('call-timer');
const profilePic = document.getElementById('profile-pic');
const profilePicInput = document.getElementById('profile-pic-input');
const loginButtons = loginScreen.querySelectorAll('button');
const chatPartner = document.getElementById('chat-partner');
const partnerStatus = document.getElementById('partner-status');
const sendBtn = document.getElementById('send-btn');

function showConnecting(show) {
  loginButtons.forEach(btn => btn.disabled = show);
  const status = document.getElementById('connection-status') || document.createElement('p');
  status.id = 'connection-status';
  status.textContent = show ? 'Connecting...' : '';
  status.style.color = '#2ecc71';
  status.style.textAlign = 'center';
  if (show && !status.parentElement) loginScreen.appendChild(status);
  else if (!show && status.parentElement) status.remove();
}

socket.on('connect', () => {
  console.log('Socket.IO connected');
  showConnecting(false);
});

socket.on('connect_error', err => {
  console.error('Socket.IO error:', err.message);
  showConnecting(false);
  alert(`Connection failed: ${err.message}.`);
});

function login(user) {
  showConnecting(true);
  username = user;
  socket.emit('login', username);
}

socket.on('login-success', ({ username: user, messages }) => {
  console.log('Login successful:', user);
  showConnecting(false);
  loginScreen.style.display = 'none';
  chatScreen.style.display = 'flex';
  chatPartner.textContent = user === 'Rav' ? 'Mon' : 'Rav';
  messages.forEach(displayMessage);
  initPeer();
});

socket.on('login-failed', message => {
  console.log('Login failed:', message);
  showConnecting(false);
  alert(message || 'Login failed!');
  socket.disconnect();
  setTimeout(() => socket.connect(), 2000);
});

function initPeer() {
  if (peer && !peer.destroyed) return;
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  const iceServers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'turn:relay.metered.ca:443', username: 'test', credential: 'test' }
  ];
  try {
    peer = new Peer({
      host: '0.peerjs.com',
      secure: true,
      port: 443,
      config: { iceServers },
      debug: 3
    });
    peer.on('open', id => {
      console.log('PeerJS ID:', id);
      socket.emit('peer-id', id);
    });
    peer.on('error', err => {
      console.error('PeerJS error:', err.type, err.message);
      if (['server-error', 'disconnected'].includes(err.type)) {
        peer.destroy();
        peer = null;
        setTimeout(initPeer, 5000);
      } else {
        alert(`Call error: ${err.type}.`);
        endCall(`PeerJS error: ${err.type}`);
      }
    });
    setupPeer();
  } catch (err) {
    console.error('PeerJS init error:', err.message);
    setTimeout(initPeer, 5000);
  }
}

function setupPeer() {
  if (!peer) {
    setTimeout(initPeer, 5000);
    return;
  }
  peer.on('call', call => {
    console.log('Incoming call from:', call.peer);
    if (isCalling || currentCall || callState !== 'idle') {
      call.close();
      socket.emit('reject-call', { to: call.options.metadata.from });
      return;
    }
    currentCall = call;
    callState = 'initiating';
    incomingCallDiv.style.display = 'block';
    callTypeSpan.textContent = call.options.metadata.type;
    callerSpan.textContent = username === 'Rav' ? 'Mon' : 'Rav';
    incomingCallDiv.dataset.from = call.options.metadata.from;
    incomingCallDiv.dataset.type = call.options.metadata.type;
    setupCallHandlers(call);
  });
}

function setupCallHandlers(call) {
  call.on('stream', remoteStream => {
    console.log('Remote stream received');
    remoteVideo.srcObject = remoteStream;
    callState = 'active';
    startCallTimer();
  });
  call.on('error', err => endCall(`Call error: ${err.message}`));
  call.on('close', () => endCall('Call closed'));
}

function startCall(type) {
  if (isCalling || currentCall || callState !== 'idle') {
    console.log('Call in progress, ignoring');
    return;
  }
  isCalling = true;
  callState = 'initiating';
  const to = username === 'Rav' ? 'Mon' : 'Rav';
  socket.emit('check-peer', to, ({ available, peerId }) => {
    if (!available || !peerId) {
      alert(`${to} is not online.`);
      endCall('Peer not available');
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: type === 'video', audio: true })
      .then(localStream => {
        stream = localStream;
        localVideo.srcObject = stream;
        callScreen.style.display = 'block';
        currentCall = peer.call(peerId, stream, { metadata: { type, from: username } });
        callState = 'initiating';
        setupCallHandlers(currentCall);
        socket.emit('call-user', { to, type, offer: 'offer', username });
        offerTimeout = setTimeout(() => {
          if (callState === 'initiating') {
            endCall('Call timed out');
          }
        }, 30000);
      })
      .catch(err => {
        console.error('Media error:', err.message);
        alert(`Media error: ${err.message}.`);
        endCall('Media error');
      });
  });
}

function acceptCall() {
  if (!currentCall || callState !== 'initiating') {
    console.log('No call to accept or invalid state');
    return;
  }
  const type = incomingCallDiv.dataset.type;
  navigator.mediaDevices.getUserMedia({ video: type === 'video', audio: true })
    .then(localStream => {
      stream = localStream;
      localVideo.srcObject = stream;
      callScreen.style.display = 'block';
      incomingCallDiv.style.display = 'none';
      currentCall.answer(stream);
      callState = 'active';
      socket.emit('accept-call', { to: incomingCallDiv.dataset.from });
      startCallTimer();
    })
    .catch(err => {
      console.error('Media error:', err.message);
      alert(`Media error: ${err.message}.`);
      endCall('Media error');
    });
}

function rejectCall() {
  if (currentCall) {
    currentCall.close();
    socket.emit('reject-call', { to: incomingCallDiv.dataset.from });
  }
  incomingCallDiv.style.display = 'none';
  endCall('Call rejected');
}

socket.on('call-user', ({ from, username: caller, type }) => {
  console.log('Incoming call from:', caller, type);
});

socket.on('call-accepted', () => {
  clearTimeout(offerTimeout);
  callState = 'active';
  startCallTimer();
});

socket.on('call-rejected', () => endCall('Call rejected by peer'));

socket.on('call-ended', () => endCall('Call ended by peer'));

socket.on('ice-candidate', ({ candidate }) => {
  if (currentCall) {
    currentCall.peerConnection.addIceCandidate(new RTCIceCandidate(candidate))
      .catch(err => console.error('ICE candidate error:', err));
  }
});

function endCall(reason) {
  console.log('Ending call:', reason);
  clearTimeout(offerTimeout);
  if (currentCall) {
    currentCall.close();
    currentCall = null;
  }
  if (stream) {
    stream.getTracks().forEach(track => track.stop());
    stream = null;
  }
  if (callTimerInterval) {
    clearInterval(callTimerInterval);
    callTimerInterval = null;
    callTimer.textContent = '00:00';
  }
  localVideo.srcObject = null;
  remoteVideo.srcObject = null;
  callScreen.style.display = 'none';
  incomingCallDiv.style.display = 'none';
  isCalling = false;
  callState = 'ending';
  setTimeout(() => {
    callState = 'idle';
    console.log('Call state reset');
  }, 5000);
}

function startCallTimer() {
  let seconds = 0;
  callTimerInterval = setInterval(() => {
    seconds++;
    const minutes = Math.floor(seconds / 60);
    const secs = seconds % 60;
    callTimer.textContent = `${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }, 1000);
}

function sendMessage() {
  const text = messageInput.value.trim();
  const file = fileInput.files[0];
  if (!text && !file) return;
  if (file && file.size > 2 * 1024 * 1024) {
    alert('File size must be < 2MB.');
    fileInput.value = '';
    return;
  }
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      socket.emit('message', { username, text, file: reader.result, fileName: file.name });
      messageInput.value = '';
      fileInput.value = '';
    };
    reader.readAsDataURL(file);
  } else {
    socket.emit('message', { username, text });
    messageInput.value = '';
  }
}

function displayMessage(message) {
  const messageDiv = document.createElement('div');
  messageDiv.className = `message ${message.username === username ? 'sent' : 'received'}`;
  messageDiv.dataset.id = message.id;
  const time = new Date(message.timestamp).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
  let content = `<p><strong>${message.username}</strong> <span class="timestamp">${time}</span></p>`;
  if (message.text) content += `<p>${message.text}</p>`;
  if (message.file) {
    if (message.fileName.match(/\.(jpg|jpeg|png|gif)$/i)) {
      content += `<img src="${message.file}" alt="${message.fileName}" style="max-width:200px;">`;
    } else {
      content += `<a href="${message.file}" download="${message.fileName}">${message.fileName}</a>`;
    }
  }
  if (message.username === username) {
    content += `<button class="delete-btn" onclick="deleteMessage('${message.id}')">🗑️</button>`;
  }
  messageDiv.innerHTML = content;
  messagesDiv.appendChild(messageDiv);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
}
socket.on('message', displayMessage);

socket.on('messages-updated', updatedMessages => {
  messagesDiv.innerHTML = '';
  updatedMessages.forEach(displayMessage);
  messagesDiv.scrollTop = messagesDiv.scrollHeight;
});

function deleteMessage(id) {
  socket.emit('delete-message', id);
}

socket.on('user-status', users => {
  const partner = username === 'Rav' ? 'Mon' : 'Rav';
  partnerStatus.className = users[partner] && users[partner].connected ? 'status online' : 'status offline';
});

socket.on('profile-pic-updated', ({ username: user, image }) => {
  if (user !== username) {
    document.getElementById('partner-pic').src = image || '/default-pic.png';
  }
});

profilePicInput.addEventListener('change', () => {
  const file = profilePicInput.files[0];
  if (file && file.size > 2 * 1024 * 1024) {
    alert('Profile picture must be < 2MB.');
    profilePicInput.value = '';
    return;
  }
  if (file) {
    const reader = new FileReader();
    reader.onload = () => {
      profilePic.src = reader.result;
      socket.emit('profile-pic', { username, image: reader.result });
    };
    reader.readAsDataURL(file);
  }
});

messageInput.addEventListener('keypress', e => {
  if (e.key === 'Enter') sendMessage();
});

sendBtn.addEventListener('click', sendMessage);
document.getElementById('voice-call-btn').addEventListener('click', () => startCall('voice'));
document.getElementById('video-call-btn').addEventListener('click', () => startCall('video'));
document.getElementById('end-call-btn').addEventListener('click', () => endCall('User ended call'));
document.getElementById('accept-call-btn').addEventListener('click', acceptCall);
document.getElementById('reject-call-btn').addEventListener('click', rejectCall);