import JSZip from 'jszip';
import { Track } from '../types';

/**
 * Encodes an AudioBuffer to a WAV format (Blob)
 * Converts Float32 audio data to Int16 PCM standard WAV
 */
const audioBufferToWav = (buffer: AudioBuffer): Blob => {
  const numChannels = buffer.numberOfChannels;
  const sampleRate = buffer.sampleRate;
  const format = 1; // PCM
  const bitDepth = 16;
  
  let result;
  if (numChannels === 2) {
    result = interleave(buffer.getChannelData(0), buffer.getChannelData(1));
  } else {
    result = buffer.getChannelData(0);
  }

  return encodeWAV(result, numChannels, sampleRate, bitDepth);
};

const interleave = (inputL: Float32Array, inputR: Float32Array) => {
  const length = inputL.length + inputR.length;
  const result = new Float32Array(length);

  let index = 0;
  let inputIndex = 0;

  while (index < length) {
    result[index++] = inputL[inputIndex];
    result[index++] = inputR[inputIndex];
    inputIndex++;
  }
  return result;
};

const encodeWAV = (samples: Float32Array, numChannels: number, sampleRate: number, bitDepth: number) => {
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* RIFF chunk length */
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, 1, true);
  /* channel count */
  view.setUint16(22, numChannels, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * blockAlign, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, blockAlign, true);
  /* bits per sample */
  view.setUint16(34, bitDepth, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, samples.length * bytesPerSample, true);

  floatTo16BitPCM(view, 44, samples);

  return new Blob([view], { type: 'audio/wav' });
};

const floatTo16BitPCM = (output: DataView, offset: number, input: Float32Array) => {
  for (let i = 0; i < input.length; i++, offset += 2) {
    const s = Math.max(-1, Math.min(1, input[i]));
    output.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
  }
};

const writeString = (view: DataView, offset: number, string: string) => {
  for (let i = 0; i < string.length; i++) {
    view.setUint8(offset + i, string.charCodeAt(i));
  }
};

/**
 * Exports all non-empty tracks as individual WAV files inside a ZIP archive.
 */
export const exportTracksToZip = async (tracks: Track[]): Promise<void> => {
  const zip = new JSZip();
  let hasAudio = false;

  tracks.forEach((track) => {
    if (track.audioBuffer && track.audioBuffer.length > 0) {
      hasAudio = true;
      const wavBlob = audioBufferToWav(track.audioBuffer);
      // Clean filename
      const safeName = track.name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
      zip.file(`${safeName}.wav`, wavBlob);
    }
  });

  if (!hasAudio) {
    throw new Error("エクスポートする音声データがありません。");
  }

  const content = await zip.generateAsync({ type: 'blob' });
  
  // Trigger download
  const url = URL.createObjectURL(content);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  const dateStr = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  link.setAttribute("download", `komasync_audio_${dateStr}.zip`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
