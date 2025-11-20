// Frontend logic: login -> connect socket -> find partner -> typing forward/receive
let socket = null;
let me = null;
let partner = null;
let typingTimer = null;

const loginBox = document.getElementById('loginBox');
const lobby = document.getElementById('lobby');
const chatCard = document.getElementById('chatCard');

const usernameInput = document.getElementById('usernameInput');
const loginBtn = document.getElementById('loginBtn');
const loginMsg = document.getElementById('loginMsg');

const findBtn = document.getElementById('findBtn');
const stopBtn = document.getElementById('stopBtn');
const lobbyMsg = document.getElementById('lobbyMsg');
const meName = document.getElementById('meName');

const partnerName = document.getElementById('partnerName');
const myInput = document.getElementById('myInput');
const partnerText = document.getElementById('partnerText');
const status = document.getElementById('status');
const unpairBtn = document.getElementById('unpairBtn');

// LOGIN
loginBtn.addEventListener('click', async () => {
  const username = usernameInput.value.trim();
  if (!username) {
    loginMsg.textContent = 'Enter a username';
    return;
  }
  loginMsg.textContent = 'Logging in...';

  try {
    const res = await fetch('/login', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username })
    });
    if (!res.ok) {
      loginMsg.textContent = 'Login failed';
      return;
    }
    const data = await res.json();
    me = data;
    loginBox.classList.add('hidden');
    lobby.classList.remove('hidden');
    meName.textContent = me.username;

    // connect socket
    socket = io();

    socket.on('connect', () => {
      socket.emit('auth', { userId: me.userId });
    });

    socket.on('auth_ok', (d) => {
      console.log('auth ok', d);
      lobbyMsg.textContent = 'Connected. Click "Find partner" to start.';
    });

    socket.on('auth_failed', () => {
      loginMsg.textContent = 'Auth failed. Refresh and login again.';
    });

    socket.on('waiting', () => {
      lobbyMsg.textContent = 'Waiting for a partner...';
      findBtn.classList.add('hidden');
      stopBtn.classList.remove('hidden');
    });

    socket.on('paired', (d) => {
      partner = { userId: d.partnerId, username: d.partnerName };
      lobby.classList.add('hidden');
      chatCard.classList.remove('hidden');
      partnerName.textContent = partner.username;
      partnerText.textContent = '';
      status.textContent = 'Paired — start typing!';
      findBtn.classList.remove('hidden');
      stopBtn.classList.add('hidden');
    });

    socket.on('typing', (d) => {
      partnerText.textContent = d.text || '';
    });

    socket.on('stop_typing', () => {
      // optional: show partner stopped typing
    });

    socket.on('partner_disconnected', () => {
      status.textContent = 'Partner disconnected.';
      partner = null;
      chatCard.classList.add('hidden');
      lobby.classList.remove('hidden');
    });

  } catch (err) {
    loginMsg.textContent = 'Network error';
    console.error(err);
  }
});

// FIND / STOP
findBtn.addEventListener('click', () => {
  if (!socket) return;
  socket.emit('find_partner');
  lobbyMsg.textContent = 'Searching...';
});

stopBtn.addEventListener('click', () => {
  if (!socket) return;
  socket.emit('stop_search');
  lobbyMsg.textContent = 'Search stopped';
  findBtn.classList.remove('hidden');
  stopBtn.classList.add('hidden');
});

// unpair (end chat)
unpairBtn.addEventListener('click', () => {
  // simplest way: refresh client state
  if (socket) {
    socket.emit('stop_search');
    socket.disconnect();
    socket = null;
  }
  partner = null;
  chatCard.classList.add('hidden');
  loginBox.classList.remove('hidden');
  lobby.classList.add('hidden');
  me = null;
  usernameInput.value = '';
});

// TYPING: emit keystrokes on input event
myInput.addEventListener('input', () => {
  if (!socket) return;
  const text = myInput.value;
  socket.emit('typing', { text });

  // optional: throttle stop_typing event (we won't spam)
  if (typingTimer) clearTimeout(typingTimer);
  typingTimer = setTimeout(() => {
    socket.emit('stop_typing');
  }, 1000);
});
