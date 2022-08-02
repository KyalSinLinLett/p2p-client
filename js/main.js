const UID = String(Math.floor(Math.random() * 10000));
const ref = String(Math.floor(Math.random() * 1000));

let localStream;
let remoteStream;
let peerConnection;
let peers = [];

let socket = new WebSocket("ws://localhost:4000/socket/websocket");
let joinStatus = false;

const removeVideoElement = (id) => {
  let videoEl = document.getElementById(`dyn-user-${id}`);
  if (videoEl) {
    const tracks = videoEl.srcObject.getTracks();

    tracks.forEach(function (track) {
      track.stop();
    });

    videoEl.srcObject = null;
    videoEl.parentNode.removeChild(videoEl);
  }
};

const updatePeerList = (id) => {
  peers = peers.filter((p) => p !== id);
  console.log("removed", id, "now: ", peers);
};

/**
 * When websocket connection is established,
 * join room:<room_id>
 */
socket.onopen = () => {
  socketSend("room:123", "phx_join", { uid: UID });
};

socket.onmessage = async (event) => {
  const data = JSON.parse(event.data);

  if (data.event === "joined-room") {
    peers = data.payload.current_peers;
    console.log(peers);
    if (!joinStatus) {
      console.log(data.payload.self, "successfully joined room");
      joinStatus = true;
      await createOffer();
    }
  }

  if (data.event === "offer") {
    const { offer: offer, sent_by: sent_by } = data.payload;
    if (sent_by !== UID) {
      console.log("received offer from", sent_by);
      await createAnswer(offer, sent_by);
    }
  }

  if (data.event == "answer") {
    const { answer: answer, sent_by: sent_by, sent_to: sent_to } = data.payload;
    console.log("received answer from", sent_by, "for offer by", sent_to);
    await addAnswer(answer, sent_by, sent_to);
  }

  if (data.event == "candidate") {
    const { candidate: candidate } = data.payload;
    try {
      await setIceCandidate(peerConnection, candidate);
    } catch (error) {
      if (!peerConnection.iceConnectionState === "connected")
        console.log("waiting for offer to answer...");
    }
  }

  if (data.event == "disconnected") {
    const { room_id: room_id, uid: user_that_left } = data.payload;
    removeVideoElement(user_that_left);
    updatePeerList(user_that_left);
  }
};

const socketSend = (topic, event, payload) => {
  socket.send(
    JSON.stringify({
      topic: topic,
      event: event,
      payload: payload,
      ref: ref,
    })
  );
};

const servers = {
  iceServers: [
    {
      urls: ["stun:stun1.l.google.com:19302", "stun:stun2.l.google.com:19302"],
    },
  ],
};

let constraints = {
  video: {
    width: { min: 640, ideal: 1920, max: 1920 },
    height: { min: 480, ideal: 1080, max: 1080 },
  },
  audio: true,
};

const setIceCandidate = async (peerConnection, candidate) => {
  if (peerConnection) {
    if (
      peerConnection.iceConnectionState !== "connected" ||
      peerConnection.iceConnectionState !== "completed"
    ) {
      await peerConnection.addIceCandidate(candidate);
    }
  }
};

const createAnswer = async (offer, sent_by) => {
  console.log("creating answer for", sent_by);
  await init("ans");

  try {
    await peerConnection.setRemoteDescription(offer);
    let answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    // signal offer to peer
    console.log("sending answer...");
    socketSend("room:123", "answer", {
      answer: answer,
      sent_by: UID,
      sent_to: sent_by,
    });
  } catch (error) {
    console.log(error.message, "in createOffer");
  }
};

const addPeerStream = (event, peer_socket_id) => {
  let psv = document.getElementById(`dyn-user-${peer_socket_id}`);
  if (!psv) {
    console.log("adding peer stream");
    let peerStreamVid = document.createElement("video");
    let videos = document.getElementById("videos");
    peerStreamVid.id = `dyn-user-${peer_socket_id}`;
    peerStreamVid.className = "streams";
    peerStreamVid.autoplay = true;
    peerStreamVid.playsInline = true;
    videos.appendChild(peerStreamVid);

    if (event.streams && event.streams[0]) {
      peerStreamVid.srcObject = event.streams[0];
    } else {
      if (!remoteStream) {
        peerStreamVid.srcObject = remoteStream;
      }
      remoteStream.addTrack(event.track);
    }
  }
};

const addAnswer = async (answer, sent_by, sent_to) => {
  if (sent_by === UID) return;

  console.log("adding answer");

  if (!peerConnection.currentRemoteDescription) {
    await peerConnection.setRemoteDescription(answer);
  }

  addPeerStream(peerConnection, sent_by);
};

const createOffer = async () => {
  await init("offer");

  peerConnection.onnegotiationneeded = async (event) => {
    try {
      let offer = await peerConnection.createOffer();
      await peerConnection.setLocalDescription(offer);
      console.log("setting local desc done");

      console.log("sending offer...");
      socketSend("room:123", "offer", {
        offer: offer,
        sent_by: UID,
      });
    } catch (error) {
      console.log({ error }, "in createOffer");
    }
  };
};

const init = async (type) => {
  peerConnection = new RTCPeerConnection(servers);

  if (!localStream) {
    localStream = await navigator.mediaDevices.getUserMedia(constraints);
    document.getElementById("user-1").srcObject = localStream;
  }

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.onicecandidateerror = (event) => {
    if (event.errorCode === 701) {
      console.log(event.errorText);
    }
  };

  peerConnection.ontrack = (event) => {
    for (let p of peers) {
      addPeerStream(event, p);
    }
  };

  // triggered after peerConnection obj created
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socketSend("room:123", "candidate", {
        candidate: event.candidate,
      });
    }
  };
};
