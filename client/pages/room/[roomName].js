import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import io from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";

export default function RoomPage() {
  const router = useRouter();
  const { roomName } = router.query;

  // Refs for DOM elements
  const remoteContainerRef = useRef(null);
  const localVideoRef = useRef(null);

  // State for UI
  const [micOn, setMicOn] = useState(true);
  const [videoOn, setVideoOn] = useState(true);
  const [joined, setJoined] = useState(false);

  // Refs for mediasoup internals
  const socketRef = useRef(null);
  const deviceRef = useRef(null);
  const producerTransportRef = useRef(null);
  const consumerTransportsRef = useRef([]);
  const localStreamRef = useRef(null);

  const joinRoom = async () => {
    if (!roomName) return;
    setJoined(true);

    const socket = io("http://localhost:4000", {
      path: "/mediasoup",
      transports: ["websocket"],
    });
    socketRef.current = socket;

    socket.on("connect", async () => {
      console.log("✅ Connected:", socket.id);

      socket.emit("joinRoom", { roomName }, async ({ rtpCapabilities, existingProducers }) => {
        const device = new mediasoupClient.Device();
        await device.load({ routerRtpCapabilities: rtpCapabilities });
        deviceRef.current = device;

        await getLocalStream();
        createSendTransport();

        if (existingProducers?.length > 0) {
          for (const producerId of existingProducers) {
            console.log("📡 Consuming existing producer:", producerId);
            await consumeStream(producerId);
          }
        }
      });
    });

    async function getLocalStream() {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        localStreamRef.current = stream;
        if (localVideoRef.current) localVideoRef.current.srcObject = stream;
      } catch (err) {
        console.error("❌ Error accessing media devices:", err);
      }
    }

    function createSendTransport() {
      socket.emit("createWebRtcTransport", { consumer: false }, async ({ params }) => {
        if (params.error) {
          console.error("❌ Transport creation error:", params.error);
          return;
        }

        const device = deviceRef.current;
        const producerTransport = device.createSendTransport(params);
        producerTransportRef.current = producerTransport;

        producerTransport.on("connect", ({ dtlsParameters }, callback) => {
          socket.emit("transport-connect", {
            dtlsParameters,
            transportId: producerTransport.id,
          });
          callback();
        });

        producerTransport.on("produce", async ({ kind, rtpParameters }, callback) => {
          socket.emit(
            "transport-produce",
            { kind, rtpParameters, transportId: producerTransport.id },
            ({ id }) => callback({ id })
          );
        });

        await startStream(producerTransport);
      });
    }

    async function startStream(producerTransport) {
      const stream = localStreamRef.current;
      if (!stream) return;

      const videoTrack = stream.getVideoTracks()[0];
      const audioTrack = stream.getAudioTracks()[0];

      try {
        if (videoTrack) await producerTransport.produce({ track: videoTrack });
        if (audioTrack) await producerTransport.produce({ track: audioTrack });
        console.log("🎥 Local media published successfully");
      } catch (err) {
        console.error("❌ Error producing stream:", err);
      }
    }

    socket.on("newProducer", async ({ producerId }) => {
      console.log("🆕 New producer detected:", producerId);
      await consumeStream(producerId);
    });

    async function consumeStream(remoteProducerId) {
      if (!deviceRef.current) {
        console.error("Device not initialized");
        return;
      }

      socket.emit("createWebRtcTransport", { consumer: true }, async ({ params }) => {
        if (params.error) {
          console.error("❌ Consumer transport creation error:", params.error);
          return;
        }

        const consumerTransport = deviceRef.current.createRecvTransport(params);

        consumerTransport.on("connect", ({ dtlsParameters }, callback) => {
          socket.emit("transport-recv-connect", {
            dtlsParameters,
            transportId: consumerTransport.id,
          });
          callback();
        });

        socket.emit(
          "consume",
          {
            rtpCapabilities: deviceRef.current.rtpCapabilities,
            remoteProducerId,
            transportId: consumerTransport.id,
          },
          async ({ params: consumeParams }) => {
            if (consumeParams.error) {
              console.error("❌ Consume error:", consumeParams.error);
              return;
            }

            const consumer = await consumerTransport.consume({
              id: consumeParams.id,
              producerId: consumeParams.producerId,
              kind: consumeParams.kind,
              rtpParameters: consumeParams.rtpParameters,
            });

            const stream = new MediaStream([consumer.track]);
            consumerTransportsRef.current.push({ consumerTransport, consumer });

            if (consumer.kind === "video") {
              const video = document.createElement("video");
              video.srcObject = stream;
              video.autoplay = true;
              video.playsInline = true;
              video.className =
                "rounded-xl shadow-lg w-72 h-48 object-cover bg-black";
              remoteContainerRef.current?.appendChild(video);
            } else if (consumer.kind === "audio") {
              const audio = document.createElement("audio");
              audio.srcObject = stream;
              audio.autoplay = true;
              audio.controls = false;
              audio.addEventListener("canplay", () =>
                audio
                  .play()
                  .catch((err) => console.warn("🔇 Autoplay blocked:", err))
              );
              remoteContainerRef.current?.appendChild(audio);
            }

            socket.emit("consumer-resume", { consumerId: consumer.id });
          }
        );
      });
    }

    return () => {
      console.log("🔌 Cleaning up...");
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      producerTransportRef.current?.close();
      consumerTransportsRef.current.forEach((t) => t.consumerTransport.close());
      socket.disconnect();
    };
  };

  // --- Mic and Video Toggles ---
  const toggleMic = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack) {
      audioTrack.enabled = !audioTrack.enabled;
      setMicOn(audioTrack.enabled);
    }
  };

  const toggleVideo = () => {
    const stream = localStreamRef.current;
    if (!stream) return;
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack) {
      videoTrack.enabled = !videoTrack.enabled;
      setVideoOn(videoTrack.enabled);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 text-white">
      {/* Navbar */}
      <header className="flex justify-between items-center p-4 border-b border-slate-700 bg-slate-800/60 backdrop-blur-md">
        <h2 className="text-xl font-bold">🎥 Room: {roomName}</h2>
        <button
          onClick={() => router.push("/")}
          className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded-lg font-semibold transition"
        >
          Leave Room
        </button>
      </header>

      {/* Main content */}
      <main className="p-6 flex flex-col items-center space-y-8">
        {!joined ? (
          <button
            onClick={joinRoom}
            className="px-6 py-3 bg-green-600 hover:bg-green-500 rounded-xl font-semibold text-lg mt-16 transition"
          >
            🎧 Start Call
          </button>
        ) : (
          <>
            {/* Local Stream */}
            <div className="flex flex-col items-center space-y-3">
              <h3 className="font-semibold text-lg">You</h3>
              <video
                ref={localVideoRef}
                autoPlay
                muted
                playsInline
                className="rounded-xl shadow-lg w-80 h-52 object-cover bg-black"
              ></video>
              <div className="flex space-x-4">
                <button
                  onClick={toggleMic}
                  className={`px-4 py-2 rounded-lg font-medium transition ${
                    micOn
                      ? "bg-teal-600 hover:bg-teal-500"
                      : "bg-gray-700 text-gray-300"
                  }`}
                >
                  {micOn ? "🎙️ Mic On" : "🔇 Mic Off"}
                </button>

                <button
                  onClick={toggleVideo}
                  className={`px-4 py-2 rounded-lg font-medium transition ${
                    videoOn
                      ? "bg-blue-600 hover:bg-blue-500"
                      : "bg-gray-700 text-gray-300"
                  }`}
                >
                  {videoOn ? "📹 Video On" : "📷 Video Off"}
                </button>
              </div>
            </div>

            {/* Remote Streams */}
            <div
              ref={remoteContainerRef}
              className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6 mt-10"
            />
          </>
        )}
      </main>
    </div>
  );
}
