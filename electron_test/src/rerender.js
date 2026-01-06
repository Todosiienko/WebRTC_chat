const messagesEl = document.getElementById('messages');
const inputEl = document.getElementById('inputMessage');
const sendBtn = document.getElementById('sendBtn');

const ws = new WebSocket('ws://localhost:3000');
const pc = new RTCPeerConnection({
    iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun1.l.google.com:19302" }
    ]
});

let dataChannel = pc.createDataChannel("chat", {
    ordered: true
});
let pendingIceCandidates = [];
let isAnswerReceived = false;
let offerCreated = false;
let peerReady = false;

// DataChannel
dataChannel.onopen = () => {
    appendMessage("DataChannel opened!");
    console.log("DataChannel opened, readyState:", dataChannel.readyState);
};
dataChannel.onmessage = (e) => appendMessage("Peer1 received: " + e.data);
dataChannel.onerror = (e) => {
    appendMessage("DataChannel error: " + e);
    console.error("DataChannel error:", e);
};
dataChannel.onclose = () => {
    appendMessage("DataChannel closed");
    console.log("DataChannel closed");
};

// Connection state monitoring
pc.onconnectionstatechange = () => {
    appendMessage("Connection state: " + pc.connectionState);
    console.log("PeerConnection state:", pc.connectionState);
    if (pc.connectionState === "connected") {
        appendMessage("✓ WebRTC connection established!");
    } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        appendMessage("✗ WebRTC connection failed/disconnected");
    }
};

pc.oniceconnectionstatechange = () => {
    appendMessage("ICE connection state: " + pc.iceConnectionState);
    console.log("ICE connection state:", pc.iceConnectionState);
    if (pc.iceConnectionState === "connected") {
        appendMessage("✓ ICE connection established!");
    } else if (pc.iceConnectionState === "failed") {
        appendMessage("✗ ICE connection failed - check network/firewall");
    }
};

pc.onicegatheringstatechange = () => {
    appendMessage("ICE gathering state: " + pc.iceGatheringState);
    console.log("ICE gathering state:", pc.iceGatheringState);
};

// Helper function to send message via WebSocket
function sendViaWebSocket(data) {
    if (ws.readyState === WebSocket.OPEN) {
        const jsonData = JSON.stringify(data);
        console.log("Sending via WebSocket:", jsonData.substring(0, 100) + "...");
        ws.send(jsonData);
        appendMessage("📤 Sent: " + (data.sdp ? `SDP ${data.sdp.type}` : data.ice ? "ICE" : "unknown"));
    } else {
        appendMessage("⚠️ WebSocket not open, waiting...");
        ws.addEventListener('open', () => {
            ws.send(JSON.stringify(data));
        }, { once: true });
    }
}

// ICE candidates
pc.onicecandidate = (event) => {
    if (event.candidate) {
        sendViaWebSocket({ ice: event.candidate });
    } else {
        appendMessage("ICE gathering complete");
        console.log("ICE gathering complete");
    }
};

// Обробка сигналів
ws.onmessage = async (event) => {
    try {
        const msg = JSON.parse(event.data);
        console.log("Received message:", msg);
        
        // Handle peer-ready signal
        if (msg.type === 'peer-ready') {
            appendMessage("✓✓✓ PEER-READY RECEIVED! ✓✓✓");
            console.log("Peer-ready signal received, offerCreated:", offerCreated);
            peerReady = true;
            // If we haven't created offer yet, create it now
            if (!offerCreated) {
                appendMessage("Creating offer now...");
                start();
            } else if (pc.localDescription && pc.localDescription.type === 'offer') {
                // Resend offer if we already created it
                appendMessage("Resending offer...");
                sendViaWebSocket({ sdp: pc.localDescription });
            } else {
                appendMessage("Offer already sent, waiting for answer...");
            }
            return;
        }
        
        appendMessage("📨 Received: " + (msg.sdp ? `SDP ${msg.sdp.type}` : msg.ice ? "ICE" : "unknown"));

        if (msg.sdp) {
            appendMessage("Processing SDP: " + msg.sdp.type);
            try {
                await pc.setRemoteDescription(msg.sdp);
                appendMessage("✓ Set remote description: " + msg.sdp.type);
            } catch (e) {
                appendMessage("✗ Error setting remote description: " + e.message);
                console.error("Error setting remote description:", e);
                return;
            }
            
            // Add any pending ICE candidates
            while (pendingIceCandidates.length > 0) {
                const candidate = pendingIceCandidates.shift();
                try {
                    await pc.addIceCandidate(candidate);
                } catch(e) {
                    console.error("Error adding pending ICE candidate:", e);
                }
            }
            
            if (msg.sdp.type === "answer") {
                isAnswerReceived = true;
                appendMessage("✓✓✓ ANSWER RECEIVED! ✓✓✓");
                console.log("Received answer:", msg.sdp);
                
                // Monitor connection progress
                const checkConnection = setInterval(() => {
                    appendMessage(`[Status] DC: ${dataChannel.readyState}, Conn: ${pc.connectionState}, ICE: ${pc.iceConnectionState}`);
                    if (pc.connectionState === "connected" || pc.connectionState === "failed") {
                        clearInterval(checkConnection);
                    }
                }, 500);
                
                setTimeout(() => clearInterval(checkConnection), 10000);
            }
        }

        if (msg.ice) {
            try {
                if (pc.remoteDescription) {
                    await pc.addIceCandidate(msg.ice);
                    appendMessage("✓ Added ICE candidate");
                } else {
                    pendingIceCandidates.push(msg.ice);
                    appendMessage("⏳ Stored ICE candidate (waiting for remote description)");
                }
            } catch(e) {
                console.error("Error adding ICE candidate:", e);
                appendMessage("✗ Error adding ICE candidate: " + e.message);
            }
        }
    } catch (error) {
        console.error("Error processing message:", error);
        appendMessage("✗ Error: " + error.message);
    }
};

ws.onerror = (error) => {
    console.error("WebSocket error:", error);
    appendMessage("WebSocket error");
};

ws.onclose = () => {
    appendMessage("WebSocket closed");
    console.log("WebSocket closed");
};

// Кнопка відправки повідомлень
sendBtn.onclick = () => {
    if (dataChannel && dataChannel.readyState === "open") {
        const msg = inputEl.value;
        dataChannel.send(msg);
        appendMessage("Peer1 sent: " + msg);
        inputEl.value = '';
    } else {
        appendMessage("Cannot send: DataChannel not open (state: " + (dataChannel ? dataChannel.readyState : "null") + ")");
    }
};

// Старт - створення offer
async function start() {
    if (offerCreated) {
        appendMessage("Offer already created, skipping...");
        return;
    }
    
    try {
        appendMessage("🚀 Starting WebRTC connection...");
        appendMessage("Creating offer...");
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        offerCreated = true;
        appendMessage("✓ Offer created");
        console.log("Offer created:", offer);
        
        // Wait for ICE gathering, then send offer
        const checkAndSend = () => {
            if (pc.iceGatheringState === "complete") {
                sendViaWebSocket({ sdp: pc.localDescription });
                appendMessage("✓✓✓ OFFER SENT ✓✓✓");
                console.log("Offer sent:", pc.localDescription);
            } else if (pc.iceGatheringState === "gathering") {
                // Still gathering, wait a bit more
                setTimeout(checkAndSend, 100);
            } else {
                // Not started yet, wait
                setTimeout(checkAndSend, 50);
            }
        };
        
        // Start checking after a short delay
        setTimeout(checkAndSend, 200);
    } catch (error) {
        console.error("Error creating offer:", error);
        appendMessage("✗ Error creating offer: " + error.message);
    }
}

// Wait for WebSocket to be ready before starting
ws.addEventListener('open', () => {
    appendMessage("WebSocket connected");
    console.log('WebSocket connected, readyState:', ws.readyState);
    // Send ready signal
    sendViaWebSocket({ type: 'ready' });
    appendMessage("Sent ready signal to server");
    
    // If we receive peer-ready signal, we'll start automatically
    // Otherwise, wait a bit and check if another peer is already connected
    setTimeout(() => {
        if (!offerCreated && peerReady) {
            appendMessage("Peer already ready, starting connection...");
            start();
        } else if (!offerCreated) {
            appendMessage("No other peer detected yet. Will start when peer connects.");
        }
    }, 500);
});

function appendMessage(msg) {
    messagesEl.value += msg + "\n";
    messagesEl.scrollTop = messagesEl.scrollHeight;
}
