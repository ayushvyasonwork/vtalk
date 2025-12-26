import { useState } from "react";
import { useRouter } from "next/router";
import io from "socket.io-client";

export default function Home() {
  const [room, setRoom] = useState("");
  const [mode, setMode] = useState("manual"); // "manual" or "random"
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleGenerateRandomRoom = async () => {
    setLoading(true);
    try {
      const socket = io("http://localhost:4000", {
        path: "/mediasoup",
        transports: ["websocket"],
      });

      socket.on("connect", () => {
        socket.emit("generateRandomRoomName", ({ roomName }) => {
          setRoom(roomName);
          socket.disconnect();
          setLoading(false);
        });
      });

      // Timeout after 5 seconds
      setTimeout(() => {
        socket.disconnect();
        setLoading(false);
        alert("Failed to generate room name. Please try again.");
      }, 5000);
    } catch (err) {
      console.error("Error generating room name:", err);
      setLoading(false);
      alert("Error generating room name. Please try again.");
    }
  };

  const handleJoin = () => {
    if (room.trim() === "") return alert("Please enter or generate a room name");
    router.push(`/room/${room.trim()}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 text-white">
      <div className="bg-slate-800/60 backdrop-blur-xl rounded-2xl shadow-2xl p-10 w-full max-w-md border border-slate-700">
        <h1 className="text-3xl font-bold mb-8 text-center">
          🎥 Join a Mediasoup Room
        </h1>

        {/* Mode Selection */}
        <div className="mb-6">
          <p className="text-sm font-semibold mb-3 text-gray-300">Choose Room Mode:</p>
          <div className="flex gap-4">
            <button
              onClick={() => setMode("manual")}
              className={`flex-1 py-2 px-4 rounded-lg font-semibold transition ${
                mode === "manual"
                  ? "bg-teal-600 text-white"
                  : "bg-slate-700 text-gray-300 hover:bg-slate-600"
              }`}
            >
              Manual
            </button>
            <button
              onClick={() => setMode("random")}
              className={`flex-1 py-2 px-4 rounded-lg font-semibold transition ${
                mode === "random"
                  ? "bg-teal-600 text-white"
                  : "bg-slate-700 text-gray-300 hover:bg-slate-600"
              }`}
            >
              Random
            </button>
          </div>
        </div>

        {/* Manual Mode */}
        {mode === "manual" && (
          <>
            <input
              type="text"
              placeholder="Enter room name..."
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              className="w-full px-4 py-3 mb-6 rounded-lg bg-slate-900 border border-slate-700 focus:ring-2 focus:ring-teal-500 focus:outline-none placeholder-gray-400 text-lg"
            />
            <p className="text-xs text-gray-400 mb-6 text-center">
              Enter a unique room name to start or join an existing meeting
            </p>
          </>
        )}

        {/* Random Mode */}
        {mode === "random" && (
          <>
            <div className="mb-6">
              {room ? (
                <div className="bg-slate-900 border border-teal-500 rounded-lg p-4">
                  <p className="text-xs text-gray-400 mb-2">Your Random Room Name:</p>
                  <p className="text-lg font-mono font-bold text-teal-400 break-words">
                    {room}
                  </p>
                </div>
              ) : (
                <div className="bg-slate-900 border border-slate-700 rounded-lg p-4 text-center">
                  <p className="text-sm text-gray-400">
                    Click the button below to generate a random room name
                  </p>
                </div>
              )}
            </div>
            <button
              onClick={handleGenerateRandomRoom}
              disabled={loading}
              className={`w-full py-3 mb-6 rounded-lg font-semibold text-lg transition ${
                loading
                  ? "bg-slate-600 text-gray-300 cursor-not-allowed"
                  : "bg-purple-600 hover:bg-purple-500 active:scale-95"
              }`}
            >
              {loading ? "Generating..." : "🎲 Generate Random Room"}
            </button>
            <p className="text-xs text-gray-400 text-center">
              A unique room name will be generated automatically
            </p>
          </>
        )}

        <button
          onClick={handleJoin}
          disabled={!room.trim()}
          className={`w-full py-3 mt-8 rounded-lg font-semibold text-lg transition ${
            !room.trim()
              ? "bg-slate-600 text-gray-400 cursor-not-allowed"
              : "bg-teal-600 hover:bg-teal-500 active:scale-95"
          }`}
        >
          Join Room
        </button>
      </div>
    </div>
  );
}