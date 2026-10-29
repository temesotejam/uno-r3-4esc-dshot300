import test from 'node:test';
import assert from 'node:assert/strict';
import {parseIntelHex, programUno, UNO_MAX_SKETCH_BYTES} from '../stk500.mjs';

function rec(type, address, bytes = []) {
  const data = [bytes.length, (address >> 8) & 255, address & 255, type, ...bytes];
  const sum = (-data.reduce((a,b) => a + b, 0)) & 255;
  return ':' + [...data,sum].map(x=>x.toString(16).padStart(2,'0').toUpperCase()).join('');
}
function makeHex(binary) {
  const lines = [];
  for(let addr=0; addr<binary.length;addr+=16)
    lines.push(rec(0,addr,Array.from(binary.slice(addr,addr+16))));
  lines.push(rec(1,0));
  return lines.join('\n');
}
class FakeLink {
  constructor() {
    this.flash = new Uint8Array(UNO_MAX_SKETCH_BYTES).fill(255);
    this.responses = [];
    this.addr = 0;
    this.failSync = false;
    this.corruptRead = false;
    this.resetCount = 0;
  }
  async reset(){this.resetCount++}
  clear(){this.responses = []}
  async write(command) {
    const op = command[0];
    assert.equal(command[command.length - 1], 0x20);
    const respond = (bytes=[]) => {this.responses.push(Uint8Array.from([0x14,...bytes,0x10]))};
    if(op===0x30) {if(!this.failSync) respond();}
    else if(op===0x75) respond([0x1e,0x95,0x0f]);
    else if(op===0x50 || op===0x51) respond();
    else if(op===0x55) {this.addr= (command[1] | (command[2]<<8))*2; respond();}
    else if(op===0x64) {
      const size = (command[1]<<8)|command[2];
      assert.equal(command[3],0x46);
      this.flash.set(command.subarray(4,4+size),this.addr);
      respond();
    } else if(op===0x74) {
      const size=(command[1]<<8)|command[2];
      const arr=Array.from(this.flash.subarray(this.addr,this.addr+size));
      if(this.corruptRead) arr[0]^=1;
      respond(arr);
    } else {assert.fail('Unsupported STK command: '+op)}
  }
  async readExact(count) {
    if(!this.responses.length) throw Error('timeout');
    const response=this.responses.shift();
    assert.equal(response.length,count);
    return response;
  }
}

test('Intel HEX is validated and expanded into full 128B pages', () => {
  const binary = Uint8Array.from({length:140},(_,i)=>(i*7)&255);
  const result = parseIntelHex(makeHex(binary));
  assert.equal(result.usedBytes,140);
  assert.equal(result.imageBytes,256);
  assert.deepEqual(result.image.subarray(0,140),binary);
  assert.equal(result.image[255],255);
});
test('detects invalid Intel HEX checksum and missing EOF', () => {
  const hex=makeHex(Uint8Array.from([1,2,3]));
  assert.throws(()=>parseIntelHex(hex.replace(':03000000',':03000001')), /チェックサム/);
  assert.throws(()=>parseIntelHex(hex.split('\n')[0]),/EOF/);
});
test('rejects overwriting Uno bootloader address space', () => {
  const hex = [rec(0,0,[1]),rec(0,UNO_MAX_SKETCH_BYTES,[1]),rec(1,0)].join('\n');
  assert.throws(()=>parseIntelHex(hex),/領域/);
});
test('writes every page, verifies readback, and leaves programming mode', async()=>{
  const binary=Uint8Array.from({length:238},(_,i)=>(i*9+13)&255);
  const port=new FakeLink();
  const stages=[];
  const result=await programUno(port,makeHex(binary),(text,pct)=>stages.push([text,pct]));
  assert.equal(result.pages,2);
  assert.equal(port.resetCount,1);
  assert.deepEqual(port.flash.subarray(0,238),binary);
  assert.equal(port.flash[238],255);
  assert.equal(stages.at(-1)[1],100);
});
test('fails closed if verify differs', async()=>{
  const port=new FakeLink();
  port.corruptRead=true;
  await assert.rejects(()=>programUno(port,makeHex(Uint8Array.from([9,8,7]))),/検証エラー/);
});
test('does not write pages if Uno bootloader cannot sync', async()=>{
  const port=new FakeLink();
  port.failSync=true;
  await assert.rejects(()=>programUno(port,makeHex(Uint8Array.from([1,2]))),/接続できません/);
  assert.equal(port.flash[0],255);
});
