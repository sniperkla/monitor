import { readFileSync, writeFileSync } from 'fs';

// Read the GLB
const glb = readFileSync('./public/fallout/human_units.glb');

// GLB header
const jsonLen = glb.readUInt32LE(12);
const jsonStr = glb.slice(20, 20 + jsonLen).toString('utf8');
const json = JSON.parse(jsonStr);

const jsonPadded = Math.ceil(jsonLen / 4) * 4;
const binStart = 12 + 8 + jsonPadded;
const binLen = glb.readUInt32LE(binStart);
const bin = glb.slice(binStart + 8, binStart + 8 + binLen);

console.log('images:', JSON.stringify(json.images, null, 2));

for (let i = 0; i < json.images.length; i++) {
  const imgDef = json.images[i];
  const bv = json.bufferViews[imgDef.bufferView];
  const imgData = bin.slice(bv.byteOffset, bv.byteOffset + bv.byteLength);
  const outPath = `/tmp/test_texture_${i}.png`;
  writeFileSync(outPath, imgData);
  console.log(`Image ${i}: ${imgData.length} bytes → ${outPath}`);
  console.log(`  First 16 bytes: ${Array.from(imgData.slice(0,16)).map(b=>b.toString(16).padStart(2,'0')).join(' ')}`);
  
  // Verify PNG signature
  const PNG_SIG = [137, 80, 78, 71, 13, 10, 26, 10];
  const validSig = PNG_SIG.every((b, i) => imgData[i] === b);
  console.log(`  PNG signature: ${validSig ? 'VALID' : 'INVALID'}`);
  
  // Read IHDR
  const ihdrLen = imgData.readUInt32BE(8);
  console.log(`  IHDR length: ${ihdrLen} (expected 13)`);
  const width = imgData.readUInt32BE(16);
  const height = imgData.readUInt32BE(20);
  const bitDepth = imgData[24];
  const colorType = imgData[25];
  console.log(`  Dimensions: ${width}x${height}, bitDepth=${bitDepth}, colorType=${colorType}`);
  
  // Verify IHDR CRC
  // Chunk layout: length(4) @ sig+8, type(4) @ sig+12, data(13) @ sig+16, crc(4) @ sig+29
  const ihdrStoredCrc = imgData.readUInt32BE(8 + 4 + 4 + 13);   // offset 29
  // CRC covers type(4) + data(13) starting at offset 12
  const CRC32_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[i] = c;
    }
    return t;
  })();
  function crc32(buf, start, end) {
    let crc = 0xffffffff;
    for (let i = start; i < end; i++) {
      crc = CRC32_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
    }
    return (crc ^ 0xffffffff) >>> 0;
  }
  
  const ihdrStoredCrc2 = imgData.readUInt32BE(8 + 4 + 4 + 13);  // offset 29 - after sig+length+type+data
  const ihdrCalcCrc = crc32(imgData, 12, 12 + 4 + 13);  // type(4)+data(13) starting at offset 12
  console.log(`  IHDR CRC: stored=${ihdrStoredCrc2.toString(16)}, calculated=${ihdrCalcCrc.toString(16)}, ${ihdrStoredCrc2 === ihdrCalcCrc ? 'MATCH' : 'MISMATCH!'}`);
  
  // Find IDAT chunk
  let pos = 8 + 12 + 13; // after signature + IHDR chunk
  while (pos < imgData.length) {
    const chunkLen = imgData.readUInt32BE(pos);
    const type = String.fromCharCode(imgData[pos+4], imgData[pos+5], imgData[pos+6], imgData[pos+7]);
    const storedCrc = imgData.readUInt32BE(pos + 4 + 4 + chunkLen);
    const calcCrc = crc32(imgData, pos+4, pos+4+4+chunkLen);
    console.log(`  Chunk '${type}': length=${chunkLen}, CRC ${storedCrc === calcCrc ? 'OK' : 'FAIL (stored='+storedCrc.toString(16)+' calc='+calcCrc.toString(16)+')'}`);
    pos += 4 + 4 + chunkLen + 4;
    if (type === 'IEND') break;
  }
}
