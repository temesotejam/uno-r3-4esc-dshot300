// Web Serial + STK500v1 (Optiboot) for ATmega328P Uno R3.
// No cloud upload: firmware travels from the browser to the selected local USB port.
// DO NOT use this module for non-Uno boards, fuses, or bootloader replacement.
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const INSYNC = 0x14, OK = 0x10, EOP = 0x20;
export const UNO_MAX_SKETCH_BYTES = 32256; // Reserve 512-byte Optiboot area.
export const UNO_PAGE_BYTES = 128;

export function parseIntelHex(source) {
  if (typeof source !== 'string') throw new Error('HEXデータが文字列ではありません。');
  const bytes = new Map();
  let upper = 0, ended = false, dataRecords = 0;
  const lines = source.trim().split(/\r?\n/);
  for (let i = 0; i < lines.length; ++i) {
    const line = lines[i].trim();
    if (!line) continue;
    if (ended) throw new Error('EOFより後にHEXレコードがあります。');
    if (!/^:[0-9A-Fa-f]+$/.test(line) || ((line.length - 1) % 2))
      throw new Error('HEX形式エラー（行 ' + (i + 1) + '）。');
    const record = new Uint8Array((line.length - 1) / 2);
    for (let j = 0; j < record.length; j++)
      record[j] = parseInt(line.slice(1 + j * 2, 3 + j * 2), 16);
    if (record.length < 5 || record.length !== record[0] + 5)
      throw new Error('HEXレコード長が不正です（行 ' + (i + 1) + '）。');
    if ((record.reduce((s, v) => s + v, 0) & 255) !== 0)
      throw new Error('HEXチェックサムが不正です（行 ' + (i + 1) + '）。');
    const len = record[0], addr = (record[1] << 8) | record[2], type = record[3];
    if (type === 0) {
      dataRecords++;
      for (let j = 0; j < len; j++) {
        const location = upper + addr + j;
        if (location >= UNO_MAX_SKETCH_BYTES)
          throw new Error('UNO R3のスケッチ領域(32256B)を超えるHEXです。');
        if (bytes.has(location) && bytes.get(location) !== record[4 + j])
          throw new Error('HEX内のアドレスが重複し、内容が異なります。');
        bytes.set(location, record[4 + j]);
      }
    } else if (type === 1) {
      if (len !== 0 || addr !== 0) throw new Error('HEX EOFが不正です。');
      ended = true;
    } else if (type === 4) {
      if (len !== 2 || addr !== 0) throw new Error('HEX拡張アドレスが不正です。');
      upper = ((record[4] << 8) | record[5]) * 65536;
    } else if (type === 2) {
      if (len !== 2 || addr !== 0) throw new Error('HEXセグメントアドレスが不正です。');
      upper = ((record[4] << 8) | record[5]) * 16;
    } else if (type === 3 || type === 5) {
      if (len !== 4) throw new Error('HEX開始アドレス情報が不正です。');
    } else {
      throw new Error('未対応のHEXレコード種別: ' + type);
    }
  }
  if (!ended || dataRecords === 0 || !bytes.size)
    throw new Error('有効なIntel HEXデータまたはEOFがありません。');
  if (!bytes.has(0)) throw new Error('スケッチの先頭アドレス0x0000がありません。');
  const maxAddr = Math.max(...bytes.keys()) + 1;
  const total = Math.ceil(maxAddr / UNO_PAGE_BYTES) * UNO_PAGE_BYTES;
  if (total > UNO_MAX_SKETCH_BYTES) throw new Error('UNO R3のスケッチ領域を超えています。');
  const image = new Uint8Array(total).fill(0xFF);
  for (const [addr, value] of bytes) image[addr] = value;
  return { image, usedBytes: bytes.size, imageBytes: total };
}

function checkResponse(answer, size) {
  if (answer.length !== size + 2 || answer[0] !== INSYNC || answer[answer.length - 1] !== OK)
    throw new Error('Unoのブートローダーから不正な応答がありました。');
  return answer.subarray(1, answer.length - 1);
}

// Protocol-only entry point, allows mock testing without any hardware.
export async function programUno(link, hex, report = () => {}) {
  const {image, usedBytes} = parseIntelHex(hex);
  report('ブートローダーを起動しています', 0);
  await link.reset();
  let synced = false;
  for (let i = 0; i < 12; i++) {
    link.clear();
    try {
      await link.write(Uint8Array.of(0x30, EOP));
      checkResponse(await link.readExact(2, 130), 0);
      synced = true;
      break;
    } catch (err) {
      if (i < 11) await sleep(40);
    }
  }
  if (!synced) throw new Error('Uno R3のブートローダーに接続できません。正しいCOMポート、USBケーブル、ブートローダーを確認してください。');
  report('ATmega328Pを確認中', 7);
  await link.write(Uint8Array.of(0x75, EOP));
  const sig = checkResponse(await link.readExact(5, 800), 3);
  if (sig[0] !== 0x1e || sig[1] !== 0x95 || sig[2] !== 0x0f)
    throw new Error('ATmega328Pではないため、書き込みを中止しました。');
  // Optiboot supports page writes without using an ISP chip erase command.
  await link.write(Uint8Array.of(0x50, EOP));
  checkResponse(await link.readExact(2, 800), 0);

  const pages = image.length / UNO_PAGE_BYTES;
  for (let page = 0; page < pages; page++) {
    const word = page * UNO_PAGE_BYTES / 2;
    await link.write(Uint8Array.of(0x55, word & 255, word >> 8, EOP));
    checkResponse(await link.readExact(2, 800), 0);
    const contents = image.subarray(page * UNO_PAGE_BYTES, (page + 1) * UNO_PAGE_BYTES);
    const cmd = new Uint8Array(5 + contents.length);
    cmd.set([0x64, 0, contents.length, 0x46], 0);
    cmd.set(contents, 4);
    cmd[cmd.length - 1] = EOP;
    await link.write(cmd);
    checkResponse(await link.readExact(2, 2000), 0);
    report('書き込み中', 10 + Math.floor(58 * (page + 1) / pages));
  }

  for (let page = 0; page < pages; page++) {
    const word = page * UNO_PAGE_BYTES / 2;
    await link.write(Uint8Array.of(0x55, word & 255, word >> 8, EOP));
    checkResponse(await link.readExact(2, 800), 0);
    await link.write(Uint8Array.of(0x74, 0, UNO_PAGE_BYTES, 0x46, EOP));
    const readback = checkResponse(await link.readExact(UNO_PAGE_BYTES + 2, 1200), UNO_PAGE_BYTES);
    for (let i = 0; i < UNO_PAGE_BYTES; i++) {
      const address = page * UNO_PAGE_BYTES + i;
      if (readback[i] !== image[address])
        throw new Error('書き込み検証エラー（アドレス 0x' + address.toString(16) + '）。');
    }
    report('読み戻し検証中', 68 + Math.floor(31 * (page + 1) / pages));
  }
  await link.write(Uint8Array.of(0x51, EOP));
  checkResponse(await link.readExact(2, 800), 0);
  report('書き込みと検証が完了しました', 100);
  return { usedBytes, pages };
}

// Byte-stream buffering; Web Serial read() may return arbitrarily chunked data.
export class WebSerialLink {
  constructor(port) {
    this.port = port;
    this.bytes = [];
    this.waiters = new Set();
    this.failure = null;
    this.closed = false;
  }
  notify() { for (const fn of [...this.waiters]) fn(); }
  async open() {
    await this.port.open({ baudRate: 115200, dataBits: 8, stopBits: 1, parity: 'none', flowControl: 'none', bufferSize: 4096 });
    this.reader = this.port.readable.getReader();
    this.writer = this.port.writable.getWriter();
    this.pump = (async () => {
      try {
        while (!this.closed) {
          const { value, done } = await this.reader.read();
          if (done) break;
          if (value) for (const byte of value) this.bytes.push(byte);
          this.notify();
        }
      } catch (err) {
        if (!this.closed) this.failure = err;
      } finally {
        this.notify();
      }
    })();
  }
  clear() { this.bytes.length = 0; }
  async reset() {
    this.clear();
    // Arduino's USB serial DTR circuit produces a reset pulse on assertion.
    await this.port.setSignals({dataTerminalReady: false});
    await sleep(70);
    await this.port.setSignals({dataTerminalReady: true});
    await sleep(75);
    this.clear();
  }
  async write(bytes) {
    await this.writer.write(bytes);
  }
  async readExact(length, timeoutMs) {
    const out = new Uint8Array(length);
    let n = 0;
    const deadline = Date.now() + timeoutMs;
    while (n < length) {
      while (this.bytes.length && n < length) out[n++] = this.bytes.shift();
      if (n === length) break;
      if (this.failure) throw this.failure;
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Unoからの応答がタイムアウトしました。');
      await new Promise((resolve) => {
        const wake = () => { clearTimeout(timer); this.waiters.delete(wake); resolve(); };
        const timer = setTimeout(wake, remaining);
        this.waiters.add(wake);
        if (this.bytes.length || this.failure) wake();
      });
    }
    return out;
  }
  async close() {
    this.closed = true;
    try { await this.reader?.cancel(); } catch (_) {}
    try { await this.pump; } catch (_) {}
    try { this.reader?.releaseLock(); } catch (_) {}
    try { this.writer?.releaseLock(); } catch (_) {}
    try { await this.port.close(); } catch (_) {}
  }
}
