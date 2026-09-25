# Voice protocol streams

Scripted streams in the message format of each provider's public streaming API, used to
replay recognizer behaviour in tests without network or paid calls. They are written by hand
from the documented protocols (not captured from a real account): Deepgram live `Results`
with interim results, `is_final`, `speech_final`, `SpeechStarted` and `UtteranceEnd`; OpenAI
Realtime transcription `...transcription.delta` / `...completed` and VAD events.
