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
const peers = {}; // { socket.id: { socket, roomName, transports, producers, consumers } }
const activeRooms = new Set(); // Track all active room names for uniqueness

// Utility function to generate random alphanumeric room name
function generateRandomRoomName(length = 10) {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

// Generate unique room name
function getUniqueRandomRoomName(length = 10) {
  let roomName;
  do {
    roomName = generateRandomRoomName(length);
  } while (activeRooms.has(roomName));
  return roomName;
}

async function createWorker() {
  try {
    worker = await mediasoup.createWorker({
      logLevel: "warn",
    });

    worker.on("died", (error) => {
      console.error("❌ mediasoup worker has died:", error);
      setTimeout(() => process.exit(1), 2000); // exit in 2 seconds
    });

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
    console.log("✅ Mediasoup worker and router created");
  } catch (err) {
    console.error("❌ Error creating mediasoup worker:", err);
    process.exit(1);
  }
}
await createWorker();

io.on("connection", (socket) => {
  console.log(" Client connected:", socket.id);

  socket.on("generateRandomRoomName", (callback) => {
    const roomName = getUniqueRandomRoomName();
    activeRooms.add(roomName);
    callback({ roomName });
  });

  socket.on("joinRoom", ({ roomName }, callback) => {

    // If roomName is not already in activeRooms, add it
    if (!activeRooms.has(roomName)) {
      activeRooms.add(roomName);
    }

    peers[socket.id] = {
      socket,
      roomName,
      transports: [],
      producers: [],
      consumers: [],
    };

    // Collect data about other peers in the same room
    const otherPeersData = [];
    for (const id in peers) {
      if (id !== socket.id && peers[id].roomName === roomName) {
        otherPeersData.push({
          peerId: id,
          producerIds: peers[id].producers.map((producer) => producer.id),
        });
      }
    }

    // Send rtpCapabilities + other peers' data to the new client
    callback({
      rtpCapabilities: router.rtpCapabilities,
      otherPeersData, // --- MODIFIED ---
    });
  });

  socket.on("createWebRtcTransport", async ({ consumer }, callback) => {
    // --- NEW: Added try...catch and error callback ---
    try {
      const transport = await router.createWebRtcTransport({
        // listenIps: [{ ip: "0.0.0.0", announcedIp: "192.168.98.174" }], // Use 127.0.0.1 for local dev
        listenIps: [{ ip: "0.0.0.0", announcedIp: "127.0.0.1" }], // Use 127.0.0.1 for local dev
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });

      if (peers[socket.id]) {
        peers[socket.id].transports.push(transport);
      }

      callback({
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        },
      });
    } catch (err) {
      console.error("❌ Error creating transport:", err);
      callback({ error: err.message });
    }
  });

  socket.on("transport-connect", async ({ dtlsParameters, transportId }) => {
    // --- NEW: Added checks ---
    const peer = peers[socket.id];
    if (!peer) return;
    const transport = peer.transports.find((t) => t.id === transportId);
    if (!transport) {
      console.warn(`Transport not found: ${transportId}`);
      return;
    }

    try {
      await transport.connect({ dtlsParameters });
    } catch (err) {
      console.error("❌ Error connecting transport:", err);
    }
  });

  socket.on(
    "transport-produce",
    async ({ kind, rtpParameters, transportId }, callback) => {
      // --- NEW: Added checks and try...catch ---
      const peer = peers[socket.id];
      if (!peer) return callback({ error: "Peer not found" });
      const transport = peer.transports.find((t) => t.id === transportId);
      if (!transport) {
        console.warn(`Transport not found for produce: ${transportId}`);
        return callback({ error: "Transport not found" });
      }

      try {
        const producer = await transport.produce({ kind, rtpParameters });
        peer.producers.push(producer);

        // --- MODIFIED: Notify other peers with producerId AND peerId ---
        const { roomName } = peer;
        for (const id in peers) {
          if (id !== socket.id && peers[id].roomName === roomName) {
            peers[id].socket.emit("newProducer", {
              producerId: producer.id,
              peerId: socket.id, // --- NEW ---
            });
          }
        }

        callback({ id: producer.id });
      } catch (err) {
        console.error("❌ Error producing:", err);
        callback({ error: err.message });
      }
    }
  );

  socket.on(
    "transport-recv-connect",
    async ({ dtlsParameters, transportId }) => {
      // --- NEW: Added checks ---
      const peer = peers[socket.id];
      if (!peer) return;
      const transport = peer.transports.find((t) => t.id === transportId);
      if (!transport) {
        console.warn(`Recv transport not found: ${transportId}`);
        return;
      }

      try {
        await transport.connect({ dtlsParameters });
      } catch (err) {
        console.error("❌ Error connecting recv transport:", err);
      }
    }
  );

  socket.on(
    "consume",
    async ({ rtpCapabilities, remoteProducerId, transportId }, callback) => {
      // --- NEW: Added checks and try...catch ---
      const peer = peers[socket.id];
      if (!peer) return callback({ error: "Peer not found" });

      const transport = peer.transports.find((t) => t.id === transportId);
      if (!transport) {
        console.warn(`Consume transport not found: ${transportId}`);
        return callback({ error: "Transport not found" });
      }

      // Check if router can consume
      if (
        !router.canConsume({ producerId: remoteProducerId, rtpCapabilities })
      ) {
        const msg = `Router cannot consume producer: ${remoteProducerId}`;
        console.warn(msg);
        return callback({ error: msg });
      }

      try {
        const consumer = await transport.consume({
          producerId: remoteProducerId,
          rtpCapabilities,
          paused: true, // Start paused, resume on client side
        });

        peer.consumers.push(consumer);

        // --- NEW: Handle consumer close events for cleanup ---
        consumer.on("transportclose", () => {
          console.log(`Consumer transport closed: ${consumer.id}`);
          peer.consumers = peer.consumers.filter((c) => c.id !== consumer.id);
        });

        consumer.on("producerclose", () => {
          console.log(`Consumer producer closed: ${consumer.id}`);
          peer.consumers = peer.consumers.filter((c) => c.id !== consumer.id);
          // You could optionally notify the client to remove this consumer
          // socket.emit('consumerClosed', { consumerId: consumer.id });
        });

        callback({
          params: {
            id: consumer.id,
            producerId: remoteProducerId,
            kind: consumer.kind,
            rtpParameters: consumer.rtpParameters,
          },
        });
      } catch (err) {
        console.error("❌ Error consuming:", err);
        callback({ error: err.message });
      }
    }
  );

  socket.on("consumer-resume", async ({ consumerId }) => {
    // --- NEW: Added checks ---
    const peer = peers[socket.id];
    if (!peer) return;
    const consumer = peer.consumers.find((c) => c.id === consumerId);
    if (!consumer) {
      console.warn(`Consumer not found for resume: ${consumerId}`);
      return;
    }

    try {
      await consumer.resume();
    } catch (err) {
      console.error("❌ Error resuming consumer:", err);
    }
  });

  socket.on("disconnect", () => {
    console.log("❌ Disconnected:", socket.id);
    // --- NEW: Full cleanup logic ---
    const peer = peers[socket.id];
    if (!peer) return;

    const { roomName } = peer;

    // Close all transports
    peer.transports.forEach((transport) => transport.close());
    // Producers and consumers are closed automatically when transports close

    // Remove peer from map
    delete peers[socket.id];

    // Check if any other peers are in this room
    let hasOtherPeersInRoom = false;
    for (const id in peers) {
      if (peers[id].roomName === roomName) {
        hasOtherPeersInRoom = true;
        break;
      }
    }

    // If no other peers in this room, remove it from activeRooms
    if (!hasOtherPeersInRoom) {
      activeRooms.delete(roomName);
      console.log(`🗑️ Room "${roomName}" removed (no more active peers)`);
    }

    // Notify all other peers in the room
    for (const id in peers) {
      if (peers[id].roomName === roomName) {
        peers[id].socket.emit("peerClosed", { peerId: socket.id });
      }
    }
  });
});

server.listen(4000, () =>
  console.log("🚀 Server running on http://localhost:4000")
);
