# Mediasoup Next.js Example (Separate Server and Client)

Structure:
- server/   -> Express + mediasoup server
- client/   -> Next.js frontend (JavaScript)

Quick start (two terminals):
1) Server:
   cd server
   npm install
   npm run dev

2) Client:
   cd client
   npm install
   npm run dev

Notes:
- This is a minimal starter. You will likely need to adapt mediasoup worker options and listen IPs for production use.
- If client and server are on different origins, update socket.io client URL in pages/index.js (use http://localhost:4000/).
