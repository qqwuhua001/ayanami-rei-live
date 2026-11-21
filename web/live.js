const el = {
  line: document.getElementById('line'),
  whisper: document.getElementById('whisper'),
  feed: document.getElementById('feed'),
  tok: document.getElementById('tok'),
  cost: document.getElementById('cost'),
  pose: document.getElementById('pose'),
  voice: document.getElementById('voice'),
};

const poses = ['v2_base.png', 'v2_blink.png', 'v2_think.png', 'v2_drink.png', 'v2_phone.png', 'v3_lean.png', 'v4_crouch.png', 'v3_holdup.png', 'v3_window.png'];
let typing = null;
let idleTimer = null;

function setIdle() {
  el.whisper.textContent = '自己待着';
  el.line.classList.add('silent');
}

function typeLine(text, author = '绫波丽') {
  clearInterval(typing);
  el.line.classList.remove('silent');
  el.whisper.textContent = author === '绫波丽' ? '在说话' : `回 ${author}`;
  const body = text.length > 54 ? `${text.slice(0, 53)}…` : text;
  let i = 0;
  el.line.textContent = '';
  typing = setInterval(() => {
    i += 1;
    el.line.textContent = body.slice(0, i);
    if (i >= body.length) {
      clearInterval(typing);
      typing = null;
    }
  }, 90);

  clearTimeout(idleTimer);
  idleTimer = setTimeout(setIdle, 22000);

  if (Math.random() < 0.55) {
    const next = poses[Math.floor(Math.random() * poses.length)];
    el.pose.src = `/assets/rei/${next}`;
  }
}

function addFeed(user, text) {
  const item = document.createElement('li');
  const name = document.createElement('b');
  name.textContent = user;
  item.append(name, document.createTextNode(text));
  el.feed.prepend(item);
  while (el.feed.children.length > 4) el.feed.lastElementChild.remove();
}

function play(url) {
  if (!url) return;
  el.voice.src = url;
  el.voice.volume = 0.9;
  el.voice.play().catch(() => {});
}

function handle(event) {
  if (event.type === 'say' || event.type === 'caption') {
    typeLine(event.text || '', event.to || '绫波丽');
    play(event.voice);
  }
  if (event.type === 'viewer') addFeed(event.user || '观众', event.text || '');
  if (event.type === 'state' && event.state?.stats) {
    el.tok.textContent = `${event.state.stats.said || 0} 句`;
  }
}

function connect() {
  const source = new EventSource('/events');
  source.onmessage = (message) => {
    try {
      const event = JSON.parse(message.data);
      if (event.type === 'hello') {
        el.tok.textContent = `${event.state.stats.said || 0} 句`;
      }
      handle(event);
    } catch {}
  };
  source.onerror = () => {
    source.close();
    setTimeout(connect, 1500);
  };
}

setIdle();
connect();
