// signaling-server.js
const WebSocket = require('ws');

const wss = new WebSocket.Server({ port: 3000 });

let peers = []; // зберігаємо ws клієнтів
let pendingOffer = null; // Store pending offer if no peer is ready
let pendingAnswer = null; // Store pending answer if no peer is ready

wss.on('connection', (ws) => {
  console.log('Peer connected. Total peers:', peers.length + 1);
  peers.push(ws);

  // Small delay to ensure connection is fully established
  setTimeout(() => {
    // Notify new peer about existing peers
    const otherPeers = peers.filter(p => p !== ws && p.readyState === WebSocket.OPEN);
    if (otherPeers.length > 0) {
      console.log('Notifying new peer: other peer(s) already connected');
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'peer-ready' }));
      }
      
      // Also notify existing peers about the new peer
      console.log('Notifying existing peers about new peer');
      otherPeers.forEach((p, index) => {
        if (p.readyState === WebSocket.OPEN) {
          console.log(`  → Sending peer-ready to existing peer ${index + 1}`);
          p.send(JSON.stringify({ type: 'peer-ready' }));
        } else {
          console.log(`  ⚠️  Existing peer ${index + 1} not open (state: ${p.readyState})`);
        }
      });
    }
  }, 100);

  // Send any pending offer to the new peer
  if (pendingOffer) {
    console.log('Resending pending offer to new peer');
    ws.send(JSON.stringify(pendingOffer));
    pendingOffer = null; // Clear after sending
  }

  // Send any pending answer to the new peer
  if (pendingAnswer) {
    console.log('Resending pending answer to new peer');
    ws.send(JSON.stringify(pendingAnswer));
    pendingAnswer = null; // Clear after sending
  }

  ws.on('message', (msg) => {
    try {
      const data = JSON.parse(msg.toString());
      
      // Handle ready signal
      if (data.type === 'ready') {
        console.log('Peer is ready');
        // Notify other peers that this peer is ready
        const otherPeers = peers.filter(p => p !== ws && p.readyState === WebSocket.OPEN);
        otherPeers.forEach(p => {
          p.send(JSON.stringify({ type: 'peer-ready' }));
        });
        return;
      }

      const msgType = data.sdp ? `SDP ${data.sdp.type}` : data.ice ? 'ICE candidate' : 'unknown';
      const otherPeers = peers.filter(p => p !== ws && p.readyState === WebSocket.OPEN);
      console.log('📤 Received:', msgType, 'from peer. Relaying to', otherPeers.length, 'peer(s)');
      
      if (otherPeers.length === 0) {
        console.log('⚠️  No other peers connected. Storing message for later...');
        // Store offer/answer for when another peer connects
        if (data.sdp) {
          if (data.sdp.type === 'offer') {
            pendingOffer = { sdp: data.sdp };
            console.log('Stored pending offer');
          } else if (data.sdp.type === 'answer') {
            pendingAnswer = { sdp: data.sdp };
            console.log('Stored pending answer');
          }
        }
      } else {
        otherPeers.forEach((p, index) => {
          console.log(`   → Sending to peer ${index + 1}, state: ${p.readyState}`);
          p.send(msg);
        });
        // Clear pending messages since we successfully relayed
        if (data.sdp) {
          if (data.sdp.type === 'offer') pendingOffer = null;
          if (data.sdp.type === 'answer') pendingAnswer = null;
        }
      }
    } catch (e) {
      console.log('Relaying binary/non-JSON message');
      const otherPeers = peers.filter(p => p !== ws && p.readyState === WebSocket.OPEN);
      otherPeers.forEach(p => {
        p.send(msg);
      });
    }
  });

  ws.on('close', () => {
    console.log('Peer disconnected');
    peers = peers.filter(p => p !== ws);
    // Clear pending messages when peer disconnects
    pendingOffer = null;
    pendingAnswer = null;
  });
});

console.log('Signaling server running on ws://localhost:3000');
