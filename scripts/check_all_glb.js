const fs = require('fs');
const path = require('path');
const dir = 'public/fallout';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.glb'));

let totalImages = 0, totalTextures = 0, totalMaterials = 0;

files.forEach(file => {
  const filePath = path.join(dir, file);
  const buf = fs.readFileSync(filePath);

  const magic = buf.readUInt32LE(0);
  const version = buf.readUInt32LE(4);

  let offset = 12;
  let binBuf = null;
  let jsonData = null;

  while (offset < buf.length) {
    const chunkLen = buf.readUInt32LE(offset);
    const chunkType = buf.readUInt32LE(offset + 4);
    const typeName = chunkType === 0x4E4F534A ? 'JSON' : chunkType === 0x004E4942 ? 'BIN' : 'UNK';
    if (typeName === 'JSON') {
      jsonData = JSON.parse(buf.slice(offset + 8, offset + 8 + chunkLen).toString('utf8'));
    }
    if (typeName === 'BIN') {
      binBuf = buf.slice(offset + 8, offset + 8 + chunkLen);
    }
    offset += 8 + chunkLen;
  }

  const images = jsonData && jsonData.images ? jsonData.images.length : 0;
  const textures = jsonData && jsonData.textures ? jsonData.textures.length : 0;
  const materials = jsonData && jsonData.materials ? jsonData.materials.length : 0;
  const meshes = jsonData && jsonData.meshes ? jsonData.meshes.length : 0;
  const nodes = jsonData && jsonData.nodes ? jsonData.nodes.length : 0;
  const fileSize = (buf.length / 1024).toFixed(1);

  totalImages += images;
  totalTextures += textures;
  totalMaterials += materials;

  console.log('==================================================');
  console.log('FILE: ' + file + ' (' + fileSize + ' KB)');
  console.log('  Version: ' + version + '  Magic: 0x' + magic.toString(16));
  console.log('  Images: ' + images + '  Textures: ' + textures + '  Materials: ' + materials);
  console.log('  Meshes: ' + meshes + '  Nodes: ' + nodes);

  if (jsonData && jsonData.images && binBuf) {
    jsonData.images.forEach(function(img, i) {
      var bv = jsonData.bufferViews[img.bufferView];
      var imgBuf = binBuf.slice(bv.byteOffset, bv.byteOffset + bv.byteLength);

      var pngSig = [137, 80, 78, 71, 13, 10, 26, 10];
      var isPng = pngSig.every(function(b, j) { return imgBuf[j] === b; });

      var w = 0, h = 0;
      if (isPng && imgBuf.length > 24) {
        w = imgBuf.readUInt32BE(16);
        h = imgBuf.readUInt32BE(20);
      }

      var valid = isPng;
      var chunks = [];
      if (isPng) {
        var pos = 8;
        while (pos < imgBuf.length) {
          if (pos + 8 > imgBuf.length) { valid = false; break; }
          var cLen = imgBuf.readUInt32BE(pos);
          var cType = imgBuf.slice(pos + 4, pos + 8).toString('ascii');
          if (pos + 12 + cLen > imgBuf.length) { valid = false; break; }
          chunks.push(cType);
          pos += 12 + cLen;
          if (cType === 'IEND') break;
        }
      }

      var status = valid ? 'OK' : 'CORRUPT';
      var sizeKB = (bv.byteLength / 1024).toFixed(1);
      console.log('    Image ' + i + ': ' + (img.mimeType || 'unknown') + ' ' + w + 'x' + h + ' (' + sizeKB + ' KB) [' + status + '] chunks: ' + chunks.join(','));
    });
  }

  if (jsonData && jsonData.textures) {
    var badTextures = [];
    jsonData.textures.forEach(function(tex, i) {
      var imgOk = tex.source !== undefined && tex.source < (jsonData.images ? jsonData.images.length : 0);
      var sampOk = tex.sampler === undefined || tex.sampler < (jsonData.samplers ? jsonData.samplers.length : 0);
      if (!imgOk || !sampOk) badTextures.push(i);
    });
    if (badTextures.length > 0) console.log('  WARNING: Bad texture refs at indices: ' + badTextures.join(', '));
  }

  console.log('');
});

console.log('==================================================');
console.log('SUMMARY: ' + files.length + ' GLB files');
console.log('  Total Images: ' + totalImages);
console.log('  Total Textures: ' + totalTextures);
console.log('  Total Materials: ' + totalMaterials);
