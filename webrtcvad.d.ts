declare module '@ennuicastr/webrtcvad.js' {
  type WebRtcVadModule = {
    Create(): number;
    Init(handle: number): number;
    set_mode(handle: number, mode: number): number;
    Process(handle: number, sampleRate: number, pcmPtr: number, length: number): number;
    malloc(size: number): number;
    free(ptr: number): void;
    HEAP16: Int16Array;
    HEAPU8: Uint8Array;
  };

  type WebRtcVadFactory = (config?: Record<string, unknown>) => Promise<WebRtcVadModule>;

  const WebRtcVad: WebRtcVadFactory;
  export default WebRtcVad;
  export { WebRtcVad };
}
