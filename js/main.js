const UID = String(Math.floor(Math.random() * 10000));
const ref = String(Math.floor(Math.random() * 10000));

let queryString = window.location.search;
let urlParams = new URLSearchParams(queryString);
let room_id = urlParams.get("room_id");

if (!room_id) {
  window.location = "index.html";
}

let localStream;
let remoteStream;
let peerConnection;

let socket = new WebSocket(
    "wss://fathomless-dusk-11609.herokuapp.com/socket/websocket"
);
let joinStatus = false;

const removeVideoElement = () => {
  let videoEl = document.getElementById("user-2");
  if (videoEl) {
    const tracks = videoEl.srcObject.getTracks();

    tracks.forEach(function (track) {
      track.stop();
    });

    videoEl.srcObject = null;
    videoEl.parentNode.removeChild(videoEl);
  }
};

/**
 * When websocket connection is established,
 * join room:<room_id>
 */
socket.onopen = () => {
  socketSend(`room:${room_id}`, "phx_join", { uid: UID });
};

socket.onmessage = async (event) => {
  const data = JSON.parse(event.data);

  if (data.event === "joined-room") {
    if (!joinStatus) {
      if (!localStream) {
        localStream = await navigator.mediaDevices.getUserMedia(constraints);
        document.getElementById("user-1").srcObject = localStream;
      }

      joinStatus = true;
      await createOffer();
    }
  }

  if (data.event === "offer") {
    const { offer: offer, sent_by: sent_by } = data.payload;
    if (sent_by !== UID) {
      await createAnswer(offer, sent_by);
    }
  }

  if (data.event == "answer") {
    const { answer: answer, sent_by: sent_by, sent_to: sent_to } = data.payload;
    await addAnswer(answer, sent_by, sent_to);
  }

  if (data.event == "candidate") {
    const { candidate: candidate } = data.payload;
    try {
      await setIceCandidate(peerConnection, candidate);
    } catch (error) {
      if (!peerConnection.iceConnectionState === "connected")
        console.debug("waiting for offer to answer...");
    }
  }

  if (data.event == "disconnected" || data.event == "user-left") {
    const { room_id: room_id, uid: user_that_left } = data.payload;
    console.log("disconnected", user_that_left);
    document.getElementById("user-1").classList.remove("smallFrame");
    removeVideoElement();
    peerConnection.close();
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
  await init();

  try {
    await peerConnection.setRemoteDescription(offer);
    let answer = await peerConnection.createAnswer();
    await peerConnection.setLocalDescription(answer);

    // signal offer to peer
    socketSend(`room:${room_id}`, "answer", {
      answer: answer,
      sent_by: UID,
      sent_to: sent_by,
    });
  } catch (error) {
    console.debug(error.message, "in createOffer");
  }
};

const addPeerStream = (event) => {
  document.getElementById("user-1").classList.add("smallFrame");
  let psv = document.getElementById("user-2");
  if (!psv) {
    let peerStreamVid = document.createElement("video");
    let videos = document.getElementById("videos");
    peerStreamVid.id = "user-2";
    peerStreamVid.className = "video-player";
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

      socketSend(`room:${room_id}`, "offer", {
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

  localStream.getTracks().forEach((track) => {
    peerConnection.addTrack(track, localStream);
  });

  peerConnection.onicecandidateerror = (event) => {
    if (event.errorCode === 701) {
      console.debug(event.errorText);
    }
  };

  peerConnection.ontrack = (event) => {
    addPeerStream(event);
  };

  // triggered after peerConnection obj created
  peerConnection.onicecandidate = (event) => {
    if (event.candidate) {
      socketSend(`room:${room_id}`, "candidate", {
        candidate: event.candidate,
      });
    }
  };
};

const toggleMute = () => {
  for (let index in localStream.getAudioTracks()) {
    localStream.getAudioTracks()[index].enabled =
      !localStream.getAudioTracks()[index].enabled;
    muteButton.innerText = localStream.getAudioTracks()[index].enabled
      ? "Unmuted"
      : "Muted";
  }
};

const toggleVid = () => {
  for (let index in localStream.getVideoTracks()) {
    localStream.getVideoTracks()[index].enabled =
      !localStream.getVideoTracks()[index].enabled;
    vidButton.innerText = localStream.getVideoTracks()[index].enabled
      ? "Cam"
      : "Off";
  }
};

const leave = () => {
  socketSend(`room:${room_id}`, "user-left", {});
  window.location = "index.html";
};

const reconnect = () => {
  window.location.reload();
};
