# Mediasoup Next.js Client
Instructions:
1. cd client
2. npm install
3. npm run dev
The client assumes the mediasoup Express server is available on the same host under the same origin path '/mediasoup'.
If running server on port 4000 and client on 3000, you may need to configure proxy or set socket.io URL: io('http://localhost:4000/mediasoup')
