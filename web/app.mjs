import {parseIntelHex, programUno, WebSerialLink} from './stk500.mjs';

const $ = (id) => document.getElementById(id);
const button = $('flash'), safety = $('safe'), status = $('status');
const progress = $('progress'), log = $('log');
let firmwareHex = null;
let busy = false;
const supported = 'serial' in navigator && window.isSecureContext;

function append(text) {
  const stamp = new Date().toLocaleTimeString('ja-JP');
  log.textContent += '[' + stamp + '] ' + text + '\n';
  log.scrollTop = log.scrollHeight;
}
function setStatus(message, type = '') {
  status.textContent = message;
  status.className = 'status ' + type;
}
function refreshButton() {
  button.disabled = busy || !supported || !firmwareHex || !safety.checked;
  if (busy) button.textContent = '書き込み中…USBを外さないでください';
  else button.textContent = supported ? '接続してUno R3に書き込む' : 'このブラウザでは書き込みできません';
}
safety.addEventListener('change', refreshButton);

async function loadFirmware() {
  if (!supported) {
    setStatus('Web Serial非対応です。WindowsなどのPCでChromeまたはEdgeを使用してください。', 'error');
    refreshButton();
    return;
  }
  try {
    const [hexRes, buildRes] = await Promise.all([
      fetch('./firmware.hex', {cache:'no-store'}),
      fetch('./build.json', {cache:'no-store'})
    ]);
    if (!hexRes.ok) throw new Error('ファームウェアを取得できません（HTTP '+hexRes.status+'）。');
    const text = await hexRes.text();
    const parsed = parseIntelHex(text); // Verify Intel HEX checksums BEFORE user interacts.
    firmwareHex = text;
    $('fw-size').textContent = (parsed.usedBytes / 1024).toFixed(1) + ' KB';
    if (buildRes.ok) {
      const data = await buildRes.json();
      $('build-id').textContent = (data.commit || '不明').slice(0, 12);
    } else {
      $('build-id').textContent = 'ビルド情報なし';
    }
    setStatus('ファームウェアの準備ができました。確認欄をチェックしてください。');
    append('HEX形式とチェックサムを確認しました。(' + parsed.usedBytes + ' bytes)');
  } catch (e) {
    setStatus('準備エラー: '+e.message, 'error');
    append('準備エラー: '+e.message);
  }
  refreshButton();
}

button.addEventListener('click', async () => {
  if (busy || !firmwareHex || !safety.checked || !supported) return;
  busy = true;
  progress.value = 0;
  refreshButton();
  let link = null;
  try {
    setStatus('COMポートを選択してください。');
    append('ポート選択を開始');
    // Call requestPort directly from the click handler; browser requires a user gesture.
    const port = await navigator.serial.requestPort();
    link = new WebSerialLink(port);
    setStatus('Unoと接続しています。');
    await link.open();
    append('ポート接続成功。115200bps / STK500v1');
    const result = await programUno(link, firmwareHex, (label, percent) => {
      progress.value = percent;
      setStatus(label);
      if (percent === 0 || percent === 7 || percent >= 99 || percent % 10 === 0)
        append(label + ' ' + percent + '%');
    });
    setStatus('書き込み・読み戻し検証が完了しました。USB接続を解除して動作確認できます。', 'success');
    append('成功: ' + result.usedBytes + 'bytes / ' + result.pages + 'ページを書き込み・検証しました。');
  } catch (err) {
    const canceled = err && err.name === 'NotFoundError';
    if (canceled) {
      setStatus('ポートの選択をキャンセルしました。');
    } else {
      const message = err instanceof Error ? err.message : String(err);
      setStatus('失敗: ' + message + ' ファームウェアが書き込み途中の場合は、Arduino IDE等から再書き込みしてください。', 'error');
      append('失敗: ' + message);
    }
  } finally {
    try { await link?.close(); } catch (_) {}
    busy = false;
    refreshButton();
  }
});

loadFirmware();