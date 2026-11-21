const el = {
  line: document.getElementById('line'),
  whisper: document.getElementById('whisper'),
  feed: document.getElementById('feed'),
  tok: document.getElementById('tok'),
  cost: document.getElementById('cost'),
  pose: document.getElementById('pose'),
  voice: document.getElementById('voice'),
};

/* 二十张立绘按状态分池：安静时坐得住，说话时有动作，手上活计单独一组。 */
const POSES = {
  quiet: ['v2_base.png', 'v2_blink.png', 'v2_hair.png', 'v3_lean.png', 'v3_window.png', 'v3_lookout.png', 'v4_crouch.png'],
  talk: ['v2_wave.png', 'v3_point.png', 'v3_holdup.png', 'v3_stand.png'],
  busy: ['v2_think.png', 'v2_drink.png', 'v2_phone.png', 'v2_stretch.png', 'v3_blow.png', 'v3_stretch.png', 'v3_wipe.png', 'v3_walk.png', 'v3_crouch.png'],
};
const ALL = Object.values(POSES).flat();
/* 蹲着的两张重心低，往右下让一点，别被气泡挡住脸。 */
const LOW = ['v3_crouch.png', 'v4_crouch.png'];
let current = 'v2_base.png';
let typing = null;
let idleTimer = null;
let poseTimer = null;

/* 先把图都预载进浏览器缓存，换姿势时不会空白一下。 */
for (const name of ALL) {
  const img = new Image();
  img.src = `/assets/rei/${name}`;
}

function pose(kind = 'quiet') {
  const pool = POSES[kind] || POSES.quiet;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  if (pick === current) return;
  current = pick;
  el.pose.classList.add('swap');
  el.pose.classList.toggle('low', LOW.includes(pick));
  const next = new Image();
  const done = () => {
    el.pose.src = `/assets/rei/${pick}`;
    el.pose.classList.remove('swap');
  };
  next.onload = done;
  next.onerror = () => el.pose.classList.remove('swap');
  next.src = `/assets/rei/${pick}`;
}

/* 不说话也不该像一张贴图：每十几秒换一个坐姿。 */
function scheduleIdlePose() {
  clearTimeout(poseTimer);
  poseTimer = setTimeout(() => {
    pose('quiet');
    scheduleIdlePose();
  }, 11000 + Math.random() * 9000);
}

function setIdle() {
  el.whisper.textContent = '自己待着';
  el.line.classList.add('silent');
  pose('quiet');
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

  pose(Math.random() < 0.6 ? 'talk' : 'busy');
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
scheduleIdlePose();
connect();
