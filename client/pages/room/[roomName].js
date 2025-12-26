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
  const videoProducerRef = useRef(null); 
  const audioProducerRef = useRef(null); 

  const remoteStreamsRef = useRef({});

  const joinRoom = async () => {
    if (!roomName) return;
    setJoined(true);

    // const socket = io("http://192.168.98.174:4000", {
    //   path: "/mediasoup",
    //   transports: ["websocket"],
    // });
    const socket = io("http://localhost:4000", {
      path: "/mediasoup",
      transports: ["websocket"],
    });
    socketRef.current = socket;

    socket.on("connect", async () => {
      console.log("✅ Connected:", socket.id);

      socket.emit("joinRoom", { roomName }, async ({ rtpCapabilities, otherPeersData }) => {
        try {
          const device = new mediasoupClient.Device();
          await device.load({ routerRtpCapabilities: rtpCapabilities });
          deviceRef.current = device;

          await getLocalStream();
          createSendTransport();
          
          if (otherPeersData?.length > 0) {
            for (const peerData of otherPeersData) {
              for (const producerId of peerData.producerIds) {
                console.log(`📡 Consuming existing producer: ${producerId} from peer: ${peerData.peerId}`);
                await consumeStream(producerId, peerData.peerId);
              }
            }
          }
        } catch (err) {
            console.error("❌ Error in joinRoom callback:", err);
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
        
        // --- NEW: Check if tracks were actually acquired ---
        if (!stream.getAudioTracks().length) {
            console.warn("⚠️ No audio track found. Mic might be disabled or unavailable.");
            alert("Could not find a microphone. You will be muted.");
            setMicOn(false);
        }
        if (!stream.getVideoTracks().length) {
            console.warn("⚠️ No video track found. Camera might be disabled or unavailable.");
            alert("Could not find a camera. Your video will be off.");
            setVideoOn(false);
        }

      } catch (err) {
        console.error("❌ Error accessing media devices:", err);
        alert("Error accessing media devices. Please check permissions.");
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

        producerTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
          // --- NEW: Added errback ---
          try {
            socket.emit("transport-connect", {
              dtlsParameters,
              transportId: producerTransport.id,
            });
            callback();
          } catch (err) {
            errback(err);
          }
        });

        producerTransport.on("produce", async ({ kind, rtpParameters, appData }, callback, errback) => {
            // --- NEW: Added errback and try...catch ---
          try {
            socket.emit(
              "transport-produce",
              { kind, rtpParameters, transportId: producerTransport.id },
              ({ id, error }) => {
                if (error) {
                  console.error("❌ Error producing:", error);
                  errback(new Error(error));
                  return;
                }
                callback({ id });
              }
            );
          } catch (err) {
            errback(err);
          }
        });

        // --- NEW: 'connectionstatechange' listener for debugging ---
        producerTransport.on("connectionstatechange", (state) => {
            console.log(`⬆️ Producer transport state: ${state}`);
            if (state === 'failed') {
                console.error('Producer transport connection failed');
                producerTransport.close();
            }
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
        // --- MODIFIED: Store producers to manage them later (e.g., mute/unmute) ---
        if (videoTrack) {
          videoProducerRef.current = await producerTransport.produce({ 
              track: videoTrack,
              encodings: [ // --- NEW: Example of specifying encodings (optional but good)
                  { maxBitrate: 100000 },
                  { maxBitrate: 300000 },
                  { maxBitrate: 900000 },
              ],
              codecOptions: {
                  videoGoogleStartBitrate: 1000
              }
            });
        }
        if (audioTrack) {
          audioProducerRef.current = await producerTransport.produce({ track: audioTrack });
        }
        console.log("🎥 Local media published successfully");
      } catch (err) {
        console.error("❌ Error producing stream:", err);
      }
    }

    // --- MODIFIED: Now receives peerId ---
    socket.on("newProducer", async ({ producerId, peerId }) => {
      console.log(`🆕 New producer detected: ${producerId} from peer: ${peerId}`);
      await consumeStream(producerId, peerId);
    });

    // --- NEW: Listen for peers closing ---
    socket.on("peerClosed", ({ peerId }) => {
        console.log(`❌ Peer closed: ${peerId}`);
        const remoteData = remoteStreamsRef.current[peerId];
        if (remoteData) {
            // Stop tracks and remove video element
            remoteData.videoEl.srcObject = null; // Detach stream
            remoteData.videoEl.remove();
            remoteData.stream.getTracks().forEach(t => t.stop());

            // Close associated consumer transports
            remoteData.consumers.forEach(consumer => {
                const transport = consumerTransportsRef.current.find(
                    t => t.consumer.id === consumer.id
                );
                if (transport) {
                    transport.consumerTransport.close();
                }
            });

            // Clean up refs
            consumerTransportsRef.current = consumerTransportsRef.current.filter(
                t => !remoteData.consumers.find(c => c.id === t.consumer.id)
            );
            delete remoteStreamsRef.current[peerId];
        }
    });

    // --- COMPLETELY REWRITTEN FUNCTION ---
    async function consumeStream(remoteProducerId, peerId) {
      if (!deviceRef.current) {
        console.error("Device not initialized");
        return;
      }

      // Create a new consumer transport if needed, or reuse an existing one
      // For simplicity here, we create one per consumer, but reuse is possible.
      socket.emit("createWebRtcTransport", { consumer: true }, async ({ params }) => {
        if (params.error) {
          console.error("❌ Consumer transport creation error:", params.error);
          return;
        }

        const consumerTransport = deviceRef.current.createRecvTransport(params);
        
        consumerTransport.on("connect", ({ dtlsParameters }, callback, errback) => {
          try {
            socket.emit("transport-recv-connect", {
              dtlsParameters,
              transportId: consumerTransport.id,
            });
            callback();
          } catch (err) {
            errback(err);
          }
        });

        // --- NEW: 'connectionstatechange' listener for debugging ---
        consumerTransport.on("connectionstatechange", (state) => {
            console.log(`⬇️ Consumer transport (${peerId}) state: ${state}`);
             if (state === 'failed') {
                console.error(`Consumer transport (${peerId}) connection failed`);
                consumerTransport.close();
            }
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

            try {
              const consumer = await consumerTransport.consume({
                id: consumeParams.id,
                producerId: consumeParams.producerId,
                kind: consumeParams.kind,
                rtpParameters: consumeParams.rtpParameters,
              });

              // --- NEW: Logic to combine tracks into one stream per peer ---
              let remoteData = remoteStreamsRef.current[peerId];
              
              // If this is the first track from this peer, create stream and video element
              if (!remoteData) {
                  const stream = new MediaStream();
                  const video = document.createElement("video");
                  video.srcObject = stream;
                  video.autoplay = true;
                  video.playsInline = true;
                  video.className = "rounded-xl shadow-lg w-72 h-48 object-cover bg-black";
                  remoteContainerRef.current?.appendChild(video);
                  
                  remoteData = { stream, videoEl: video, consumers: [] };
                  remoteStreamsRef.current[peerId] = remoteData;
              }

              // Add the new track to the existing stream
              remoteData.stream.addTrack(consumer.track);
              remoteData.consumers.push(consumer);
              
              // Store transport for cleanup
              consumerTransportsRef.current.push({ consumerTransport, consumer });

              // --- NEW: Handle track ending (e.g., user stops camera) ---
              consumer.on("trackended", () => {
                  console.log(`Track ended for consumer: ${consumer.id}`);
                  // Remove track from stream (optional, but good practice)
                  remoteData.stream.removeTrack(consumer.track);
              });

              // --- NEW: Handle producer pausing (e.g., user mutes) ---
              consumer.on("producerpause", () => {
                  console.log(`Producer paused for consumer: ${consumer.id}`);
                  // You could show a "muted" icon on the video element
              });
              consumer.on("producerresume", () => {
                  console.log(`Producer resumed for consumer: ${consumer.id}`);
                  // You could hide the "muted" icon
              });

              // Resume the consumer on the server
              socket.emit("consumer-resume", { consumerId: consumer.id });

            } catch (err) {
                console.error("❌ Error in consumerTransport.consume:", err);
            }
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
      
      // Clear remote streams
      for (const peerId in remoteStreamsRef.current) {
          const remoteData = remoteStreamsRef.current[peerId];
          remoteData.videoEl.remove();
      }
      remoteStreamsRef.current = {};
    };
  };

  const toggleMic = () => {
    if (!audioProducerRef.current) return;
    const newMicOn = !micOn;
    if (newMicOn) {
        audioProducerRef.current.resume();
    } else {
        audioProducerRef.current.pause();
    }
    setMicOn(newMicOn);
  };

  const toggleVideo = () => {
    if (!videoProducerRef.current) return;
    const newVideoOn = !videoOn;
     if (newVideoOn) {
        videoProducerRef.current.resume();
    } else {
        videoProducerRef.current.pause();
    }
    setVideoOn(newVideoOn);
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
                muted // Mute local video to prevent echo
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