import { useState } from "react";
import { useRouter } from "next/router";

export default function Home() {
  const [room, setRoom] = useState("");
  const router = useRouter();

  const handleJoin = () => {
    if (room.trim() === "") return alert("Please enter a room name");
    router.push(`/room/${room.trim()}`);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-slate-950 text-white">
      <div className="bg-slate-800/60 backdrop-blur-xl rounded-2xl shadow-2xl p-10 w-full max-w-md border border-slate-700">
        <h1 className="text-3xl font-bold mb-6 text-center">
          🎥 Join a Mediasoup Room
        </h1>

        <input
          type="text"
          placeholder="Enter room name..."
          value={room}
          onChange={(e) => setRoom(e.target.value)}
          className="w-full px-4 py-3 mb-6 rounded-lg bg-slate-900 border border-slate-700 focus:ring-2 focus:ring-teal-500 focus:outline-none placeholder-gray-400 text-lg"
        />

        <button
          onClick={handleJoin}
          className="w-full py-3 bg-teal-600 hover:bg-teal-500 active:scale-95 transition rounded-lg font-semibold text-lg shadow-lg"
        >
          Join Room
        </button>

        <p className="text-sm text-gray-400 mt-4 text-center">
          Enter a unique room name to start or join an existing meeting
        </p>
      </div>
    </div>
  );
}
