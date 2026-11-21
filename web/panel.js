const $ = (id) => document.getElementById(id);
let bank = [];
let editing = null;

async function api(path, payload) {
  const options = payload === undefined ? {} : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) };
  const res = await fetch(path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.status);
  return data;
}

function status(text, on) {
  const pill = $('status');
  pill.textContent = text;
  pill.classList.toggle('on', !!on);
}

function renderLines() {
  const q = ($('search').value || '').trim();
  const rows = bank.filter((l) => !q || l.text.includes(q));
  $('lineCount').textContent = `${rows.length} / ${bank.length} 句 · 开 ${bank.filter((l) => !l.off).length}`;
  const list = $('lines');
  list.textContent = '';
  for (const line of rows) {
    const row = document.createElement('li');
    row.className = `lrow${line.off ? ' off' : ''}`;
    row.dataset.id = line.id;

    const sw = document.createElement('button');
    sw.className = `sw${line.off ? '' : ' on'}`;
    sw.title = line.off ? '这句现在是关的' : '点一下关掉这句';
    sw.onclick = () => toggle(line);

    const cat = document.createElement('span');
    cat.className = 'cat';
    cat.textContent = line.cat;

    const txt = document.createElement('span');
    txt.className = 'txt';
    txt.textContent = line.text;

    const sayBtn = document.createElement('button');
    sayBtn.className = 'mini say';
    sayBtn.textContent = '说';
    sayBtn.onclick = () => say(line);

    const editBtn = document.createElement('button');
    editBtn.className = 'mini edit';
    editBtn.textContent = '改';
    editBtn.onclick = () => startEdit(row, line, txt);

    const delBtn = document.createElement('button');
    delBtn.className = 'mini danger del';
    delBtn.textContent = '删';
    delBtn.onclick = () => drop(line);

    row.append(sw, cat, txt, sayBtn, editBtn, delBtn);
    list.append(row);
  }
}

async function toggle(line) {
  try {
    const data = await api('/lines/toggle', { id: line.id, off: !line.off });
    line.off = data.line.off;
    renderLines();
  } catch (error) { status(error.message, false); }
}

async function say(line) {
  try { await api('/lines/say', { id: line.id }); status(`她说：${line.text.slice(0, 14)}`, true); }
  catch (error) { status(error.message, false); }
}

async function drop(line) {
  if (!confirm(`删掉这句？\n\n${line.text}`)) return;
  try {
    await api('/lines/remove', { id: line.id });
    bank = bank.filter((l) => l.id !== line.id);
    renderLines();
  } catch (error) { status(error.message, false); }
}

function startEdit(row, line, holder) {
  if (editing) return;
  editing = line.id;
  row.classList.add('editing');
  holder.textContent = '';
  const input = document.createElement('input');
  input.value = line.text;
  const save = document.createElement('button');
  save.className = 'mini';
  save.textContent = '存';
  const cancel = document.createElement('button');
  cancel.className = 'mini ghost';
  cancel.textContent = '撤';
  holder.append(input, save, cancel);
  input.focus();
  input.setSelectionRange(input.value.length, input.value.length);

  const done = () => { editing = null; row.classList.remove('editing'); renderLines(); };
  const commit = async () => {
    const text = input.value.trim();
    if (!text) return status('不能改成空句', false);
    try {
      const data = await api('/lines/edit', { id: line.id, text });
      Object.assign(line, data.line);
      done();
      loadLines();
    } catch (error) { status(error.message, false); }
  };
  save.onclick = commit;
  cancel.onclick = done;
  input.onkeydown = (event) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) commit();
    if (event.key === 'Escape') done();
  };
}

async function loadLines() {
  const data = await api('/lines');
  bank = data.lines;
  renderLines();
}

async function loadSettings() {
  const data = await api('/state');
  $('perHour').value = data.settings.rhythm.linesPerHour;
  $('quiet').value = data.settings.rhythm.quietAfterCommentSec;
  $('speech').checked = data.settings.speech.enabled;
  $('count').textContent = `台词 ${data.lines.total}`;
  status(data.read.running ? `在读 ${data.read.index}/${data.read.total}` : '待机', true);
}

async function refreshRead() {
  const data = await api('/read/state');
  $('readMeta').textContent = data.running ? `第 ${data.index} / ${data.total} 段` : '待机';
}

$('sayGo').onclick = async () => {
  const text = $('sayText').value.trim();
  if (!text) return;
  try { const data = await api('/say', { text }); status(data.voice ? `念了 ${data.ms}ms` : '念了（没合成音频）', true); $('sayText').value = ''; }
  catch (error) { status(error.message, false); }
};

$('introGo').onclick = async () => {
  try { const data = await api('/intro', {}); status(`开场白 ${data.said} 句`, true); }
  catch (error) { status(error.message, false); }
};

$('readGo').onclick = async () => {
  const text = $('readText').value.trim();
  if (!text) return;
  try { const data = await api('/read/start', { text }); status(`开读 ${data.total} 段`, true); refreshRead(); }
  catch (error) { status(error.message, false); }
};

$('readStop').onclick = async () => { await api('/read/stop', {}); refreshRead(); };

$('save').onclick = async () => {
  try {
    await api('/settings', { rhythm: { linesPerHour: Number($('perHour').value), quietAfterCommentSec: Number($('quiet').value) }, speech: { enabled: $('speech').checked } });
    status('已保存', true);
  } catch (error) { status(error.message, false); }
};

$('search').oninput = renderLines;
$('reload').onclick = () => location.reload();

loadSettings().catch((error) => status(error.message, false));
loadLines().catch((error) => status(error.message, false));
setInterval(() => refreshRead().catch(() => {}), 3000);
