const SESSION = [
  "v=0",
  "o=- 4611731400430051336 2 IN IP4 127.0.0.1",
  "s=-",
  "t=0 0",
  "a=group:BUNDLE 0",
] as const;

const AUDIO = [
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "c=IN IP4 0.0.0.0",
  "a=mid:0",
  "a=ice-ufrag:voice",
  "a=ice-pwd:voice-password-for-tests",
  "a=fingerprint:sha-256 00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF:00:11:22:33:44:55:66:77:88:99:AA:BB:CC:DD:EE:FF",
  "a=rtcp-mux",
  "a=rtpmap:111 opus/48000/2",
] as const;

function sdp(...lines: readonly string[]): string {
  return `${lines.join("\r\n")}\r\n`;
}

export const SENDONLY_AUDIO_OFFER_SDP = sdp(...SESSION, ...AUDIO, "a=setup:actpass", "a=sendonly");
export const RECVONLY_AUDIO_ANSWER_SDP = sdp(...SESSION, ...AUDIO, "a=setup:active", "a=recvonly");
export const SENDRECV_AUDIO_SDP = sdp(...SESSION, ...AUDIO, "a=setup:actpass", "a=sendrecv");
export const SENDONLY_AUDIO_ANSWER_SDP = sdp(...SESSION, ...AUDIO, "a=setup:active", "a=sendonly");
export const AUDIO_WITHOUT_DIRECTION_SDP = sdp(...SESSION, ...AUDIO, "a=setup:actpass");
export const SENDONLY_AUDIO_VIDEO_SDP = sdp(
  ...SESSION,
  ...AUDIO,
  "a=setup:actpass",
  "a=sendonly",
  "m=video 9 UDP/TLS/RTP/SAVPF 96",
  "c=IN IP4 0.0.0.0",
  "a=mid:1",
  "a=rtpmap:96 VP8/90000",
  "a=sendonly",
);
export const SENDONLY_AUDIO_APPLICATION_SDP = sdp(
  ...SESSION,
  ...AUDIO,
  "a=setup:actpass",
  "a=sendonly",
  "m=application 9 UDP/DTLS/SCTP webrtc-datachannel",
  "a=mid:1",
  "a=sctp-port:5000",
);
export const SENDONLY_DISABLED_AUDIO_SDP = SENDONLY_AUDIO_OFFER_SDP.replace("m=audio 9 ", "m=audio 0 ");
export const RECVONLY_DISABLED_AUDIO_SDP = RECVONLY_AUDIO_ANSWER_SDP.replace("m=audio 9 ", "m=audio 0 ");
export const RECVONLY_MISMATCHED_MID_SDP = RECVONLY_AUDIO_ANSWER_SDP.replace("a=mid:0", "a=mid:different");
export const SENDONLY_AUDIO_WITH_INLINE_CANDIDATE_SDP = SENDONLY_AUDIO_OFFER_SDP.replace(
  "a=ice-ufrag:voice",
  "a=candidate:1 1 UDP 2122260223 192.0.2.1 49170 typ host\r\na=ice-ufrag:voice",
);
export const SENDONLY_AUDIO_NON_WEBRTC_PROTOCOL_SDP = SENDONLY_AUDIO_OFFER_SDP.replace("UDP/TLS/RTP/SAVPF", "RTP/AVP");
export const SENDONLY_AUDIO_DIRECT_PORT_SDP = SENDONLY_AUDIO_OFFER_SDP.replace("m=audio 9 ", "m=audio 49170 ");
export const SENDONLY_AUDIO_NONNUMERIC_PAYLOAD_SDP = SENDONLY_AUDIO_OFFER_SDP.replace(
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "m=audio 9 UDP/TLS/RTP/SAVPF opus",
);
export const SENDONLY_AUDIO_OUT_OF_RANGE_PAYLOAD_SDP = SENDONLY_AUDIO_OFFER_SDP.replace(
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "m=audio 9 UDP/TLS/RTP/SAVPF 128",
);
export const SENDONLY_AUDIO_DUPLICATE_PAYLOAD_SDP = SENDONLY_AUDIO_OFFER_SDP.replace(
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  "m=audio 9 UDP/TLS/RTP/SAVPF 111 111",
);
export const SENDONLY_AUDIO_EXCESSIVE_PAYLOADS_SDP = SENDONLY_AUDIO_OFFER_SDP.replace(
  "m=audio 9 UDP/TLS/RTP/SAVPF 111",
  `m=audio 9 UDP/TLS/RTP/SAVPF ${Array.from({ length: 33 }, (_, index) => index).join(" ")}`,
);
export function sendonlyNonAudioSdp(kind: "video" | "text" | "image" | "message"): string {
  return sdp(...SESSION, `m=${kind} 9 UDP/TLS/RTP/SAVPF 111`, "a=mid:0", "a=sendonly");
}
