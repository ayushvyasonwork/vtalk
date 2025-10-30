import express from "express";
import http from "http";
import cors from "cors";
import { Server } from "socket.io";
import mediasoup from "mediasoup";

const app = express();
app.use(cors({ origin: "http://localhost:3000", credentials: true }));

const server = http.createServer(app);
const io = new Server(server, {
  path: "/mediasoup",
  cors: {
    origin: "http://localhost:3000",
    methods: ["GET", "POST"],
  },
});

let worker, router;
const peers = {};

async function createWorker() {
  worker = await mediasoup.createWorker();
  router = await worker.createRouter({
    mediaCodecs: [
      {
        kind: "audio",
        mimeType: "audio/opus",
        clockRate: 48000,
        channels: 2,
      },
      {
        kind: "video",
        mimeType: "video/VP8",
        clockRate: 90000,
      },
    ],
  });
}
await createWorker();

io.on("connection", (socket) => {
  console.log("✅ Client connected:", socket.id);

socket.on("joinRoom", ({ roomName }, callback) => {
  // Store peer
  peers[socket.id] = { socket, roomName, transports: [], producers: [], consumers: [] };

  // Collect all existing producers in the same room
  const existingProducers = [];
  for (const id in peers) {
    if (id !== socket.id && peers[id].roomName === roomName) {
      peers[id].producers.forEach((producer) => {
        existingProducers.push(producer.id);
      });
    }
  }

  // Send rtpCapabilities + existing producers to the new client
  callback({
    rtpCapabilities: router.rtpCapabilities,
    existingProducers,
  });
});

  socket.on("createWebRtcTransport", async ({ consumer }, callback) => {
    const transport = await router.createWebRtcTransport({
      listenIps: [{ ip: "0.0.0.0", announcedIp: "127.0.0.1" }],
      enableUdp: true,
      enableTcp: true,
      preferUdp: true,
    });

    peers[socket.id].transports.push(transport);
    callback({
      params: {
        id: transport.id,
        iceParameters: transport.iceParameters,
        iceCandidates: transport.iceCandidates,
        dtlsParameters: transport.dtlsParameters,
      },
    });
  });

  socket.on("transport-connect", async ({ dtlsParameters, transportId }) => {
    const transport = peers[socket.id].transports.find((t) => t.id === transportId);
    if (!transport) return;
    await transport.connect({ dtlsParameters });
  });

  socket.on("transport-produce", async ({ kind, rtpParameters, transportId }, callback) => {
    const transport = peers[socket.id].transports.find((t) => t.id === transportId);
    const producer = await transport.produce({ kind, rtpParameters });
    peers[socket.id].producers.push(producer);

    // notify other peers
    for (const id in peers) {
      if (id !== socket.id && peers[id].roomName === peers[socket.id].roomName) {
        peers[id].socket.emit("newProducer", { producerId: producer.id });
      }
    }

    callback({ id: producer.id });
  });

  socket.on("transport-recv-connect", async ({ dtlsParameters, transportId }) => {
    const transport = peers[socket.id].transports.find((t) => t.id === transportId);
    await transport.connect({ dtlsParameters });
  });

  socket.on("consume", async ({ rtpCapabilities, remoteProducerId, transportId }, callback) => {
    const transport = peers[socket.id].transports.find((t) => t.id === transportId);
    const consumer = await transport.consume({
      producerId: remoteProducerId,
      rtpCapabilities,
      paused: true,
    });

    peers[socket.id].consumers.push(consumer);
    callback({
      params: {
        id: consumer.id,
        producerId: remoteProducerId,
        kind: consumer.kind,
        rtpParameters: consumer.rtpParameters,
      },
    });
  });

  socket.on("consumer-resume", async ({ consumerId }) => {
    const consumer = peers[socket.id].consumers.find((c) => c.id === consumerId);
    await consumer.resume();
  });

  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);
    delete peers[socket.id];
  });
});

server.listen(4000, () => console.log("🚀 Server running on http://localhost:4000"));
